import { sendMessage } from "../server/chat.js";
import { kstToday } from "../server/db.js";
import { assertWritesAllowed, currentUser, fail, handle, MAX_UPLOAD_JSON_BYTES, readJson } from "../server/http.js";
import { fetchListings } from "../server/listings-db.js";
import { createListing, updateListing } from "../server/listings-service.js";
import { CONFIRMABLE_TOOLS, runConfirmedAction, runNongnong, sanitizeHistory, validPhoto } from "../server/nongnong.js";
import { enforceRateLimit } from "../server/rate-limit.js";
import { createRentalRequest } from "../server/rentals.js";
import { getWeatherAndMapConfig } from "../server/weather.js";

const WRITE_RATE_KIND = {
  create_rental_request: "rental",
  create_purchase_request: "message",
  create_listing: "listing",
  update_listing: "listing",
};

function writeDeps(request, user) {
  return {
    fetchListings: () => fetchListings({ viewerId: user?.id ?? null }),
    getWeather: (options) => getWeatherAndMapConfig(options),
    createRentalRequest: (u, payload) => createRentalRequest(u, payload),
    sendPurchaseMessage: (u, payload) => sendMessage(u, payload),
    createListing: (u, payload) => createListing(u, payload),
    updateListing: (u, payload) => updateListing(u, payload),
    fetchOwnListings: () => fetchListings({ viewerId: user.id, ownerOnly: true }),
    beforeWrite: async (toolName) => {
      await assertWritesAllowed();
      await enforceRateLimit(request, WRITE_RATE_KIND[toolName], { userId: user.id });
    },
  };
}

export default handle(["POST"], async (request) => {
  const body = await readJson(request, { maxBytes: MAX_UPLOAD_JSON_BYTES });

  // 음성 대화에서 띄운 승인 카드의 버튼을 눌렀을 때: 모델 없이 카드에 적힌 작업만 처리한다.
  if (body.confirmAction !== undefined) {
    const action = body.confirmAction;
    const args = action?.args;
    if (!CONFIRMABLE_TOOLS.has(action?.tool) || !args || typeof args !== "object" || Array.isArray(args)) {
      fail(400, "INVALID_ACTION", "처리할 수 없는 요청이에요.");
    }
    const photo = body.photo == null || body.photo === "" ? null : validPhoto(body.photo);
    if (body.photo && !photo) fail(400, "INVALID_PHOTO", "사진은 JPG·PNG·WEBP 한 장만, 1MB 정도까지 올릴 수 있어요.");
    await enforceRateLimit(request, "recommend");
    const user = await currentUser(request).catch(() => null);
    const result = await runConfirmedAction({ user, today: kstToday(), deps: writeDeps(request, user), action: { tool: action.tool, args, requestId: typeof action.requestId === "string" ? action.requestId : null }, photo });
    return { status: 200, body: result };
  }

  const messages = sanitizeHistory(body.messages);
  const last = messages.at(-1);
  if (!last || last.role !== "user" || last.content.length > 500) {
    fail(400, "INVALID_MESSAGE", "질문은 1~500자로 입력해 주세요.");
  }
  const photo = body.photo == null || body.photo === "" ? null : validPhoto(body.photo);
  if (body.photo && !photo) fail(400, "INVALID_PHOTO", "사진은 JPG·PNG·WEBP 한 장만, 1MB 정도까지 올릴 수 있어요.");
  // OpenAI 키가 없거나 다른 공급자(AI_PROVIDER)가 지정된 경우 기존 에이전트/규칙 기반 상담으로 넘긴다.
  const provider = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (!process.env.OPENAI_API_KEY?.trim() || (provider && provider !== "openai")) {
    return { status: 200, body: { mode: "unavailable" } };
  }

  await enforceRateLimit(request, "recommend");
  const user = await currentUser(request).catch(() => null);

  try {
    const result = await runNongnong({
      messages,
      user,
      today: kstToday(),
      photo,
      photoIsNew: body.photoIsNew === true,
      inputMode: body.inputMode === "voice" ? "voice" : "text",
      deps: writeDeps(request, user),
    });
    return { status: 200, body: result };
  } catch (error) {
    console.error("nongnong failed", error instanceof Error ? error.message : "unknown");
    fail(502, "NONGNONG_UNAVAILABLE", "농농이가 잠시 답할 수 없어요. 잠시 후 다시 시도해 주세요.");
  }
});
