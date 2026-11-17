import { randomUUID } from "node:crypto";
import { getPool, kstToday, withTransaction } from "./db.js";
import { callLLM, llmEnabled } from "./llm.js";
import { fetchListingById } from "./listings-db.js";
import { checkFarmCompatibilityTool } from "./nongnong-agent.js";
import { normalizeText, requireUuid } from "./validate.js";
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
    description: "일정과 조건이 합의되었을 때 대여 요청 확인 카드를 생성합니다. 실제 대여 신청은 사용자가 버튼으로 확정합니다.",
    input_schema: {
      type: "object",
      properties: {
        start: { type: "string", description: "합의된 시작일 (YYYY-MM-DD)" },
        end: { type: "string", description: "합의된 반납일 (YYYY-MM-DD)" },
        estimatedPrice: { type: "number", description: "예상 금액(원)" },
        note: { type: "string", description: "합의된 인수 조건·메모" },
      },
      required: ["start", "end"],
    },
  },
  {
    name: "escalate_to_user",
    description: "가격 흥정, 하자 보증, 상세 주소/연락처 요구, 매물 정보에 없는 질문, 확신 부족 시 자동 응대를 멈추고 사용자에게 확인을 요청합니다.",
    input_schema: {
      type: "object",
      properties: {
        reasonCode: {
          type: "string",
          description: "사유 코드 (예: price_negotiation, warranty_claim, privacy_info, unknown_condition, low_confidence, policy_exceeded)",
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

function buildSystemPrompt({ targetRole, conv, listing, policy, ownedMachines, farmProfile, today }) {
  const roleLabel = targetRole === "owner" ? "매물 소유자(판매/임대인)" : "구매자(대여자)";
  const spec = listing?.modelId && Object.hasOwn(SPEC_BY_ID, listing.modelId) ? SPEC_BY_ID[listing.modelId] : null;
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
    `[위임 정책]`,
    JSON.stringify(policy || {}),
    ownedMachines?.length ? `[구매자 보유 농기계] ${JSON.stringify(ownedMachines)}` : "",
    farmProfile ? `[구매자 농가 프로필] ${JSON.stringify(farmProfile)}` : "",
    ``,
    `[필수 가드레일]`,
    `1. 가격 할인·흥정은 정책에 allowNegotiation=true 및 minPrice가 명시되지 않은 한 절대 임의로 수락하지 말고 escalate_to_user를 호출하라.`,
    `2. 하자 보증, 수리비 부담, 법적/안전 책임 확약, 상세 주소(지번/도로명)·전화번호·계좌번호 공개 요청 시 즉시 escalate_to_user를 호출하라.`,
    `3. 매물 정보·예약 현황·위임 정책에 없는 실물 상태(타이어 마모도, 최근 수리 이력 등)를 추측해 답하지 말고 escalate_to_user를 호출하라.`,
    `4. 최종 대여 승인·결제 확정은 절대 직접 실행하지 말고, 일정/조건 합의 시 propose_rental_handoff를 호출하라.`,
    `5. 매 턴 마지막에는 반드시 send_proxy_reply, propose_rental_handoff, 또는 escalate_to_user 중 하나를 호출해 종료하라. 답변은 500자 이내 한국어로 작성하라.`,
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
    const mode = targetRole === "buyer" ? conv.buyer_ai_mode : conv.owner_ai_mode;
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

      const maxTurns = Number(policy.maxConsecutiveAiTurns) > 0
        ? Math.min(10, Math.trunc(Number(policy.maxConsecutiveAiTurns)))
        : DEFAULT_MAX_AI_TURNS;

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

  let terminalAction = null;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = await call({
      system: systemPrompt,
      messages: llmMessages,
      tools: DELEGATED_CHAT_TOOLS,
      maxTokens: 700,
      timeoutMs: 12_000,
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
        terminalAction = {
          kind: "send_proxy_reply",
          body: normalizeBody(plainText),
          confidence: "medium",
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
                ownedModelId: block.input?.ownedModelId ?? policy.ownedModelId,
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
          summaryForUser: "농농이가 확신이 부족해 자동 답변을 멈췄어요. 직접 확인 후 답장해 주세요.",
          suggestedReplyDraft: terminalAction.body,
        };
      }

      if (terminalAction.kind === "escalate_to_user") {
        const pauseReason = `escalated:${terminalAction.reasonCode}`;
        const draftPayload = terminalAction.suggestedReplyDraft
          ? {
              targetUserId,
              targetRole,
              replyToSeq: effectiveTriggerSeq,
              body: terminalAction.suggestedReplyDraft,
              confidence: "low",
              rationale: terminalAction.reasonCode,
              createdAt: new Date().toISOString(),
            }
          : latestConv.ai_draft_json;

        await client.query(
          `UPDATE conversations
           SET ai_paused_reason = $2,
               ai_last_run_at = now(),
               ai_draft_json = $3::jsonb,
               updated_at = now()
           WHERE id = $1`,
          [cleanConvId, pauseReason, draftPayload ? JSON.stringify(draftPayload) : null]
        );
        const sysMsg = await insertSystemMessage(client, {
          conversationId: cleanConvId,
          senderId: targetUserId,
          body: terminalAction.summaryForUser,
          escalationReason: terminalAction.reasonCode,
        });
        return {
          action: "escalated",
          reasonCode: terminalAction.reasonCode,
          aiPausedReason: pauseReason,
          systemMessageId: sysMsg.id,
          systemMessageSeq: sysMsg.seq,
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
      const otherMode = otherRole === "buyer" ? latestConv.buyer_ai_mode : latestConv.owner_ai_mode;
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
      onScheduleNext({
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
  const vf = await import("@vercel/functions").catch(() => null);
  const task = Promise.resolve()
    .then(() =>
      runDelegatedChatReply({
        ...params,
        onScheduleNext: (nextParams) => {
          void scheduleDelegatedReply(nextParams);
        },
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

  if (typeof vf?.waitUntil === "function") {
    vf.waitUntil(task);
  }
  return { task };
}
