// 마이페이지 > 내 계정의 "교육이수증" 칸: 사진을 올리면 체크 표시가 켜진다.
import { $, toast } from "../core/utils.js";
import { runtime, isLoggedIn, apiFetch } from "../core/store.js";
import { downscaleImage } from "../ai/photo.js";

const ACCEPTED = /^image\/(jpeg|png|webp)$/;
// 휴대폰 사진은 1MB를 넘기 쉬워서 올리기 전에 긴 변 1600px JPEG로 줄인다(서버 상한 1MB).
const MAX_SIDE = 1600;

function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

function currentStatus() {
  const s = runtime.educationCertificate;
  return s && s.uploaded ? s : { uploaded: false, uploadedAt: null };
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
  const { uploaded, uploadedAt } = currentStatus();
  panel.classList.toggle("is-done", uploaded);
  const check = $("eduCertCheck");
  check.setAttribute("aria-label", uploaded ? "교육이수증 확인 완료" : "교육이수증 미등록");
  $("eduCertStatus").textContent = uploaded
    ? `이수증 사진이 등록되었어요${uploadedAt ? ` · ${formatDate(uploadedAt)}` : ""}`
    : "농기계 안전교육 이수증 사진을 올리면 체크 표시가 돼요.";
  $("eduCertUploadButton").textContent = uploaded ? "다시 올리기" : "사진 올리기";
  $("eduCertViewButton").hidden = !uploaded;
  $("eduCertDeleteButton").hidden = !uploaded;
  if (!uploaded) hidePreview();
}

function hidePreview() {
  const wrap = $("eduCertPreviewWrap");
  const img = $("eduCertPreview");
  if (wrap) wrap.hidden = true;
  if (img) img.removeAttribute("src");
  $("eduCertViewButton")?.setAttribute("aria-expanded", "false");
  if ($("eduCertViewButton")) $("eduCertViewButton").textContent = "보기";
}

async function showPreview() {
  const wrap = $("eduCertPreviewWrap");
  if (!wrap.hidden) return hidePreview();
  const res = await apiFetch("/api/me", { method: "POST", json: { action: "getEducationCertificate" } });
  if (!res?.imageDataUrl) throw new Error("이수증 사진을 불러오지 못했어요.");
  $("eduCertPreview").src = res.imageDataUrl;
  wrap.hidden = false;
  $("eduCertViewButton").setAttribute("aria-expanded", "true");
  $("eduCertViewButton").textContent = "닫기";
}

function setBusy(busy) {
  for (const id of ["eduCertUploadButton", "eduCertViewButton", "eduCertDeleteButton"]) {
    const el = $(id);
    if (el) el.disabled = busy;
  }
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
    hidePreview();
    setEducationCertificateStatus(res?.educationCertificate || { uploaded: true, uploadedAt: new Date().toISOString() });
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
  $("eduCertViewButton").addEventListener("click", async () => {
    setBusy(true);
    try {
      await showPreview();
    } catch (error) {
      toast(error instanceof Error && error.message ? error.message : "이수증 사진을 불러오지 못했어요.");
    } finally {
      setBusy(false);
    }
  });
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
