// 마이페이지 > 내 계정의 "교육이수증" 칸: 사진을 올리면 체크 표시가 켜지고,
// 칸을 누르면 올린 사진이 펼쳐졌다 접혔다 한다.
import { $, toast } from "../core/utils.js";
import { runtime, isLoggedIn, apiFetch } from "../core/store.js";
import { downscaleImage } from "../ai/photo.js";

const ACCEPTED = /^image\/(jpeg|png|webp)$/;
// 휴대폰 사진은 1MB를 넘기 쉬워서 올리기 전에 긴 변 1600px JPEG로 줄인다(서버 상한 1MB).
const MAX_SIDE = 1600;

// 한 번 불러온 사진은 다시 받지 않도록 기억한다(새로 올리거나 지우거나 계정이 바뀌면 비운다).
let cachedImage = null;
let cachedOwner = null;

function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

function currentStatus() {
  const s = runtime.educationCertificate;
  return s && s.uploaded ? s : { uploaded: false, uploadedAt: null };
}

function isOpen() {
  return $("eduCertPreviewWrap")?.hidden === false;
}

export function setEducationCertificateStatus(status) {
  runtime.educationCertificate = status && typeof status === "object"
    ? { uploaded: Boolean(status.uploaded), uploadedAt: status.uploadedAt || null }
    : { uploaded: false, uploadedAt: null };
  renderEducationCertificate();
}

export function renderEducationCertificate() {
  const panel = $("eduCertPanel");
  if (!panel) return;
  const accountId = runtime.accountUser?.id || null;
  if (cachedOwner !== accountId) {
    cachedImage = null;
    cachedOwner = accountId;
    collapse();
  }
  const { uploaded, uploadedAt } = currentStatus();
  panel.classList.toggle("is-done", uploaded);
  $("eduCertCheck").setAttribute("aria-label", uploaded ? "교육이수증 확인 완료" : "교육이수증 미등록");
  $("eduCertStatus").textContent = uploaded
    ? `이수증 사진이 등록되었어요${uploadedAt ? ` · ${formatDate(uploadedAt)}` : ""}`
    : "농기계 안전교육 이수증 사진을 올리면 체크 표시가 돼요.";
  $("eduCertUploadButton").textContent = uploaded ? "다시 올리기" : "사진 올리기";
  $("eduCertDeleteButton").hidden = !uploaded;
  $("eduCertToggle").disabled = !uploaded;
  $("eduCertCaret").hidden = !uploaded;
  if (!uploaded) {
    cachedImage = null;
    collapse();
  }
}

function collapse() {
  const wrap = $("eduCertPreviewWrap");
  if (wrap) wrap.hidden = true;
  $("eduCertPanel")?.classList.remove("is-open");
  $("eduCertToggle")?.setAttribute("aria-expanded", "false");
  if ($("eduCertCaretLabel")) $("eduCertCaretLabel").textContent = "사진 펼치기";
}

async function expand() {
  if (!cachedImage) {
    const res = await apiFetch("/api/me", { method: "POST", json: { action: "getEducationCertificate" } });
    if (!res?.imageDataUrl) throw new Error("이수증 사진을 불러오지 못했어요.");
    cachedImage = res.imageDataUrl;
  }
  $("eduCertPreview").src = cachedImage;
  $("eduCertPreviewWrap").hidden = false;
  $("eduCertPanel").classList.add("is-open");
  $("eduCertToggle").setAttribute("aria-expanded", "true");
  $("eduCertCaretLabel").textContent = "사진 접기";
}

async function toggle() {
  if (!currentStatus().uploaded) return;
  if (isOpen()) return collapse();
  setBusy(true);
  try {
    await expand();
  } catch (error) {
    toast(error instanceof Error && error.message ? error.message : "이수증 사진을 불러오지 못했어요.");
  } finally {
    setBusy(false);
  }
}

function setBusy(busy) {
  for (const id of ["eduCertUploadButton", "eduCertDeleteButton"]) {
    const el = $(id);
    if (el) el.disabled = busy;
  }
  const t = $("eduCertToggle");
  if (t) t.disabled = busy || !currentStatus().uploaded;
  $("eduCertPanel")?.setAttribute("aria-busy", String(busy));
}

async function upload(file) {
  if (!file) return;
  if (!ACCEPTED.test(file.type || "")) return toast("JPG·PNG·WebP 사진만 올릴 수 있어요.");
  setBusy(true);
  try {
    const photoDataUrl = await downscaleImage(file, { maxSide: MAX_SIDE, quality: 0.85 });
    const res = await apiFetch("/api/me", {
      method: "POST",
      json: { action: "uploadEducationCertificate", photoDataUrl },
      timeoutMs: 30000,
    });
    // 방금 올린 사진을 바로 보여 준다(서버에서 다시 받지 않고 보낸 사진을 그대로 쓴다).
    cachedImage = photoDataUrl;
    setEducationCertificateStatus(res?.educationCertificate || { uploaded: true, uploadedAt: new Date().toISOString() });
    await expand();
    toast("교육이수증이 등록되었어요.");
  } catch (error) {
    toast(error instanceof Error && error.message ? error.message : "이수증 사진을 올리지 못했어요.");
  } finally {
    setBusy(false);
  }
}

export function initEducationCertificate() {
  const input = $("eduCertInput");
  if (!input) return;
  $("eduCertUploadButton").addEventListener("click", () => {
    if (!isLoggedIn()) return;
    input.click();
  });
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    input.value = "";
    await upload(file);
  });
  $("eduCertToggle").addEventListener("click", toggle);
  // 펼친 사진을 눌러도 접힌다.
  $("eduCertPreview").addEventListener("click", collapse);
  $("eduCertDeleteButton").addEventListener("click", async () => {
    if (!window.confirm("등록한 교육이수증 사진을 삭제할까요?")) return;
    setBusy(true);
    try {
      const res = await apiFetch("/api/me", { method: "POST", json: { action: "deleteEducationCertificate" } });
      setEducationCertificateStatus(res?.educationCertificate || { uploaded: false });
      toast("교육이수증 사진을 삭제했어요.");
    } catch (error) {
      toast(error instanceof Error && error.message ? error.message : "삭제하지 못했어요.");
    } finally {
      setBusy(false);
    }
  });
  renderEducationCertificate();
}
