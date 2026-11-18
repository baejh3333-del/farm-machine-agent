import { randomUUID } from "node:crypto";
import {
  getOrCreateAgentSession,
  loadFarmProfile,
  recordAgentTurn,
  upsertFarmProfile,
} from "../server/agent-session-store.js";
import { sendMessage } from "../server/chat.js";
import {
  assertWritesAllowed,
  currentUser,
  fail,
  handle,
  HttpError,
  MAX_UPLOAD_JSON_BYTES,
  readJson,
  requireUser,
} from "../server/http.js";
import { validateAndReencodeImage } from "../server/images.js";
import { createInsuranceConsult, handleInsuranceTurn, INSURANCE_ASK, insuranceOfferFor, repairInsuranceOffer } from "../server/insurance-flow.js";
import { fetchListings } from "../server/listings-db.js";
import { scheduleWaitUntil } from "../server/wait-until.js";
import { createListing, updateListing } from "../server/listings-service.js";
import {
  cleanSavedDraft,
  executeDelegatedTransaction,
  executeListingAction,
  executePurchaseRequest,
  executeRentalRequest,
  runAgentTurn,
} from "../server/nongnong-agent.js";
import { isAffirmative } from "../server/nongnong.js";
import { enforceRateLimit } from "../server/rate-limit.js";
import voiceApi from "../server/voice-api.js";
import { createRentalRequest } from "../server/rentals.js";
import { toggleFavorite } from "../server/user-data.js";
import { getWeatherAndMapConfig } from "../server/weather.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PHOTO_MESSAGE = "JPG·PNG·WebP 사진을 1MB 이하로 올려 주세요.";

const CHAT_WRITE_RATE_KIND = {
  create_rental_request: "rental",
  create_purchase_request: "message",
  delegate_transaction: "message",
  create_listing: "listing",
  update_listing: "listing",
  toggle_favorite: "message",
};

/** 대여·구매 예약·거래 위임 또는 수리 안내 응답이면, 이 대화에서 아직 안 물었을 때 "보험 추천해드릴까요?"를 덧붙인다. */
export async function attachInsuranceAsk(result, { asked, loadListings }) {
  if (asked || !result || result.pendingAction || result.choices?.length) return result;
  let offer = null;
  if (result.reservation) {
    const listings = await loadListings().catch(() => []);
    const listing = listings.find((item) => item.id === result.reservation.listingId) || null;
    offer = insuranceOfferFor(result.reservation, listing);
  } else if (result.delegatedTransaction) {
    const kind = result.delegatedTransaction.type === "sale" ? "purchase" : "rental";
    const listings = await loadListings().catch(() => []);
    const listing = listings.find((item) => item.id === result.delegatedTransaction.listingId) || null;
    offer = insuranceOfferFor({ kind, listingId: result.delegatedTransaction.listingId }, listing);
  } else if (Array.isArray(result.repairCenters) && result.repairCenters.length > 0) {
    offer = repairInsuranceOffer({ machineType: result.photoSummary?.machineType || null });
  }
  if (!offer) return result;
  const alreadyAskedInReply = /보험\s*(?:을\s*)?추천해\s*드릴까요/.test(result.reply || "");
  return alreadyAskedInReply
    ? { ...result, insuranceOffer: offer }
    : { ...result, insuranceAsk: INSURANCE_ASK, insuranceOffer: offer };
}

const EXECUTE_ACTIONS = {
  rental_request: {
    rateKind: "rental",
    run: (user, pending, requestId) => executeRentalRequest(user, pending, { requestId }),
  },
  purchase_request: {
    rateKind: "message",
    run: (user, pending, requestId) => executePurchaseRequest(user, pending, { requestId }),
  },
  create_listing: {
    rateKind: "listing",
    run: (user, pending, requestId) => executeListingAction(user, pending, { requestId }),
  },
  delegate_transaction: {
    rateKind: "message",
    run: (user, pending, requestId) => executeDelegatedTransaction(user, pending, { requestId }),
  },
  toggle_favorite: {
    rateKind: "message",
    run: async (user, pending) => {
      const res = await toggleFavorite(user.id, pending?.listingId, {
        favorite: typeof pending?.favorite === "boolean" ? pending.favorite : undefined,
      });
      return {
        outcome: "completed",
        favoriteAction: {
          listingId: pending?.listingId,
          favorite: res.isFavorite,
        },
        userData: res.userData,
        message: res.isFavorite ? "매물을 찜 목록에 저장했어요." : "찜 목록에서 뺐어요.",
      };
    },
  },
};

const CONFIRMABLE_ACTIONS = new Set(["rental_request", "purchase_request", "create_listing"]);
const ACTION_LABEL = { rental_request: "대여 예약 요청", purchase_request: "구매 신청", create_listing: "매물 등록" };

/**
 * 바로 앞 턴에서 농농이 확인을 물은 작업(pendingAction)에 사용자가 "네", "응 해줘"라고 답하면
 * 모델을 다시 부르지 않고 그 자리에서 실행한다. 매물 ID를 잃어버리거나 "잠시 후 진행"으로 끝나는 일을 막는다.
 * 실행 대상이 아니면 null.
 */
export async function runConfirmedAction({ message, pending, user, requestId, run, beforeWrite }) {
  if (!user || !pending || typeof pending !== "object" || !CONFIRMABLE_ACTIONS.has(pending.type)) return null;
  if (!isAffirmative(message)) return null;
  const label = ACTION_LABEL[pending.type];
  const title = typeof pending.title === "string" && pending.title.trim()
    ? `${pending.title.replace(/\s*·\s*/g, " ").trim().slice(0, 60)} `
    : "";
  try {
    await beforeWrite?.(pending.type);
    const executed = await run(user, pending, requestId);
    if (executed?.outcome === "completed" || executed?.outcome === "partial") {
      const number = executed.reservation?.number || executed.createdListing?.number || "";
      const reply = executed.outcome === "completed"
        ? `${title}${label}을 완료했어요.${number ? ` 신청 번호는 ${number}예요.` : ""}`
        : executed.message;
      return {
        mode: "agent",
        reply,
        listingIds: [],
        learnedSlots: {},
        executedAction: pending.type,
        ...(executed.reservation ? { reservation: executed.reservation } : {}),
        ...(executed.createdListing ? { createdListing: executed.createdListing } : {}),
      };
    }
    const reason = String(executed?.message || "요청을 처리하지 못했어요").replace(/[.。]\s*$/, "");
    return { mode: "agent", reply: `${title}${label}을 하지 못했어요. 이유: ${reason}. 다른 매물을 찾아 드릴까요?`, listingIds: [], learnedSlots: {}, actionFailed: true };
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) throw error;
    const reason = error instanceof HttpError ? error.message.replace(/[.。]\s*$/, "") : "서버 연결이 잠시 불안정했어요";
    if (!(error instanceof HttpError)) console.warn("confirmed_action_failed", error?.name || "unknown");
    return { mode: "agent", reply: `${title}${label}을 하지 못했어요. 이유: ${reason}. "다시 해줘"라고 말씀하시면 바로 다시 시도할게요.`, listingIds: [], learnedSlots: {}, actionFailed: true, pendingAction: pending };
  }
}

/** 사진을 검사·재인코딩(EXIF 제거)해서 모델에 보낼 형태로 만든다. 저장은 하지 않는다. */
async function preparePhoto(dataUrl) {
  try {
    const encoded = await validateAndReencodeImage(dataUrl);
    const base64 = encoded.buffer.toString("base64");
    const mediaType = encoded.contentType || "image/webp";
    return { mediaType, base64, dataUrl: `data:${mediaType};base64,${base64}` };
  } catch (error) {
    if (error instanceof HttpError && error.status < 500) fail(400, "INVALID_PHOTO", PHOTO_MESSAGE);
    throw error;
  }
}

const agentApi = handle(["POST"], async (request) => {
  const started = Date.now();
  const body = await readJson(request, { maxBytes: MAX_UPLOAD_JSON_BYTES });
  const action = body.action === "execute" ? "execute" : "chat";

  if (action === "chat") {
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const hasImage = typeof body.image === "string" && body.image.length > 0;
    if (message.length > 500 || (!message && !hasImage)) fail(400, "INVALID_MESSAGE", "질문은 1~500자로 입력해 주세요.");
    // 호출 제한을 먼저 검사해 사진 디코딩 비용도 횟수에 넣는다.
    // 호출 제한 검사와 로그인 확인은 서로 기다릴 필요가 없어 함께 실행한다(응답 시간 단축).
    const userPromise = currentUser(request).catch(() => null);
    await enforceRateLimit(request, "recommend");
    const image = hasImage ? await preparePhoto(body.image) : undefined;
    const user = await userPromise;
    const [farmProfile, session] = user?.id
      ? await Promise.all([
          loadFarmProfile(user.id).catch(() => null),
          getOrCreateAgentSession(user.id, typeof body.sessionId === "string" ? body.sessionId : null).catch(() => null),
        ])
      : [null, null];
    const activeSessionId = session?.id ?? null;
    let turnMeta = null;
    const deps = {
      fetchListings: () => fetchListings({ viewerId: user?.id ?? null }),
      getWeather: (options) => getWeatherAndMapConfig(options),
      createRentalRequest: (u, payload) => createRentalRequest(u, payload),
      sendPurchaseMessage: (u, payload) => sendMessage(u, payload),
      delegateTransaction: (u, payload, opts) => executeDelegatedTransaction(u, payload, opts),
      createListing: (u, payload) => createListing(u, payload),
      updateListing: (u, payload) => updateListing(u, payload),
      toggleFavorite: (u, { listingId, favorite }) => toggleFavorite(u.id, listingId, { favorite }),
      fetchOwnListings: () => (user ? fetchListings({ viewerId: user.id, ownerOnly: true }) : []),
      loadFarmProfile: (userId) => loadFarmProfile(userId),
      onTurnComplete: (meta) => { turnMeta = meta; },
      beforeWrite: async (toolName) => {
        await assertWritesAllowed();
        await enforceRateLimit(request, CHAT_WRITE_RATE_KIND[toolName] || "rental", { userId: user.id });
      },
    };
    const insuranceAsked = body.insuranceAsked === true;
    // 보험 추천 흐름 중이면(예약 뒤 "보험을 추천해드릴까요?"에 대한 답) 그 흐름을 먼저 처리한다.
    if (!image && body.insuranceOffer) {
      const insurance = await handleInsuranceTurn(message, body.insuranceOffer, {
        user,
        region: typeof body.region === "string" ? body.region : undefined,
        deps: {
          fetchListings: deps.fetchListings,
          createConsult: async (u, payload) => {
            await assertWritesAllowed();
            await enforceRateLimit(request, "message", { userId: u.id });
            return createInsuranceConsult(u, payload);
          },
        },
      });
      if (insurance) return { status: 200, body: insurance };
    }
    const pendingRequestId = typeof body.pendingAction?.requestId === "string" && UUID.test(body.pendingAction.requestId)
      ? body.pendingAction.requestId
      : randomUUID();
    const confirmed = !image && user
      ? await runConfirmedAction({
          message,
          pending: body.pendingAction,
          user,
          requestId: pendingRequestId,
          run: (u, pending, id) => EXECUTE_ACTIONS[pending.type].run(u, pending, id),
          beforeWrite: async (type) => {
            await assertWritesAllowed();
            await enforceRateLimit(request, EXECUTE_ACTIONS[type].rateKind, { userId: user.id });
          },
        })
      : null;
    const turn = confirmed ?? await runAgentTurn(message, {
      history: Array.isArray(body.history) ? body.history : [],
      region: typeof body.region === "string" ? body.region : undefined,
      inputMode: body.inputMode === "voice" ? "voice" : "text",
      uiContext: body.uiContext && typeof body.uiContext === "object" ? body.uiContext : undefined,
      image,
      user,
      farmProfile: user?.id ? (farmProfile ?? null) : undefined,
      sessionId: activeSessionId,
      sessionSlots: session?.slots,
      savedDraft: cleanSavedDraft(body.savedDraft),
    }, {
      timeoutMs: Math.max(1, (image ? 40000 : 25000) - (Date.now() - started)),
      deps,
    });
    const result = turn?.mode === "agent" ? await attachInsuranceAsk(turn, { asked: insuranceAsked, loadListings: deps.fetchListings }) : turn;
    if (result?.error === "PHOTO_UNAVAILABLE") fail(502, "PHOTO_UNAVAILABLE", "사진을 지금 확인하지 못했어요. 잠시 후 다시 올려 주세요.");
    if (!result) fail(502, "AGENT_UNAVAILABLE", "농농이가 잠시 답할 수 없어요. 잠시 후 다시 시도해 주세요.");

    if (user?.id && result?.mode === "agent") {
      const slotsPatch = result.learnedSlots || {};
      const persistPromises = [];
      if (activeSessionId) {
        persistPromises.push(
          recordAgentTurn({
            sessionId: activeSessionId,
            userId: user.id,
            userMessage: message || (hasImage ? "(사진 첨부)" : ""),
            assistantReply: result.reply,
            slotsPatch,
            intent: turnMeta?.intent ?? null,
            stage: turnMeta?.stage ?? null,
            toolCalls: turnMeta?.toolCalls || [],
          }),
        );
      }
      if (slotsPatch.region || slotsPatch.cropIds?.length || slotsPatch.areaPyeong) {
        persistPromises.push(
          upsertFarmProfile(user.id, {
            region: slotsPatch.region,
            cropIds: slotsPatch.cropIds,
            areaPyeong: slotsPatch.areaPyeong,
          }),
        );
      }
      if (persistPromises.length) {
        const persistTask = Promise.allSettled(persistPromises);
        await scheduleWaitUntil(persistTask, { awaitFallback: true });
      }
    }

    return {
      status: 200,
      body: activeSessionId && result?.mode === "agent" ? { ...result, sessionId: activeSessionId } : result,
    };
  }

  // 사용자가 화면에서 승인한 작업만 실행한다. 로그인 사용자 권한으로 처리한다.
  const user = await requireUser(request);
  await assertWritesAllowed();
  const requestId = typeof body.requestId === "string" ? body.requestId : "";
  if (!UUID.test(requestId)) fail(400, "INVALID_REQUEST_ID", "요청 식별자가 올바르지 않습니다.");
  const pending = body.pendingAction;
  const executor = pending && typeof pending === "object" ? EXECUTE_ACTIONS[pending.type] : null;
  if (!executor) {
    fail(400, "INVALID_ACTION", "승인할 작업 내용이 올바르지 않습니다.");
  }
  await enforceRateLimit(request, executor.rateKind, { userId: user.id });
  try {
    const executed = await executor.run(user, pending, requestId);
    const result = executed?.outcome === "completed"
      ? await attachInsuranceAsk(executed, { asked: body.insuranceAsked === true, loadListings: () => fetchListings({ viewerId: user.id }) })
      : executed;
    return { status: 200, body: result };
  } catch (error) {
    if (!(error instanceof HttpError) || error.status === 401 || error.status >= 500) throw error;
    return { status: 200, body: { outcome: "failed", code: error.code, message: error.message } };
  }
});

// /api/voice는 함수 개수 제한 때문에 이 함수로 들어온다(vercel.json rewrites: /api/voice → /api/agent?route=voice).
function isVoiceRoute(request) {
  const url = new URL(request.url || "/", "http://localhost");
  return url.pathname === "/api/voice" || url.searchParams.get("route") === "voice";
}

export default function agentOrVoice(request, response) {
  return isVoiceRoute(request) ? voiceApi(request, response) : agentApi(request, response);
}
