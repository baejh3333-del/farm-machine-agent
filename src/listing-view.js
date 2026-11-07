// 매물 한 건을 보여 주는 데 쓰는 공통 조각(상태 배지, 사진, 요약 문구).
import { state } from "./app-state.js";
import { MACHINE_BY_ID } from "./data/farm-machines.js";
import { areaLabel } from "./format.js";
import { today } from "./time.js";
import { escapeHtml } from "./ui.js";

export function rentedNow(item) {
  if (item.type !== "rent") return false;
  const now = today();
  return (item.booked || []).some((range) => range.start <= now && now <= range.end);
}
export function statusLabel(item) {
  if (item.type === "sale") return item.status === "done" ? "판매 완료" : item.status === "dealing" ? "거래 중" : "판매 가능";
  if (item.condition === "repair") return "정비 중";
  return rentedNow(item) ? "대여 중" : "대여 가능";
}
export function statusClass(item) {
  if (item.type === "rent" && item.condition !== "repair" && item.status === "open" && rentedNow(item)) return "rented";
  return item.status !== "open" || item.condition === "repair" ? "warn" : "ok";
}
const LISTING_PHOTO = /^data:image\/(?:png|jpeg|webp);base64,/i;
export const hasListingPhoto = (item) => typeof item.photo === "string" && LISTING_PHOTO.test(item.photo);
export const machineImage = (type) => `./src/images/machines/${type?.id || "tractor"}.jpg`;
export function favoriteIcon() {
  return `<svg class="favorite-icon" viewBox="0 0 36 36" aria-hidden="true" focusable="false">
    <path fill="#b9703c" stroke="#65391f" stroke-width="1.8" stroke-linejoin="round"
      d="M2 28c0-2.1 2.1-3.9 4.5-4.8 1.4-2.2 3.6-3.1 6-3.1a8.8 8.8 0 0 1 10.7 0c2.7 0 5 1 6.3 3.1 2.4 1 4.5 2.7 4.5 4.8 0 3.5-5 4.1-8.5 4.1-3.3 1.1-5.7 0-7.5 0s-4.2 1.1-7.5 0C7 32.1 2 31.5 2 28Z"/>
    <path fill="#9a542a" d="M3.1 28c4.4 1.6 5.9-2.3 9.6-1.7 3.1.4 4.6 3.2 8.8 1.1 3.9-2 4.8-1.4 7.1-.5 1.3.5 2.8.8 4.3.6.4 2.8-3.8 3.6-7.6 3.6-3.1 1-5.5 0-7.3 0s-4.2 1-7.3 0c-3.8 0-7.6-.9-7.6-3.1Z"/>
    <g fill="#78421f">
      <circle cx="9" cy="28.4" r=".95"/>
      <circle cx="13.7" cy="25.4" r=".95"/>
      <circle cx="23.7" cy="28.5" r=".85"/>
      <circle cx="27.1" cy="26.3" r=".85"/>
    </g>
    <g class="favorite-shoot">
      <path fill="#9ac921" stroke="#416514" stroke-width="1.8" stroke-linejoin="round"
        d="M16.7 23.1v-4.4C9.5 19.4 6.1 15 6.2 9.2c5.3-2.6 9.7.3 11.6 4.1 2.3-4.6 7-6.9 12.1-5.4.2 6.4-3.8 10.8-10.6 10.8l-.2 4.4a3 3 0 0 1-2.4 0Z"/>
      <path fill="none" stroke="#d2ee6b" stroke-width="1.5" stroke-linecap="round"
        d="M9.3 10.7c1-.3 2.1-.2 3 .2m7.9 4c1-2 2.7-3.6 4.6-4.3"/>
    </g>
  </svg>`;
}
export function machineVisual(item) {
  const type = MACHINE_BY_ID[item.machineType];
  return hasListingPhoto(item)
    ? `<img src="${escapeHtml(item.photo)}" alt="${escapeHtml(item.title)} 사진" style="width:100%;height:100%;object-fit:cover">`
    : `<img class="machine-example" src="${machineImage(type)}" alt="${escapeHtml(type?.label || "농기계")} AI 예시 이미지" width="350" height="365" loading="lazy">`;
}
export function listingSummary(item) {
  const summary = state.aiSummaries[item.id] || item.summary;
  const cleaned = summary.replace(/권장\s*면적\s*\d[\d,]*~\d[\d,]*㎡\.?/g, "").trim();
  return `${cleaned} (${areaLabel(item.areaMin, item.areaMax)} 권장)`;
}
