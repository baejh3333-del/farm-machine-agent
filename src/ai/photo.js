// 농농이 사진 첨부 도우미: 사진 줄이기와 판매·대여 초안을 매물 등록 화면 값으로 바꾸기.

const PHOTO_ERROR = "JPG·PNG 사진만 올릴 수 있어요.";

/** 사진을 긴 변 maxSide 이하 JPEG data URL로 줄인다. 서버 업로드 상한(1MB) 안에 들어가게 한다. */
export async function downscaleImage(file, { maxSide = 1280, quality = 0.85 } = {}) {
  if (!file || !/^image\//.test(file.type || "")) throw new Error(PHOTO_ERROR);
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(PHOTO_ERROR);
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  let dataUrl = canvas.toDataURL("image/jpeg", quality);
  // base64 길이 기준으로 1MB를 넘으면 품질을 낮춰 한 번 더 줄인다.
  if (dataUrl.length > 1_300_000) dataUrl = canvas.toDataURL("image/jpeg", 0.6);
  if (dataUrl.length > 1_300_000) throw new Error("사진이 너무 커요. 다른 사진을 올려 주세요.");
  return dataUrl;
}

/** 농농이 판매·대여 초안을 기존 매물 등록 화면(openNewListing)의 draftValues로 바꾼다. */
export function listingDraftToFormValues(draft, photoDataUrl) {
  const saved = Boolean(draft?.listingId && draft?.photoKey);
  return {
    id: saved ? draft.listingId : crypto.randomUUID(),
    type: draft?.type === "sale" ? "sale" : "rent",
    modelId: draft?.modelId || "",
    machineType: draft?.machineType || undefined,
    brand: draft?.brand || undefined,
    title: draft?.title || "",
    price: Number.isFinite(draft?.price) && draft.price > 0 ? draft.price : "",
    description: draft?.description || "",
    ...(draft?.region ? { region: draft.region } : {}),
    ...(draft?.condition ? { condition: draft.condition } : {}),
    ...(draft?.cropIds?.length ? { cropIds: draft.cropIds } : {}),
    ...(draft?.operations?.length ? { operations: draft.operations } : {}),
    ...(Number.isFinite(draft?.areaMin) ? { areaMin: draft.areaMin } : {}),
    ...(Number.isFinite(draft?.areaMax) ? { areaMax: draft.areaMax } : {}),
    ...(saved ? { draftPhotoKey: draft.photoKey, draftPhotoUrl: draft.photoUrl || undefined } : {}),
    ...(photoDataUrl ? { photoDataUrl } : {}),
  };
}
