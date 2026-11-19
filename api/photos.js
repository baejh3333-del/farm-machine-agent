import {
  assertWritesAllowed,
  fail,
  HttpError,
  MAX_UPLOAD_JSON_BYTES,
  queryParams,
  readJson,
  requireUser,
  sendJson,
} from "../server/http.js";
import { validateAndReencodeImage } from "../server/images.js";
import { enforceRateLimit } from "../server/rate-limit.js";
import {
  getPhotoObject,
  getPhotoObjectById,
  isValidPhotoKey,
  newUploadedPhotoKey,
  photoPublicUrl,
  putPhotoObject,
} from "../server/storage.js";
import { isUuid } from "../server/validate.js";

export default async function photosHandler(request, response) {
  if (request.method === "POST") {
    response.setHeader("Cache-Control", "no-store");
    try {
      const user = await requireUser(request);
      await assertWritesAllowed();
      await enforceRateLimit(request, "listing", { userId: user.id });

      const body = await readJson(request, { maxBytes: MAX_UPLOAD_JSON_BYTES });
      const dataUrl = typeof body.photoDataUrl === "string" ? body.photoDataUrl : body.dataUrl;
      if (typeof dataUrl !== "string" || !dataUrl.trim()) {
        fail(400, "INVALID_PHOTO", "업로드할 사진 데이터가 필요합니다.");
      }

      const encoded = await validateAndReencodeImage(dataUrl.trim());
      const key = newUploadedPhotoKey(user.id);
      const saved = await putPhotoObject(key, encoded.buffer, encoded.contentType, {
        ownerId: user.id,
        filename: typeof body.filename === "string" ? body.filename : "",
      });

      return sendJson(response, 201, {
        id: saved.id ?? null,
        key: saved.key,
        url: photoPublicUrl(saved.key),
        contentType: encoded.contentType,
        byteSize: encoded.byteLength,
      });
    } catch (error) {
      if (error instanceof HttpError) {
        return sendJson(response, error.status, { code: error.code, error: error.message }, error.headers);
      }
      console.error("photo upload failed", error instanceof Error ? error.message : "unknown");
      return sendJson(response, 503, { code: "PHOTO_UPLOAD_FAILED", error: "사진을 저장하지 못했습니다." });
    }
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD, POST");
    return sendJson(response, 405, { code: "METHOD_NOT_ALLOWED", error: "GET, HEAD, POST만 지원합니다." });
  }

  const params = queryParams(request);
  const key = params.get("key");
  const id = params.get("id");

  if (!key && !id) {
    return sendJson(response, 400, { code: "INVALID_PHOTO_KEY", error: "잘못된 사진 요청입니다." });
  }
  if (key && !isValidPhotoKey(key)) {
    return sendJson(response, 400, { code: "INVALID_PHOTO_KEY", error: "잘못된 사진 요청입니다." });
  }
  if (!key && id && !isUuid(id)) {
    return sendJson(response, 400, { code: "INVALID_PHOTO_ID", error: "잘못된 사진 식별자입니다." });
  }

  try {
    const obj = key ? await getPhotoObject(key) : await getPhotoObjectById(id);
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
