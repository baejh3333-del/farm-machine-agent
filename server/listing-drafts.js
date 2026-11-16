// 판매·대여 초안 사진 저장. 로그인한 사용자만, 기존 매물 사진 저장소와 키 형식을 그대로 쓴다.
// 등록되지 않은 초안 사진은 `db:reconcile-photos -- --min-age-minutes 1440` 이상으로 정리한다.
import { randomUUID } from "node:crypto";
import { fail } from "./http.js";
import { validateAndReencodeImage } from "./images.js";
import { newListingPhotoKey, photoPublicUrl, putPhotoObject } from "./storage.js";

export async function saveDraftPhoto(user, imageDataUrl) {
  if (!user?.id) fail(401, "LOGIN_REQUIRED", "사진을 저장하려면 로그인이 필요해요.");
  const encoded = await validateAndReencodeImage(imageDataUrl);
  const listingId = randomUUID();
  const photoKey = newListingPhotoKey(listingId);
  await putPhotoObject(photoKey, encoded.buffer, encoded.contentType);
  return { listingId, photoKey, photoUrl: photoPublicUrl(photoKey) };
}
