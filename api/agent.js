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
import { createInsuranceConsult, handleInsuranceTurn, INSURANCE_ASK, insuranceOfferFor } from "../server/insurance-flow.js";
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

/** 대여·구매 예약을 마친 응답이면, 이 대화에서 아직 안 물었을 때만 "보험을 추천해드릴까요?"를 덧붙인다. */
async function attachInsuranceAsk(result, { asked, loadListings }) {
  if (asked || !result?.reservation) return result;
  const listings = await loadListings().catch(() => []);
  const listing = listings.find((item) => item.id === result.reservation.listingId) || null;
  const offer = insuranceOfferFor(result.reservation, listing);
  if (!offer) return result;
  return { ...result, insuranceAsk: INSURANCE_ASK, insuranceOffer: offer };
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
    await enforceRateLimit(request, "recommend");
    const image = hasImage ? await preparePhoto(body.image) : undefined;
    const user = await currentUser(request).catch(() => null);
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
    const turn = await runAgentTurn(message, {
      history: Array.isArray(body.history) ? body.history : [],
      region: typeof body.region === "string" ? body.region : undefined,
      inputMode: body.inputMode === "voice" ? "voice" : "text",
      uiContext: body.uiContext && typeof body.uiContext === "object" ? body.uiContext : undefined,
      image,
      user,
      farmProfile,
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
