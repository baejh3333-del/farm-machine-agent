// 이 파일은 main.js에서 나눈 모듈이다. 다른 화면 함수는 app(app.js)을 통해 부른다.
// 찜하기와 찜 목록 창.
import { app } from "./app.js";
import { allListings } from "./app-state.js";
import { machineVisual } from "./listing-view.js";
import { $, escapeHtml, hideDialog, money, openForm, toast } from "./ui.js";

export async function toggleFavorite(id) {
  let isFav;
  try {
    isFav = await app.store.toggleFavorite(id);
  } catch (error) {
    return toast(error.message);
  }

  const escapedId = CSS.escape(id);
  document.querySelectorAll(`[data-favorite="${escapedId}"], [data-detail-fav="${escapedId}"]`).forEach((button) => {
    button.setAttribute("aria-pressed", String(isFav));
    const label = button.querySelector(".favorite-label");
    if (label) label.textContent = isFav ? "찜한 기계" : "찜하기";
  });
  toast(isFav ? "찜한 농기계 목록에 담았습니다." : "찜 목록에서 제외했습니다.");
}

export function openFavoritesModal() {
  const items = allListings().filter((item) => app.store.favorites.includes(item.id));
  openForm(`
    <span class="step-pill">관심 농기계 보관함</span>
    <h2 id="formTitle"> 내가 찜한 농기계 (${items.length}대)</h2>
    <p>비교해 보고 싶은 농기계를 모아두었어요. 버튼을 눌러 상세 조건을 확인하세요.</p>
    <div class="fav-modal-list">
      ${
        items.length
          ? items
              .map(
                (item) => `
          <div class="fav-modal-item">
            <button type="button" class="fav-thumb" data-favorite-detail="${item.id}" aria-label="${escapeHtml(item.title)} 상세 보기">${machineVisual(item)}</button>
            <div class="fav-item-info">
              <span class="spec-tag">${item.type === "rent" ? "일일 대여" : "중고 판매"} · ${escapeHtml(item.region)}</span>
              <strong>${escapeHtml(item.title)}</strong>
              <span class="fav-item-price">${money(item.price)}${item.type === "rent" ? " / 1일" : ""}</span>
            </div>
            <div class="fav-item-actions">
              <button type="button" class="button button-secondary button-sm" data-fav-remove="${item.id}">찜 해제</button>
              <button type="button" class="button button-primary button-sm" data-favorite-detail="${item.id}">상세 보기 ›</button>
            </div>
          </div>`
              )
              .join("")
          : `<div class="empty-panel">아직 찜한 농기계가 없습니다. 마음에 드는 농기계 카드 우측 상단의 찜 버튼을 눌러보세요!</div>`
      }
    </div>
  `);
  $("formContent")
    .querySelectorAll("[data-favorite-detail]")
    .forEach((button) =>
      button.addEventListener("click", () => {
        hideDialog($("formBackdrop"));
        app.openDetail(button.dataset.favoriteDetail);
      })
    );
  $("formContent")
    .querySelectorAll("[data-fav-remove]")
    .forEach((button) =>
      button.addEventListener("click", async () => {
        try {
          await app.store.toggleFavorite(button.dataset.favRemove);
        } catch (error) {
          return toast(error.message);
        }
        app.renderAll();
        openFavoritesModal();
      })
    );
}

export function bindFavorites() {
  document.querySelector('[data-action="favorites"]').addEventListener("click", openFavoritesModal);
}
