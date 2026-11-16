import { sendMessage } from "../server/chat.js";
import { kstToday } from "../server/db.js";
import { assertWritesAllowed, currentUser, fail, handle, readJson } from "../server/http.js";
import { fetchListings } from "../server/listings-db.js";
import { createListing } from "../server/listings-service.js";
import { runNongnong, sanitizeHistory } from "../server/nongnong.js";
import { enforceRateLimit } from "../server/rate-limit.js";
import { createRentalRequest } from "../server/rentals.js";
import { getWeatherAndMapConfig } from "../server/weather.js";

const WRITE_RATE_KIND = {
  create_rental_request: "rental",
  create_purchase_request: "message",
  create_listing: "listing",
};

export default handle(["POST"], async (request) => {
  const body = await readJson(request, { maxBytes: 48_000 });
  const messages = sanitizeHistory(body.messages);
  const last = messages.at(-1);
  if (!last || last.role !== "user" || last.content.length > 500) {
    fail(400, "INVALID_MESSAGE", "질문은 1~500자로 입력해 주세요.");
  }
  // AI 키가 없으면 화면이 기존 조건 검색 상담으로 넘어가도록 알린다.
  if (!process.env.OPENAI_API_KEY) return { status: 200, body: { mode: "unavailable" } };

  await enforceRateLimit(request, "recommend");
  const user = await currentUser(request).catch(() => null);

  try {
    const result = await runNongnong({
      messages,
      user,
      today: kstToday(),
      deps: {
        fetchListings: () => fetchListings({ viewerId: user?.id ?? null }),
        getWeather: (options) => getWeatherAndMapConfig(options),
        createRentalRequest: (u, payload) => createRentalRequest(u, payload),
        sendPurchaseMessage: (u, payload) => sendMessage(u, payload),
        createListing: (u, payload) => createListing(u, payload),
        beforeWrite: async (toolName) => {
          await assertWritesAllowed();
          await enforceRateLimit(request, WRITE_RATE_KIND[toolName], { userId: user.id });
        },
      },
    });
    return { status: 200, body: result };
  } catch (error) {
    console.error("nongnong failed", error instanceof Error ? error.message : "unknown");
    fail(502, "NONGNONG_UNAVAILABLE", "농농이가 잠시 답할 수 없어요. 잠시 후 다시 시도해 주세요.");
  }
});
