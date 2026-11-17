import { randomUUID } from "node:crypto";
import { getPool, kstToday, withTransaction } from "./db.js";
import { callLLM, llmEnabled } from "./llm.js";
import { fetchListingById } from "./listings-db.js";
import { DEMO_OWNER_ID } from "./migrator.js";
import { checkFarmCompatibilityTool } from "./nongnong-agent.js";
import { MAX_RENTAL_DAYS } from "./rentals.js";
import { formatIsoDate, requireUuid } from "./validate.js";
import { scheduleWaitUntil } from "./wait-until.js";
import { getWeatherAndMapConfig } from "./weather.js";
import { SPEC_BY_ID } from "../src/data/machine-specifications.js";

const MAX_TOOL_ROUNDS = 5;
const DEFAULT_MAX_AI_TURNS = 4;
const VALID_CONFIDENCE = new Set(["high", "medium", "low"]);

function parseIsoDate(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const d = new Date(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== trimmed) return null;
  return trimmed;
}

function daysBetweenInclusive(start, end) {
  const s = new Date(`${start}T00:00:00Z`).getTime();
  const e = new Date(`${end}T00:00:00Z`).getTime();
  return Math.floor((e - s) / 86_400_000) + 1;
}

function shiftIsoDate(isoDate, deltaDays) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function checkListingAvailability(listing, startRaw, endRaw, today) {
  if (!listing || listing.status === "removed") {
    return { error: "매물을 찾을 수 없습니다." };
  }
  if (listing.type !== "rent") {
    return { error: "대여 매물이 아닙니다." };
  }
  const start = parseIsoDate(startRaw);
  const end = parseIsoDate(endRaw || startRaw);
  if (!start || !end) {
    return { error: "날짜는 YYYY-MM-DD 형식이어야 합니다." };
  }
  if (start < today) {
    return { error: `과거 날짜(${start})는 예약할 수 없습니다.` };
  }
  if (end < start) {
    return { error: "반납일은 시작일보다 빠를 수 없습니다." };
  }
  const days = daysBetweenInclusive(start, end);
  if (days > MAX_RENTAL_DAYS) {
    return { error: `대여 기간은 최대 ${MAX_RENTAL_DAYS}일까지 요청할 수 있습니다.` };
  }
  const booked = Array.isArray(listing.booked) ? listing.booked : [];
  const conflicts = booked.filter((r) => !(end < r.start || start > r.end));

  let nearestFree = null;
  if (conflicts.length) {
    for (let offset = 1; offset <= 30; offset += 1) {
      const candStart = shiftIsoDate(start, offset);
      const candEnd = shiftIsoDate(candStart, days - 1);
      const hasConflict = booked.some((r) => !(candEnd < r.start || candStart > r.end));
      if (!hasConflict) {
        nearestFree = { start: candStart, end: candEnd };
        break;
      }
    }
  }

  return {
    listingId: listing.id,
    title: listing.title,
    start,
    end,
    days,
    available: listing.status === "open" && listing.condition !== "repair" && conflicts.length === 0,
    bookedRanges: conflicts,
    nearestFree,
  };
}

export const DELEGATED_CHAT_TOOLS = [
  {
    name: "get_listing_context",
    description: "대상 매물의 상세 사양, 포함 작업기, 픽업 조건, 가격 및 위임 정책을 조회합니다.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "check_availability",
    description: "대여 매물의 지정 기간 예약 가능 여부와 충돌 일정, 가장 가까운 빈 기간을 확인합니다.",
    input_schema: {
      type: "object",
      properties: {
        start: { type: "string", description: "시작일 (YYYY-MM-DD)" },
        end: { type: "string", description: "반납일 (YYYY-MM-DD, 생략 시 start와 동일)" },
      },
      required: ["start"],
    },
  },
  {
    name: "get_weather",
    description: "매물 지역의 날짜별 기상 예보 및 농작업 적합도를 조회합니다.",
    input_schema: {
      type: "object",
      properties: {
        region: { type: "string", description: "지역명 (예: 영양읍)" },
        date: { type: "string", description: "시작일 (YYYY-MM-DD)" },
        endDate: { type: "string", description: "종료일 (YYYY-MM-DD)" },
        days: { type: "integer", description: "조회 일수 (기본 5)" },
      },
    },
  },
  {
    name: "check_farm_compatibility",
    description: "구매자의 보유 농기계와 작업 면적에 대해 대상 매물의 호환성·적합도를 검사합니다.",
    input_schema: {
      type: "object",
      properties: {
        areaPyeong: { type: "number", description: "작업 면적(평)" },
        ownedModelId: { type: "string", description: "보유 본체 모델 ID" },
      },
    },
  },
  {
    name: "send_proxy_reply",
    description: "상대방에게 보낼 대리 답변을 제출합니다. confidence가 low이면 자동 전송되지 않고 사용자 확인으로 전환됩니다.",
    input_schema: {
      type: "object",
      properties: {
        body: { type: "string", description: "상대방에게 보낼 답변 (1~500자 한국어)" },
        confidence: { type: "string", enum: ["high", "medium", "low"], description: "답변 확신도" },
        rationale: { type: "string", description: "판단 근거 요약" },
      },
      required: ["body", "confidence"],
    },
  },
  {
    name: "propose_rental_handoff",
    description: "일정과 조건이 합의되었을 때 대여 요청 확인 카드를 생성합니다. 거래 전담 모드(fullDelegation)가 켜져 있으면 실제 대여 요청을 자동 접수합니다.",
    input_schema: {
      type: "object",
      properties: {
        start: { type: "string", description: "합의된 시작일 (YYYY-MM-DD)" },
        end: { type: "string", description: "합의된 반납일 (YYYY-MM-DD)" },
        estimatedPrice: { type: "number", description: "예상 금액(원)" },
        agreedPrice: { type: "number", description: "합의된 금액(원)" },
        note: { type: "string", description: "합의된 인수 조건·메모" },
        closingReply: { type: "string", description: "거래 전담 모드에서 상대방에게 보낼 완료 안내 메시지" },
      },
      required: ["start", "end"],
    },
  },
  {
    name: "complete_delegated_transaction",
    description: "거래 전담 모드(fullDelegation)에서 모든 조건·예산·환경·일정이 합의되었을 때 실제 대여 요청(rental_requests) 또는 구매 신청(purchase_orders)을 자동 접수하고 거래를 완료합니다.",
    input_schema: {
      type: "object",
      properties: {
        start: { type: "string", description: "합의된 시작일 (YYYY-MM-DD, 대여 시 필수)" },
        end: { type: "string", description: "합의된 반납일 (YYYY-MM-DD, 대여 시 필수)" },
        agreedPrice: { type: "number", description: "합의된 금액(원). 대여는 총액 또는 일일 대여료, 판매는 총액" },
        note: { type: "string", description: "합의된 인수 조건·메모 (최대 500자)" },
        closingReply: { type: "string", description: "상대방에게 보낼 정중한 거래 접수 완료 안내 메시지 (1~500자)" },
      },
    },
  },
  {
    name: "escalate_to_user",
    description: "가격 흥정, 예산 초과, 하자 보증, 상세 주소/연락처 요구, 매물 정보에 없는 질문, 확신 부족 시 상대방에게 대답하지 않고 자동 응대를 멈춘 뒤 사용자에게 확인을 요청합니다.",
    input_schema: {
      type: "object",
      properties: {
        reasonCode: {
          type: "string",
          description: "사유 코드 (예: price_negotiation, budget_exceeded, warranty_claim, privacy_info, unknown_condition, low_confidence, policy_exceeded, schedule_conflict)",
        },
        summaryForUser: {
          type: "string",
          description: "위임자에게 보여줄 확인 요청 요약 (1~500자)",
        },
        suggestedReplyDraft: {
          type: "string",
          description: "사용자가 참고할 수 있는 선택적 답장 초안",
        },
      },
      required: ["reasonCode", "summaryForUser"],
    },
  },
];

function formatBudgetText(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value))
    ? `${Number(value).toLocaleString("ko-KR")}원`
    : "미설정";
}

function buildSystemPrompt({ targetRole, conv, listing, policy, ownedMachines, farmProfile, today }) {
  const roleLabel = targetRole === "owner" ? "매물 소유자(판매/임대인)" : "구매자(대여자)";
  const spec = listing?.modelId && Object.hasOwn(SPEC_BY_ID, listing.modelId) ? SPEC_BY_ID[listing.modelId] : null;
  const p = policy && typeof policy === "object" ? policy : {};
  const isFullDelegation = Boolean(p.fullDelegation && p.autoExecuteTransaction !== false);

  const policySummaryLines = [
    `- 거래 전담 모드(fullDelegation): ${p.fullDelegation ? "활성" : "비활성"} (자동 거래 실행: ${isFullDelegation ? "허용" : "비허용"})`,
    `- 거래 의도(intent): ${p.intent || listing?.type || conv.listing_type || "미지정"}`,
    `- 희망 일정(targetStart ~ targetEnd): ${p.targetStart ? `${p.targetStart} ~ ${p.targetEnd || p.targetStart}` : (p.desiredDate || "미지정")}`,
    targetRole === "buyer"
      ? `- 구매자 최대 예산(maxBudget): ${formatBudgetText(p.maxBudget)}`
      : `- 소유자 최소 수락 금액(minPrice): ${formatBudgetText(p.minPrice)}`,
    `- 가격 흥정 허용(allowNegotiation): ${p.allowNegotiation === true ? "허용" : "불가"}`,
    `- 농장 면적(areaPyeong): ${p.areaPyeong ?? farmProfile?.area_pyeong ?? "미지정"}`,
    `- 재배 작물(cropIds): ${Array.isArray(p.cropIds) && p.cropIds.length ? p.cropIds.join(", ") : (farmProfile?.crop_ids?.length ? farmProfile.crop_ids.join(", ") : "미지정")}`,
    `- 희망 농작업(operations): ${Array.isArray(p.operations) && p.operations.length ? p.operations.join(", ") : "미지정"}`,
    `- 보유 기종(ownedModelId): ${p.ownedModelId || "미지정"}`,
    `- 사용자 지역(region): ${p.region || farmProfile?.region || "미지정"}`,
    `- 인수·배달 선호(pickupPreference): ${p.pickupPreference || p.preferredPickupWindow || "미지정"}`,
    p.customRules || p.instructions ? `- 추가 요청/주의사항: ${[p.customRules, p.instructions].filter(Boolean).join(" / ")}` : "",
  ].filter(Boolean);

  const fullDelegationBlock = isFullDelegation
    ? [
        ``,
        `[거래 전담 모드 (Full Delegation) 지침]`,
        `- 너는 사용자가 부재중이더라도 거래 전부를 전담해 진행할 권한을 위임받았다.`,
        `- 상대방이 답장하면 사용자의 의도, 현재 환경(get_weather 기상 예보, check_farm_compatibility 농장 면적·기종 호환성, check_availability 예약 가능 여부), 예산(${targetRole === "buyer" ? formatBudgetText(p.maxBudget) : formatBudgetText(p.minPrice)}), 희망 일정(${p.targetStart ? `${p.targetStart}~${p.targetEnd || p.targetStart}` : "대화 중 합의"}), 인수 선호 조건을 종합 평가하여 대화를 진행하라.`,
        `- 대여 매물인 경우: check_availability, get_weather, check_farm_compatibility로 일정·날씨·호환성을 먼저 확인하라. 문제가 없고 일정·가격·인수 조건이 모두 합의되었으며 예산 범위 내라면, 사용자 확인을 기다리지 말고 즉시 complete_delegated_transaction(또는 propose_rental_handoff)을 호출해 실제 대여 요청을 접수하고 closingReply로 상대방에게 정중히 확정 안내를 보내라.`,
        `- 판매 매물인 경우: 가격·상태·인수 조건이 예산 및 정책과 일치하고 양측이 합의했다면 즉시 complete_delegated_transaction을 호출해 구매 신청을 접수하고 closingReply로 안내하라.`,
        `- 단, 상대방의 요구 가격이 예산을 초과하거나, 일정이 겹치거나, 악천후로 대안 합의가 필요하거나, 정보가 부족한 경우에는 절대 무리해서 거래를 실행하지 말고 escalate_to_user를 호출해 대기하라.`,
      ]
    : [];

  return [
    `너는 농기계 공유 플랫폼의 1:1 대리 채팅 AI 비서 '농농이'다.`,
    `현재 너는 [${roleLabel}]를 대리해 상대방과 대화하고 있다. 오늘(KST)은 ${today}이다.`,
    ``,
    `[매물 정보]`,
    `- 매물명: ${listing?.title || conv.listing_title} (ID: ${conv.listing_id}, 거래방식: ${listing?.type || conv.listing_type})`,
    `- 상태: ${listing?.status || conv.listing_status}, 기계 상태: ${listing?.condition || "미상"}`,
    `- 가격: ${listing?.price ?? 0}원${listing?.type === "rent" ? "/일" : ""}, 지역: ${listing?.region || "미상"}`,
    `- 포함 작업기: ${listing?.included || "없음"}`,
    `- 인수/픽업 조건: ${listing?.pickup || "미기재"}`,
    `- 상세 설명: ${listing?.description || "없음"}`,
    spec ? `- 카탈로그 제원: ${spec.brand} ${spec.model} (${spec.type}, ${spec.powerHp ?? "?"}마력)` : "",
    ``,
    `[위임 조건 및 사용자 환경]`,
    ...policySummaryLines,
    `[위임 정책 원본] ${JSON.stringify(p)}`,
    ownedMachines?.length ? `[구매자 보유 농기계] ${JSON.stringify(ownedMachines)}` : "",
    farmProfile ? `[구매자 농가 프로필] ${JSON.stringify(farmProfile)}` : "",
    ...fullDelegationBlock,
    ``,
    `[필수 가드레일 — 모르면 절대 답하지 않기]`,
    `1. 가격 할인·흥정은 정책에 allowNegotiation=true 및 예산/최소금액 범위가 명시되지 않은 한 절대 임의로 수락하지 말고 escalate_to_user를 호출하라.`,
    `2. 하자 보증, 수리비 부담, 법적/안전 책임 확약, 상세 주소(지번/도로명)·전화번호·계좌번호 공개 요청 시 즉시 escalate_to_user를 호출하라.`,
    `3. 질문자의 말에 답할 수 있는 적합한 정보가 매물 정보·예약 현황·위임 정책·프로필에 없으면(예: 최근 수리 이력, 타이어/부품 마모 상태, 미기재 옵션, 확신 부족) **절대 추측해서 send_proxy_reply로 대답하지 말고** 즉시 escalate_to_user를 호출해 상대방에게 대답하지 않고 사용자가 직접 답할 수 있게 기다려라.`,
    isFullDelegation
      ? `4. 거래 전담 모드에서는 조건·예산·환경이 모두 충족될 때만 complete_delegated_transaction(또는 propose_rental_handoff)으로 거래를 접수할 수 있다.`
      : `4. 최종 대여 승인·결제 확정은 절대 직접 실행하지 말고, 일정/조건 합의 시 propose_rental_handoff를 호출하라.`,
    `5. 매 턴 마지막에는 반드시 send_proxy_reply, propose_rental_handoff, complete_delegated_transaction, 또는 escalate_to_user 중 하나를 호출해 종료하라. 답변은 500자 이내 한국어로 작성하라.`,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildConversationMessages(historyRows, targetUserId) {
  const lines = historyRows.map((row) => {
    const who = row.sender_kind === "system"
      ? "시스템"
      : row.sender_id === targetUserId
        ? (row.sender_kind === "ai_proxy" ? "나(AI 대리)" : "나(사용자)")
        : (row.sender_kind === "ai_proxy" ? "상대방(AI 대리)" : "상대방");
    return `[seq:${row.seq} | ${who}] ${row.body}`;
  });
  return [
    {
      role: "user",
      content: `최근 1:1 대화 내역입니다. 위임 정책과 매물 정보를 바탕으로 적절한 도구를 사용해 응대해 주세요.\n\n${lines.join("\n") || "(대화 내역 없음)"}`,
    },
  ];
}

function normalizeBody(text, fallback = "확인이 필요합니다.") {
  const raw = typeof text === "string" ? text.trim() : "";
  if (!raw) return fallback;
  return raw.slice(0, 500);
}

function sanitizeReasonCode(code) {
  const cleaned = String(code || "unknown")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_:-]/g, "_")
    .slice(0, 80);
  return cleaned || "unknown";
}

async function insertSystemMessage(client, { conversationId, senderId, body, escalationReason = null }) {
  const seqRes = await client.query(
    `UPDATE conversations
     SET last_seq = last_seq + 1, updated_at = now()
     WHERE id = $1
     RETURNING last_seq`,
    [conversationId]
  );
  const nextSeq = Number(seqRes.rows[0].last_seq);
  const msgId = randomUUID();
  await client.query(
    `INSERT INTO messages (id, conversation_id, sender_id, seq, body, sender_kind, escalation_reason)
     VALUES ($1, $2, $3, $4, $5, 'system', $6)`,
    [msgId, conversationId, senderId, nextSeq, normalizeBody(body), escalationReason]
  );
  return { id: msgId, seq: nextSeq };
}

function isBudgetExceededForRent({ maxBudget, dailyPrice, days, totalPrice, agreedPrice }) {
  if (maxBudget === null || maxBudget === undefined || !Number.isFinite(Number(maxBudget))) return false;
  const budget = Number(maxBudget);
  const checkTotal = agreedPrice ?? totalPrice;
  if (checkTotal <= budget && dailyPrice <= budget) return false;
  if (dailyPrice > 0 && budget <= dailyPrice * 1.5) {
    const effectiveDaily =
      agreedPrice != null && agreedPrice <= dailyPrice * 1.5 && days > 1
        ? agreedPrice
        : Math.ceil(checkTotal / Math.max(1, days));
    return dailyPrice > budget || effectiveDaily > budget;
  }
  return checkTotal > budget;
}

function isPriceBelowMinimumForRent({ minPrice, dailyPrice, days, totalPrice, agreedPrice }) {
  if (minPrice === null || minPrice === undefined || !Number.isFinite(Number(minPrice))) return false;
  const floor = Number(minPrice);
  const checkTotal = agreedPrice ?? totalPrice;
  if (dailyPrice > 0 && floor <= dailyPrice * 1.5) {
    const effectiveDaily =
      agreedPrice != null && agreedPrice <= dailyPrice * 1.5 && days > 1
        ? agreedPrice
        : Math.floor(checkTotal / Math.max(1, days));
    return effectiveDaily < floor;
  }
  return checkTotal < floor;
}

async function persistEscalation(client, {
  cleanConvId,
  targetUserId,
  targetRole,
  effectiveTriggerSeq,
  reasonCode,
  summaryForUser,
  suggestedReplyDraft = null,
}) {
  const cleanCode = sanitizeReasonCode(reasonCode);
  const cleanSummary = normalizeBody(summaryForUser, "사용자 확인이 필요해 자동 응대를 멈췄습니다.");
  const cleanDraft = typeof suggestedReplyDraft === "string" && suggestedReplyDraft.trim()
    ? suggestedReplyDraft.trim().slice(0, 500)
    : null;
  const pauseReason = `escalated:${cleanCode}`;
  const draftPayload = {
    targetUserId,
    targetRole,
    replyToSeq: effectiveTriggerSeq,
    waitingForUser: true,
    reasonCode: cleanCode,
    summaryForUser: cleanSummary,
    suggestedReplyDraft: cleanDraft,
    body: cleanDraft,
    confidence: "low",
    rationale: cleanCode,
    createdAt: new Date().toISOString(),
  };

  await client.query(
    `UPDATE conversations
     SET ai_paused_reason = $2,
         ai_last_run_at = now(),
         ai_draft_json = $3::jsonb,
         updated_at = now()
     WHERE id = $1`,
    [cleanConvId, pauseReason, JSON.stringify(draftPayload)]
  );
  const sysMsg = await insertSystemMessage(client, {
    conversationId: cleanConvId,
    senderId: targetUserId,
    body: cleanSummary,
    escalationReason: cleanCode,
  });
  return {
    action: "escalated",
    reasonCode: cleanCode,
    aiPausedReason: pauseReason,
    waitingForUser: true,
    escalationSummary: cleanSummary,
    suggestedReplyDraft: cleanDraft,
    systemMessageId: sysMsg.id,
    systemMessageSeq: sysMsg.seq,
  };
}

export async function runDelegatedChatReply({
  conversationId,
  triggerSeq = null,
  targetRole,
  forceDraft = false,
  pool = getPool(),
  call = callLLM,
  getWeather = getWeatherAndMapConfig,
  today = kstToday(),
  onScheduleNext = null,
} = {}) {
  const cleanConvId = requireUuid(conversationId, "대화방 ID");
  if (targetRole !== "buyer" && targetRole !== "owner") {
    throw new Error(`Invalid targetRole: ${targetRole}`);
  }

  if (call === callLLM && !llmEnabled()) {
    return { skipped: true, reason: "LLM_UNAVAILABLE" };
  }

  // 1단계: 짧은 트랜잭션으로 락·사전 조건 검증 후 즉시 트랜잭션 종료 (LLM 호출 중 락 점유 금지)
  const preflight = await withTransaction(async (client) => {
    const lockKey = `${cleanConvId}:${triggerSeq ?? "latest"}:${targetRole}`;
    const lockRes = await client.query(`SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired`, [lockKey]);
    if (!lockRes.rows[0]?.acquired) {
      return { skip: { skipped: true, reason: "LOCK_BUSY" } };
    }

    const convRes = await client.query(
      `SELECT c.*,
              l.owner_id,
              l.title AS listing_title,
              l.type AS listing_type,
              l.status AS listing_status
       FROM conversations c
       JOIN listings l ON l.id = c.listing_id
       WHERE c.id = $1
       FOR UPDATE OF c`,
      [cleanConvId]
    );
    if (!convRes.rows.length) {
      return { skip: { skipped: true, reason: "CONVERSATION_NOT_FOUND" } };
    }
    const conv = convRes.rows[0];
    const targetUserId = targetRole === "buyer" ? conv.buyer_id : conv.owner_id;
    const rawMode = targetRole === "buyer" ? conv.buyer_ai_mode : conv.owner_ai_mode;
    const isDemoOwnerAuto =
      targetRole === "owner" && conv.owner_id === DEMO_OWNER_ID && conv.buyer_ai_mode === "autonomous";
    const mode = rawMode !== "off" ? rawMode : (isDemoOwnerAuto ? "autonomous" : "off");
    const policy = (targetRole === "buyer" ? conv.buyer_ai_policy : conv.owner_ai_policy) || {};

    if (mode === "off") {
      return { skip: { skipped: true, reason: "AI_MODE_OFF" } };
    }
    if (!forceDraft && conv.ai_paused_reason) {
      return { skip: { skipped: true, reason: "AI_PAUSED", aiPausedReason: conv.ai_paused_reason } };
    }

    const effectiveTriggerSeq = triggerSeq != null ? Number(triggerSeq) : Number(conv.last_seq);
    const msgRes = await client.query(
      `SELECT id, seq, sender_id, body, sender_kind, ai_confidence, reply_to_seq, escalation_reason, created_at
       FROM messages
       WHERE conversation_id = $1
       ORDER BY seq DESC
       LIMIT 20`,
      [cleanConvId]
    );
    const historyRows = msgRes.rows.slice().reverse();
    const triggerMsg = historyRows.find((m) => Number(m.seq) === effectiveTriggerSeq) || historyRows[historyRows.length - 1] || null;

    if (!forceDraft) {
      const dupRes = await client.query(
        `SELECT 1 FROM messages
         WHERE conversation_id = $1 AND reply_to_seq = $2 AND sender_id = $3 AND sender_kind = 'ai_proxy'
         LIMIT 1`,
        [cleanConvId, effectiveTriggerSeq, targetUserId]
      );
      if (dupRes.rows.length) {
        return { skip: { skipped: true, reason: "ALREADY_REPLIED" } };
      }
      if (Number(conv.last_seq) > effectiveTriggerSeq) {
        return { skip: { skipped: true, reason: "STALE_TRIGGER" } };
      }
      if (!triggerMsg) {
        return { skip: { skipped: true, reason: "NO_TRIGGER_MESSAGE" } };
      }
      if (triggerMsg.sender_kind === "system") {
        return { skip: { skipped: true, reason: "SYSTEM_MESSAGE_IGNORED" } };
      }
      if (triggerMsg.sender_id === targetUserId) {
        return { skip: { skipped: true, reason: "SELF_MESSAGE_IGNORED" } };
      }
      if (
        mode === "copilot" &&
        conv.ai_draft_json &&
        conv.ai_draft_json.targetUserId === targetUserId &&
        Number(conv.ai_draft_json.replyToSeq) === effectiveTriggerSeq
      ) {
        return { skip: { skipped: true, reason: "DRAFT_ALREADY_EXISTS" } };
      }

      const defaultMaxTurns = policy.fullDelegation ? 6 : DEFAULT_MAX_AI_TURNS;
      const maxTurns = Number(policy.maxConsecutiveAiTurns) > 0
        ? Math.min(10, Math.trunc(Number(policy.maxConsecutiveAiTurns)))
        : defaultMaxTurns;

      if (mode === "autonomous" && Number(conv.ai_consecutive_turns) >= maxTurns) {
        const isBothAi = triggerMsg.sender_kind === "ai_proxy";
        const pauseReason = isBothAi ? "both_ai_handoff" : "max_turns_reached";
        const summaryBody = isBothAi
          ? "농농이끼리 핵심 조건을 정리했어요. 확인 후 대여 요청이나 답장을 진행해 주세요."
          : "연속 AI 응대 횟수 상한에 도달해 자동 응대를 멈췄어요. 직접 답장하시면 대화가 이어집니다.";
        await client.query(
          `UPDATE conversations SET ai_paused_reason = $2, updated_at = now() WHERE id = $1`,
          [cleanConvId, pauseReason]
        );
        await insertSystemMessage(client, {
          conversationId: cleanConvId,
          senderId: targetUserId,
          body: summaryBody,
          escalationReason: pauseReason,
        });
        return { skip: { skipped: true, paused: true, reason: pauseReason } };
      }
    }

    return {
      skip: null,
      conv,
      targetUserId,
      mode,
      policy,
      effectiveTriggerSeq,
      triggerMsg,
      historyRows,
    };
  }, pool);

  if (preflight.skip) {
    return preflight.skip;
  }

  const { conv, targetUserId, mode, policy, effectiveTriggerSeq, triggerMsg, historyRows } = preflight;

  // 2단계: DB 락 없이 읽기 전용 컨텍스트 로드 및 LLM 도구 루프 실행
  const listing = await fetchListingById(conv.listing_id, { viewerId: targetUserId, includeRemoved: true, pool });
  const ownedRes = await pool.query(
    `SELECT model_id, name, is_selected FROM owned_machines WHERE user_id = $1 ORDER BY is_selected DESC, created_at ASC`,
    [conv.buyer_id]
  );
  const ownedMachines = ownedRes.rows.map((r) => ({
    modelId: r.model_id,
    name: r.name,
    isSelected: Boolean(r.is_selected),
  }));
  const selectedOwned = ownedMachines.find((m) => m.isSelected) || ownedMachines[0] || null;
  const farmRes = await pool.query(
    `SELECT region, crop_ids, area_pyeong, notes FROM farm_profiles WHERE user_id = $1 LIMIT 1`,
    [conv.buyer_id]
  ).catch(() => ({ rows: [] }));
  const farmProfile = farmRes.rows[0] || null;

  const systemPrompt = buildSystemPrompt({
    targetRole,
    conv,
    listing,
    policy,
    ownedMachines,
    farmProfile,
    today,
  });
  const llmMessages = buildConversationMessages(historyRows, targetUserId);

  const isAutoExecutePolicy = Boolean(policy.fullDelegation && policy.autoExecuteTransaction !== false);

  const buildCompleteTransactionAction = (input) => {
    if (!listing || listing.status !== "open" || (listing.type === "rent" && listing.condition === "repair")) {
      return {
        action: {
          kind: "escalate_to_user",
          reasonCode: "listing_unavailable",
          summaryForUser: "매물이 현재 거래 가능한 상태가 아니어서 자동 거래를 멈췄어요. 직접 확인해 주세요.",
          suggestedReplyDraft: null,
        },
        output: { ok: false, error: "매물이 현재 거래 가능한 상태가 아닙니다." },
      };
    }

    const note = typeof input?.note === "string" ? input.note.trim().slice(0, 500) : "";
    const closingReply = typeof input?.closingReply === "string" && input.closingReply.trim()
      ? normalizeBody(input.closingReply)
      : "";

    if (listing.type === "rent") {
      const startRaw = input?.start || policy.targetStart;
      const endRaw = input?.end || policy.targetEnd || startRaw;
      const avail = checkListingAvailability(listing, startRaw, endRaw, today);
      if (avail.error || !avail.available) {
        return {
          action: {
            kind: "escalate_to_user",
            reasonCode: avail.error ? "invalid_schedule" : "schedule_conflict",
            summaryForUser: avail.error
              ? `일정(${startRaw || "미정"}) 확인이 필요해 자동 접수를 멈췄어요: ${avail.error}`
              : `희망 기간(${avail.start} ~ ${avail.end})이 기존 예약과 겹쳐 자동 접수를 멈췄어요.${avail.nearestFree ? ` 가능한 일정: ${avail.nearestFree.start} ~ ${avail.nearestFree.end}` : ""}`,
            suggestedReplyDraft: avail.nearestFree
              ? `말씀하신 날짜는 예약이 있어 ${avail.nearestFree.start} ~ ${avail.nearestFree.end} 일정으로 가능할까요?`
              : null,
          },
          output: avail.error ? avail : { ok: false, available: false, bookedRanges: avail.bookedRanges, nearestFree: avail.nearestFree },
        };
      }

      const dailyPrice = Number(listing.price ?? 0);
      const totalPrice = dailyPrice * avail.days;
      const rawAgreed = Number.isFinite(Number(input?.agreedPrice)) && Number(input?.agreedPrice) >= 0
        ? Math.trunc(Number(input.agreedPrice))
        : (Number.isFinite(Number(input?.estimatedPrice)) && Number(input?.estimatedPrice) >= 0
          ? Math.trunc(Number(input.estimatedPrice))
          : totalPrice);

      if (targetRole === "buyer" && policy.maxBudget !== null && policy.maxBudget !== undefined) {
        if (isBudgetExceededForRent({
          maxBudget: Number(policy.maxBudget),
          dailyPrice,
          days: avail.days,
          totalPrice,
          agreedPrice: rawAgreed,
        })) {
          return {
            action: {
              kind: "escalate_to_user",
              reasonCode: "budget_exceeded",
              summaryForUser: `예산 상한(${Number(policy.maxBudget).toLocaleString("ko-KR")}원)을 초과해 자동 거래를 진행하지 않고 확인을 기다리고 있어요. (제안 금액: ${rawAgreed.toLocaleString("ko-KR")}원)`,
              suggestedReplyDraft: null,
            },
            output: { ok: false, error: "budget_exceeded", maxBudget: policy.maxBudget, agreedPrice: rawAgreed },
          };
        }
      }

      if (targetRole === "owner" && policy.minPrice !== null && policy.minPrice !== undefined) {
        if (isPriceBelowMinimumForRent({
          minPrice: Number(policy.minPrice),
          dailyPrice,
          days: avail.days,
          totalPrice,
          agreedPrice: rawAgreed,
        })) {
          return {
            action: {
              kind: "escalate_to_user",
              reasonCode: "price_below_minimum",
              summaryForUser: `최소 수락 금액(${Number(policy.minPrice).toLocaleString("ko-KR")}원)보다 낮아 자동 거래를 멈췄어요. (제안 금액: ${rawAgreed.toLocaleString("ko-KR")}원)`,
              suggestedReplyDraft: null,
            },
            output: { ok: false, error: "price_below_minimum", minPrice: policy.minPrice, agreedPrice: rawAgreed },
          };
        }
      }

      return {
        action: {
          kind: "complete_delegated_transaction",
          listingType: "rent",
          start: avail.start,
          end: avail.end,
          days: avail.days,
          dailyPrice,
          estimatedPrice: totalPrice,
          agreedPrice: rawAgreed,
          note,
          closingReply,
        },
        output: {
          ok: true,
          queued: "complete_delegated_transaction",
          kind: "rental",
          start: avail.start,
          end: avail.end,
          days: avail.days,
          estimatedPrice: totalPrice,
        },
      };
    }

    // listing.type === "sale"
    const listingPrice = Number(listing.price ?? 0);
    const agreedPrice = Number.isFinite(Number(input?.agreedPrice)) && Number(input?.agreedPrice) >= 0
      ? Math.trunc(Number(input.agreedPrice))
      : listingPrice;

    if (targetRole === "buyer" && policy.maxBudget !== null && policy.maxBudget !== undefined && agreedPrice > Number(policy.maxBudget)) {
      return {
        action: {
          kind: "escalate_to_user",
          reasonCode: "budget_exceeded",
          summaryForUser: `예산 상한(${Number(policy.maxBudget).toLocaleString("ko-KR")}원)을 초과해 자동 구매 신청을 멈췄어요. (판매가/제안가: ${agreedPrice.toLocaleString("ko-KR")}원)`,
          suggestedReplyDraft: null,
        },
        output: { ok: false, error: "budget_exceeded", maxBudget: policy.maxBudget, agreedPrice },
      };
    }

    if (targetRole === "owner" && policy.minPrice !== null && policy.minPrice !== undefined && agreedPrice < Number(policy.minPrice)) {
      return {
        action: {
          kind: "escalate_to_user",
          reasonCode: "price_below_minimum",
          summaryForUser: `최소 수락 금액(${Number(policy.minPrice).toLocaleString("ko-KR")}원)보다 낮아 자동 거래를 멈췄어요.`,
          suggestedReplyDraft: null,
        },
        output: { ok: false, error: "price_below_minimum", minPrice: policy.minPrice, agreedPrice },
      };
    }

    return {
      action: {
        kind: "complete_delegated_transaction",
        listingType: "sale",
        agreedPrice,
        pickup: typeof policy.pickupPreference === "string" && policy.pickupPreference
          ? policy.pickupPreference.slice(0, 120)
          : (listing.pickup || "").slice(0, 120),
        note,
        closingReply,
      },
      output: {
        ok: true,
        queued: "complete_delegated_transaction",
        kind: "purchase",
        agreedPrice,
      },
    };
  };

  let terminalAction = null;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = await call({
      system: systemPrompt,
      messages: llmMessages,
      tools: DELEGATED_CHAT_TOOLS,
      maxTokens: 700,
      timeoutMs: 20_000,
    });

    if (!response || !Array.isArray(response.content)) {
      return { skipped: true, reason: "LLM_FAILED" };
    }

    const toolUses = response.content.filter((b) => b.type === "tool_use");
    if (!toolUses.length) {
      const plainText = response.content
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text)
        .join("")
        .trim();
      if (plainText) {
        const looksUncertain = /(?:모르겠|확인이\s*필요|확인\s*후\s*답|직접\s*확인|답변드리기\s*어렵)/.test(plainText);
        terminalAction = {
          kind: "send_proxy_reply",
          body: normalizeBody(plainText),
          confidence: looksUncertain ? "low" : "medium",
          rationale: "direct_text_fallback",
        };
      }
      break;
    }

    const toolResults = [];
    for (const block of toolUses) {
      let output;
      if (block.name === "get_listing_context") {
        if (!listing || listing.status === "removed") {
          output = { error: "매물을 찾을 수 없거나 비공개 상태입니다." };
        } else {
          output = {
            listing: {
              id: listing.id,
              title: listing.title,
              type: listing.type,
              status: listing.status,
              price: listing.price,
              region: listing.region,
              condition: listing.condition,
              included: listing.included,
              pickup: listing.pickup,
              description: listing.description,
              modelId: listing.modelId,
              areaMin: listing.areaMin,
              areaMax: listing.areaMax,
              spec: listing.modelId && Object.hasOwn(SPEC_BY_ID, listing.modelId) ? SPEC_BY_ID[listing.modelId] : null,
            },
            targetRole,
            policy,
          };
        }
      } else if (block.name === "check_availability") {
        output = checkListingAvailability(listing, block.input?.start, block.input?.end, today);
      } else if (block.name === "get_weather") {
        output = await getWeather({
          region: block.input?.region || listing?.region || "영양읍",
          date: block.input?.date || "",
          endDate: block.input?.endDate || "",
          days: Number(block.input?.days) || 5,
        });
      } else if (block.name === "check_farm_compatibility") {
        output = listing
          ? checkFarmCompatibilityTool(
              {
                listingId: listing.id,
                areaPyeong: block.input?.areaPyeong ?? policy.areaPyeong ?? farmProfile?.area_pyeong,
                ownedModelId: block.input?.ownedModelId || policy.ownedModelId || selectedOwned?.modelId,
              },
              [listing],
              {
                ownedMachines,
                selectedOwnedModelId: selectedOwned?.modelId,
                areaPyeong: farmProfile?.area_pyeong,
              }
            )
          : { error: "매물을 찾을 수 없습니다." };
      } else if (block.name === "send_proxy_reply") {
        const confidence = VALID_CONFIDENCE.has(block.input?.confidence) ? block.input.confidence : "low";
        terminalAction = {
          kind: "send_proxy_reply",
          body: normalizeBody(block.input?.body),
          confidence,
          rationale: typeof block.input?.rationale === "string" ? block.input.rationale.slice(0, 300) : "",
        };
        output = { ok: true, queued: "send_proxy_reply" };
      } else if (block.name === "propose_rental_handoff") {
        if (isAutoExecutePolicy && mode === "autonomous" && !forceDraft) {
          const built = buildCompleteTransactionAction(block.input);
          terminalAction = built.action;
          output = built.output;
        } else {
          const avail = checkListingAvailability(listing, block.input?.start, block.input?.end, today);
          if (avail.error) {
            output = avail;
          } else {
            const estimatedPrice = Number.isFinite(Number(block.input?.estimatedPrice))
              ? Math.trunc(Number(block.input.estimatedPrice))
              : (listing?.price || 0) * avail.days;
            terminalAction = {
              kind: "propose_rental_handoff",
              start: avail.start,
              end: avail.end,
              days: avail.days,
              estimatedPrice,
              note: typeof block.input?.note === "string" ? block.input.note.trim().slice(0, 300) : "",
            };
            output = { ok: true, queued: "propose_rental_handoff", start: avail.start, end: avail.end, days: avail.days, estimatedPrice };
          }
        }
      } else if (block.name === "complete_delegated_transaction") {
        if (isAutoExecutePolicy && mode === "autonomous" && !forceDraft) {
          const built = buildCompleteTransactionAction(block.input);
          terminalAction = built.action;
          output = built.output;
        } else if (listing?.type === "rent") {
          const avail = checkListingAvailability(listing, block.input?.start || policy.targetStart, block.input?.end || policy.targetEnd || block.input?.start || policy.targetStart, today);
          if (avail.error) {
            output = avail;
          } else {
            const estimatedPrice = Number.isFinite(Number(block.input?.agreedPrice))
              ? Math.trunc(Number(block.input.agreedPrice))
              : (listing?.price || 0) * avail.days;
            terminalAction = {
              kind: "propose_rental_handoff",
              start: avail.start,
              end: avail.end,
              days: avail.days,
              estimatedPrice,
              note: typeof block.input?.note === "string" ? block.input.note.trim().slice(0, 300) : "",
            };
            output = { ok: true, queued: "propose_rental_handoff", start: avail.start, end: avail.end, days: avail.days, estimatedPrice };
          }
        } else {
          terminalAction = {
            kind: "escalate_to_user",
            reasonCode: "full_delegation_disabled",
            summaryForUser: "거래 전담 모드가 꺼져 있어 구매 신청을 직접 진행해 주세요.",
            suggestedReplyDraft: typeof block.input?.closingReply === "string" ? block.input.closingReply.trim().slice(0, 500) : null,
          };
          output = { ok: true, queued: "escalate_to_user" };
        }
      } else if (block.name === "escalate_to_user") {
        terminalAction = {
          kind: "escalate_to_user",
          reasonCode: sanitizeReasonCode(block.input?.reasonCode),
          summaryForUser: normalizeBody(block.input?.summaryForUser, "사용자 확인이 필요해 자동 응대를 멈췄습니다."),
          suggestedReplyDraft: typeof block.input?.suggestedReplyDraft === "string"
            ? block.input.suggestedReplyDraft.trim().slice(0, 500)
            : null,
        };
        output = { ok: true, queued: "escalate_to_user" };
      } else {
        output = { error: `Unknown tool: ${block.name}` };
      }

      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(output),
      });
    }

    if (terminalAction) break;

    llmMessages.push({ role: "assistant", content: response.content });
    llmMessages.push({ role: "user", content: toolResults });
  }

  if (!terminalAction) {
    return { skipped: true, reason: "LLM_NO_ACTION" };
  }

  // 3단계: 커밋 직전 짧은 트랜잭션으로 재검증 및 DB 반영
  try {
    const outcome = await withTransaction(async (client) => {
      const convRes = await client.query(`SELECT * FROM conversations WHERE id = $1 FOR UPDATE`, [cleanConvId]);
      if (!convRes.rows.length) {
        return { aborted: true, reason: "CONVERSATION_NOT_FOUND" };
      }
      const latestConv = convRes.rows[0];
      if (!forceDraft && Number(latestConv.last_seq) > effectiveTriggerSeq) {
        return { aborted: true, reason: "STALE_TRIGGER_ON_COMMIT" };
      }
      if (!forceDraft && latestConv.ai_paused_reason) {
        return { aborted: true, reason: "PAUSED_DURING_RUN" };
      }

      // low confidence in autonomous mode -> escalate instead of sending speculative reply
      if (terminalAction.kind === "send_proxy_reply" && terminalAction.confidence === "low" && !forceDraft && mode === "autonomous") {
        terminalAction = {
          kind: "escalate_to_user",
          reasonCode: "low_confidence",
          summaryForUser: "농농이가 확신이 부족해 답변하지 않고 기다리고 있어요. 직접 확인 후 답장해 주세요.",
          suggestedReplyDraft: terminalAction.body,
        };
      }

      if (terminalAction.kind === "escalate_to_user") {
        return persistEscalation(client, {
          cleanConvId,
          targetUserId,
          targetRole,
          effectiveTriggerSeq,
          reasonCode: terminalAction.reasonCode,
          summaryForUser: terminalAction.summaryForUser,
          suggestedReplyDraft: terminalAction.suggestedReplyDraft,
        });
      }

      if (terminalAction.kind === "complete_delegated_transaction") {
        const listRes = await client.query(`SELECT * FROM listings WHERE id = $1 FOR UPDATE`, [latestConv.listing_id]);
        const listingRow = listRes.rows[0];
        if (!listingRow || listingRow.status !== "open" || latestConv.buyer_id === listingRow.owner_id) {
          return persistEscalation(client, {
            cleanConvId,
            targetUserId,
            targetRole,
            effectiveTriggerSeq,
            reasonCode: "listing_unavailable",
            summaryForUser: "매물 상태가 변경되어 자동 거래를 진행하지 못했어요. 직접 확인해 주세요.",
          });
        }

        let createdRental = null;
        let createdPurchase = null;
        let handoffPayload = null;
        let completionMeta = null;

        if (listingRow.type === "rent") {
          if (listingRow.condition === "repair") {
            return persistEscalation(client, {
              cleanConvId,
              targetUserId,
              targetRole,
              effectiveTriggerSeq,
              reasonCode: "listing_unavailable",
              summaryForUser: "매물이 정비 중 상태여서 자동 대여 신청을 멈췄어요.",
            });
          }
          if (!Number.isInteger(terminalAction.days) || terminalAction.days < 1 || terminalAction.days > MAX_RENTAL_DAYS) {
            return persistEscalation(client, {
              cleanConvId,
              targetUserId,
              targetRole,
              effectiveTriggerSeq,
              reasonCode: "invalid_schedule",
              summaryForUser: `대여 기간은 최대 ${MAX_RENTAL_DAYS}일까지 요청할 수 있어 자동 접수를 멈췄어요.`,
            });
          }
          const overlapRes = await client.query(
            `SELECT 1 FROM rental_requests
             WHERE listing_id = $1 AND status = 'approved'
               AND NOT (end_date < $2::date OR start_date > $3::date)
             LIMIT 1`,
            [listingRow.id, terminalAction.start, terminalAction.end]
          );
          if (overlapRes.rows.length) {
            return persistEscalation(client, {
              cleanConvId,
              targetUserId,
              targetRole,
              effectiveTriggerSeq,
              reasonCode: "schedule_conflict",
              summaryForUser: `합의 중이던 기간(${terminalAction.start} ~ ${terminalAction.end})이 다른 예약과 겹쳐 자동 접수를 멈췄어요.`,
            });
          }

          const rentalId = randomUUID();
          const dailyPrice = Number(listingRow.price);
          const days = terminalAction.days;
          const totalPrice = dailyPrice * days;
          const note = (terminalAction.note || "거래 전담 모드로 자동 접수된 대여 요청입니다.").slice(0, 500);

          const insRes = await client.query(
            `INSERT INTO rental_requests (
              id, listing_id, requester_id, start_date, end_date,
              note, daily_price, days, total_price, status
            ) VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, $8, $9, 'pending')
            RETURNING *`,
            [rentalId, listingRow.id, latestConv.buyer_id, terminalAction.start, terminalAction.end, note, dailyPrice, days, totalPrice]
          );
          const row = insRes.rows[0];
          createdRental = {
            id: String(row.id),
            listingId: row.listing_id,
            requesterId: row.requester_id,
            start: formatIsoDate(row.start_date),
            end: formatIsoDate(row.end_date),
            note: row.note ?? "",
            dailyPrice: Number(row.daily_price),
            days: Number(row.days),
            totalPrice: Number(row.total_price),
            status: row.status,
          };
          handoffPayload = {
            type: "rental_handoff",
            listingId: listingRow.id,
            start: createdRental.start,
            end: createdRental.end,
            days: createdRental.days,
            dailyPrice: createdRental.dailyPrice,
            estimatedPrice: createdRental.totalPrice,
            note: createdRental.note,
          };
          completionMeta = {
            kind: "rental",
            listingId: listingRow.id,
            rentalRequestId: createdRental.id,
            start: createdRental.start,
            end: createdRental.end,
            days: createdRental.days,
            totalPrice: createdRental.totalPrice,
            completedAt: new Date().toISOString(),
          };
        } else {
          // sale listing -> purchase_orders
          const acceptedRes = await client.query(
            `SELECT id FROM purchase_orders WHERE listing_id = $1 AND status = 'accepted' LIMIT 1`,
            [listingRow.id]
          );
          if (acceptedRes.rows.length) {
            return persistEscalation(client, {
              cleanConvId,
              targetUserId,
              targetRole,
              effectiveTriggerSeq,
              reasonCode: "listing_unavailable",
              summaryForUser: "이미 수락된 구매 신청이 있어 자동 구매 접수를 멈췄어요.",
            });
          }

          const price = Number.isFinite(Number(terminalAction.agreedPrice))
            ? Math.max(0, Math.trunc(Number(terminalAction.agreedPrice)))
            : Number(listingRow.price);
          const pickup = (terminalAction.pickup || listingRow.pickup || "").slice(0, 120);
          const note = (terminalAction.note || "거래 전담 모드로 자동 접수된 구매 신청입니다.").slice(0, 500);

          const pendingRes = await client.query(
            `SELECT id FROM purchase_orders WHERE listing_id = $1 AND buyer_id = $2 AND status = 'pending' LIMIT 1`,
            [listingRow.id, latestConv.buyer_id]
          );
          let poRow;
          if (pendingRes.rows.length) {
            const upd = await client.query(
              `UPDATE purchase_orders SET price = $2, pickup = $3, note = $4 WHERE id = $1 RETURNING *`,
              [pendingRes.rows[0].id, price, pickup, note]
            );
            poRow = upd.rows[0];
          } else {
            const poId = randomUUID();
            const ins = await client.query(
              `INSERT INTO purchase_orders (id, listing_id, buyer_id, price, pickup, note, status)
               VALUES ($1, $2, $3, $4, $5, $6, 'pending')
               RETURNING *`,
              [poId, listingRow.id, latestConv.buyer_id, price, pickup, note]
            );
            poRow = ins.rows[0];
          }
          createdPurchase = {
            id: String(poRow.id),
            listingId: poRow.listing_id,
            buyerId: poRow.buyer_id,
            price: Number(poRow.price),
            pickup: poRow.pickup ?? "",
            note: poRow.note ?? "",
            status: poRow.status,
          };
          completionMeta = {
            kind: "purchase",
            listingId: listingRow.id,
            purchaseOrderId: createdPurchase.id,
            price: createdPurchase.price,
            completedAt: new Date().toISOString(),
          };
        }

        const draftMetaJson = JSON.stringify({ completedTransaction: completionMeta });
        let closingMsg = null;

        if (terminalAction.closingReply) {
          const seqRes = await client.query(
            `UPDATE conversations
             SET last_seq = last_seq + 1,
                 updated_at = now(),
                 ai_consecutive_turns = ai_consecutive_turns + 1,
                 ai_paused_reason = 'transaction_completed',
                 ai_last_run_at = now(),
                 ai_draft_json = $2::jsonb
             WHERE id = $1
             RETURNING last_seq`,
            [cleanConvId, draftMetaJson]
          );
          const nextSeq = Number(seqRes.rows[0].last_seq);
          const msgId = randomUUID();
          await client.query(
            `INSERT INTO messages (id, conversation_id, sender_id, seq, body, sender_kind, ai_confidence, reply_to_seq)
             VALUES ($1, $2, $3, $4, $5, 'ai_proxy', 'high', $6)`,
            [msgId, cleanConvId, targetUserId, nextSeq, terminalAction.closingReply, effectiveTriggerSeq]
          );
          closingMsg = { id: msgId, seq: nextSeq, body: terminalAction.closingReply };
        } else {
          await client.query(
            `UPDATE conversations
             SET ai_paused_reason = 'transaction_completed',
                 ai_last_run_at = now(),
                 ai_draft_json = $2::jsonb,
                 updated_at = now()
             WHERE id = $1`,
            [cleanConvId, draftMetaJson]
          );
          const summaryBody = createdRental
            ? `[거래 전담 자동 접수] ${createdRental.start} ~ ${createdRental.end} (${createdRental.days}일, ${createdRental.totalPrice.toLocaleString("ko-KR")}원) 대여 요청이 접수되었습니다.`
            : `[거래 전담 자동 접수] ${createdPurchase.price.toLocaleString("ko-KR")}원 구매 신청이 접수되었습니다.`;
          await insertSystemMessage(client, {
            conversationId: cleanConvId,
            senderId: targetUserId,
            body: summaryBody,
            escalationReason: "transaction_completed",
          });
        }

        if (createdRental) {
          return {
            action: "transaction_completed",
            kind: "rental",
            rentalRequest: createdRental,
            handoff: handoffPayload,
            aiPausedReason: "transaction_completed",
            ...(closingMsg ? { messageId: closingMsg.id, seq: closingMsg.seq, body: closingMsg.body, replyToSeq: effectiveTriggerSeq } : {}),
          };
        }
        return {
          action: "transaction_completed",
          kind: "purchase",
          purchaseOrder: createdPurchase,
          aiPausedReason: "transaction_completed",
          ...(closingMsg ? { messageId: closingMsg.id, seq: closingMsg.seq, body: closingMsg.body, replyToSeq: effectiveTriggerSeq } : {}),
        };
      }

      if (terminalAction.kind === "propose_rental_handoff") {
        const handoffPayload = {
          type: "rental_handoff",
          listingId: conv.listing_id,
          start: terminalAction.start,
          end: terminalAction.end,
          days: terminalAction.days,
          dailyPrice: listing?.price ?? 0,
          estimatedPrice: terminalAction.estimatedPrice,
          note: terminalAction.note,
        };
        if (mode === "copilot" || forceDraft) {
          const draft = {
            targetUserId,
            targetRole,
            replyToSeq: effectiveTriggerSeq,
            body: `${terminalAction.start} ~ ${terminalAction.end} (${terminalAction.days}일, 예상 ${terminalAction.estimatedPrice.toLocaleString("ko-KR")}원) 조건으로 대여 요청을 진행할까요?`,
            confidence: "high",
            rationale: "rental_handoff",
            suggestedHandoff: handoffPayload,
            createdAt: new Date().toISOString(),
          };
          await client.query(
            `UPDATE conversations SET ai_draft_json = $2::jsonb, ai_last_run_at = now(), updated_at = now() WHERE id = $1`,
            [cleanConvId, JSON.stringify(draft)]
          );
          return { action: "draft_saved", draft };
        }

        const handoffText = normalizeBody(
          `[대여 요청 제안] ${terminalAction.start} ~ ${terminalAction.end} (${terminalAction.days}일, 예상 ${terminalAction.estimatedPrice.toLocaleString("ko-KR")}원)${terminalAction.note ? ` · ${terminalAction.note}` : ""}`
        );
        const isBothAi = triggerMsg?.sender_kind === "ai_proxy";
        if (isBothAi) {
          await client.query(
            `UPDATE conversations SET ai_paused_reason = 'both_ai_handoff', ai_last_run_at = now(), updated_at = now() WHERE id = $1`,
            [cleanConvId]
          );
        } else {
          await client.query(
            `UPDATE conversations SET ai_last_run_at = now(), updated_at = now() WHERE id = $1`,
            [cleanConvId]
          );
        }
        const sysMsg = await insertSystemMessage(client, {
          conversationId: cleanConvId,
          senderId: targetUserId,
          body: handoffText,
          escalationReason: isBothAi ? "both_ai_handoff" : "rental_handoff",
        });
        return {
          action: "handoff_proposed",
          handoff: handoffPayload,
          systemMessageId: sysMsg.id,
          systemMessageSeq: sysMsg.seq,
          aiPausedReason: isBothAi ? "both_ai_handoff" : null,
        };
      }

      // send_proxy_reply
      if (mode === "copilot" || forceDraft) {
        const draft = {
          targetUserId,
          targetRole,
          replyToSeq: effectiveTriggerSeq,
          body: terminalAction.body,
          confidence: terminalAction.confidence,
          rationale: terminalAction.rationale,
          createdAt: new Date().toISOString(),
        };
        await client.query(
          `UPDATE conversations
           SET ai_draft_json = $2::jsonb,
               ai_last_run_at = now(),
               updated_at = now()
           WHERE id = $1`,
          [cleanConvId, JSON.stringify(draft)]
        );
        return { action: "draft_saved", draft };
      }

      // autonomous send
      const seqRes = await client.query(
        `UPDATE conversations
         SET last_seq = last_seq + 1,
             updated_at = now(),
             ai_consecutive_turns = ai_consecutive_turns + 1,
             ai_last_run_at = now(),
             ai_draft_json = CASE WHEN ai_draft_json->>'targetUserId' = $2 THEN NULL ELSE ai_draft_json END
         WHERE id = $1
         RETURNING last_seq, ai_consecutive_turns`,
        [cleanConvId, targetUserId]
      );
      const nextSeq = Number(seqRes.rows[0].last_seq);
      const nextTurns = Number(seqRes.rows[0].ai_consecutive_turns);
      const msgId = randomUUID();
      await client.query(
        `INSERT INTO messages (id, conversation_id, sender_id, seq, body, sender_kind, ai_confidence, reply_to_seq)
         VALUES ($1, $2, $3, $4, $5, 'ai_proxy', $6, $7)`,
        [msgId, cleanConvId, targetUserId, nextSeq, terminalAction.body, terminalAction.confidence, effectiveTriggerSeq]
      );

      const otherRole = targetRole === "buyer" ? "owner" : "buyer";
      const rawOtherMode = otherRole === "buyer" ? latestConv.buyer_ai_mode : latestConv.owner_ai_mode;
      const otherIsDemoOwnerAuto =
        otherRole === "owner" && conv.owner_id === DEMO_OWNER_ID && latestConv.buyer_ai_mode === "autonomous";
      const otherMode = rawOtherMode !== "off" ? rawOtherMode : (otherIsDemoOwnerAuto ? "autonomous" : "off");
      const shouldChainNext = otherMode === "autonomous" && !latestConv.ai_paused_reason;

      return {
        action: "replied",
        messageId: msgId,
        seq: nextSeq,
        replyToSeq: effectiveTriggerSeq,
        confidence: terminalAction.confidence,
        body: terminalAction.body,
        aiConsecutiveTurns: nextTurns,
        nextTargetRole: shouldChainNext ? otherRole : null,
      };
    }, pool);

    if (outcome?.action === "replied" && outcome.nextTargetRole && typeof onScheduleNext === "function") {
      await onScheduleNext({
        conversationId: cleanConvId,
        triggerSeq: outcome.seq,
        targetRole: outcome.nextTargetRole,
      });
    }

    return outcome;
  } catch (error) {
    if (error?.code === "23505") {
      return { skipped: true, reason: "ALREADY_REPLIED" };
    }
    throw error;
  }
}

export async function scheduleDelegatedReply(params) {
  const task = Promise.resolve()
    .then(() =>
      runDelegatedChatReply({
        ...params,
        onScheduleNext: (nextParams) => scheduleDelegatedReply(nextParams),
      })
    )
    .catch((error) => {
      console.warn("delegated_chat_reply_failed", {
        conversationId: params?.conversationId,
        targetRole: params?.targetRole,
        message: error?.message,
      });
      return null;
    });

  await scheduleWaitUntil(task);
  return { task };
}
