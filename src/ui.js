// 여러 화면이 함께 쓰는 DOM 도우미.
export const $ = (id) => document.getElementById(id);

export const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

export const money = (value) => `${Number(value).toLocaleString("ko-KR")}원`;

export function pictureIcon(name) {
  return `<img class="picture-icon" src="./src/images/icons/${name}.jpg" alt="" width="32" height="32">`;
}

let toastTimer;
function setToastVisible(value) {
  $("toast").classList.toggle("visible", value);
}

export function toast(message) {
  $("toast").textContent = message;
  setToastVisible(true);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => setToastVisible(false), 3200);
}

const dialogOpeners = new WeakMap();

export function showDialog(backdrop) {
  if (backdrop.hidden) dialogOpeners.set(backdrop, document.activeElement);
  backdrop.hidden = false;
  document.body.style.overflow = "hidden";
  backdrop.querySelector("button")?.focus();
}

export function hideDialog(backdrop) {
  if (backdrop.hidden) return;
  backdrop.hidden = true;
  dialogOpeners.get(backdrop)?.focus();
  dialogOpeners.delete(backdrop);
  if (["filterBackdrop", "detailBackdrop", "formBackdrop"].every((id) => $(id).hidden)) {
    document.body.style.overflow = "";
  }
}

export function openForm(html) {
  $("formContent").innerHTML = html;
  showDialog($("formBackdrop"));
}
