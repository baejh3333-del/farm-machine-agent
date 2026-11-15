import { queryParams, sendJson } from "../server/http.js";
import { getPhotoObject, isValidPhotoKey } from "../server/storage.js";

export default async function photosHandler(request, response) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    return sendJson(response, 405, { code: "METHOD_NOT_ALLOWED", error: "GET만 지원합니다." });
  }

  const key = queryParams(request).get("key");
  if (!isValidPhotoKey(key)) {
    return sendJson(response, 400, { code: "INVALID_PHOTO_KEY", error: "잘못된 사진 요청입니다." });
  }

  try {
    const obj = await getPhotoObject(key);
    if (!obj) {
      return sendJson(response, 404, { code: "PHOTO_NOT_FOUND", error: "사진을 찾을 수 없습니다." });
    }
    response.writeHead(200, {
      "Content-Type": obj.contentType || "image/webp",
      "Content-Length": String(obj.buffer.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    });
    if (request.method === "HEAD") return response.end();
    return response.end(obj.buffer);
  } catch (error) {
    console.error("photo fetch failed", error instanceof Error ? error.message : "unknown");
    return sendJson(response, 503, { code: "PHOTO_UNAVAILABLE", error: "사진을 불러오지 못했습니다." });
  }
}
