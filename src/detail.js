// 이 파일은 main.js에서 나눈 모듈이다. 다른 화면 함수는 app(app.js)을 통해 부른다.
// 매물 상세 창.
import { app } from "./app.js";
import { listingById, state } from "./app-state.js";
import { CROP_BY_ID, MACHINE_BY_ID, OPERATION_BY_ID, distanceKm } from "./data/farm-machines.js";
import { available } from "./data/recommendation.js";
import { areaFullLabel } from "./format.js";
import { favoriteIcon, hasListingPhoto, listingSummary, machineVisual, statusClass, statusLabel } from "./listing-view.js";
import { $, escapeHtml, hideDialog, money, showDialog } from "./ui.js";

export function openDetail(id) {
  const item = listingById(id);
  if (!item) return;
  const date = state.filters.date;
  const dateEnd = state.filters.dateEnd || date;
  const booked = item.type === "rent" && date && !available(item, date, dateEnd);
  const unavailable = item.status !== "open" || item.condition === "repair";
  const isFav = app.isFavorite(item.id);

  $("detailContent").innerHTML = `
    <div class="detail-layout">
      <div class="detail-art-col">
        <div class="detail-art">${machineVisual(item)}${hasListingPhoto(item) ? "" : '<span class="machine-example-label">AI 예시 이미지</span>'}</div>
        <div class="detail-checklist">
          <strong> 초보 농부 인수 전 필수 체크리스트</strong>
          <ul>
            <li>시동이 한 번에 잘 걸리고 이상 소음이 없는지 확인하세요.</li>
            <li>내 트랙터·관리기와 작업기 연결 규격이 맞는지 확인하세요.</li>
            <li>비상 정지 스위치와 안전 덮개 등 안전장치를 꼭 점검하세요.</li>
          </ul>
        </div>
      </div>
      <div class="detail-copy">
        <div class="detail-badges">
          <span class="card-status-pill ${statusClass(item)}">${statusLabel(item)}</span>
          <span class="spec-tag"> ${escapeHtml(item.region)} (${distanceKm(state.region, item.region, item.id)}km)</span>
          <span class="spec-tag">${escapeHtml(MACHINE_BY_ID[item.machineType]?.label)}</span>
        </div>
        <h2 id="detailTitle">${escapeHtml(item.title)}</h2>
        ${app.garage?.detail(item) || ""}
        ${item.specification ? `
          <section class="model-specification" aria-label="실제 모델 사양">
            <h3>실제 모델 사양</h3>
            <p>실제 제품 사양을 참조한 가상 매물 · 가격·예약·점검일·권장 면적은 시연용</p>
            <dl class="model-spec-list">
              ${item.specification.facts.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}
              <div><dt>연결 방식</dt><dd>${escapeHtml(item.specification.connection.label)}</dd></div>
            </dl>
            <p><strong>추가 확인:</strong> ${item.specification.unknowns.map(escapeHtml).join(" · ")}</p>
            <div>${item.specification.sources.map((source) => `<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title)} ↗</a><p>${escapeHtml(source.note)} · 확인 ${escapeHtml(source.checkedAt)}</p>`).join("")}</div>
          </section>` : ""}
        <div class="detail-price-box">
          <span class="detail-price-label">${item.type === "rent" ? "1일 대여 요금" : "중고 판매 가격"}</span>
          <div class="detail-price">${money(item.price)} <small>${item.type === "rent" ? "/ 1일 기준" : ""}</small></div>
        </div>

        ${item.type === "rent" ? `<div class="detail-box"><b>대여 일정과 비용</b><p>${date ? `${date} ~ ${dateEnd} · ${booked || unavailable ? "대여 불가" : "대여 가능"}` : "시작일과 반납일을 선택해 대여 가능 여부를 확인하세요."}<br>운송비와 보증금은 소유 농가에 확인해 주세요.</p></div>` : ""}
        <div class="detail-box highlight">
          <b>${state.aiSummaries[item.id] ? "AI 한줄 요약" : "기종 사용 안내"}</b>
          <p>${escapeHtml(listingSummary(item))}</p>
        </div>

        <div class="detail-spec-grid">
          <div class="spec-cell">
            <small>추천 작물</small>
            <strong>${escapeHtml(item.cropIds.map((cropId) => CROP_BY_ID[cropId]?.name).filter(Boolean).join(", "))}</strong>
          </div>
          <div class="spec-cell">
            <small>주요 작업</small>
            <strong>${escapeHtml(item.operations.map((opId) => OPERATION_BY_ID[opId]?.label).filter(Boolean).join(", "))}</strong>
          </div>
          <div class="spec-cell">
            <small>권장 밭 크기</small>
            <strong>${areaFullLabel(item.areaMin, item.areaMax)}</strong>
          </div>
          <div class="spec-cell">
            <small>기계 상태 · 점검일</small>
            <strong>${escapeHtml(item.condition === "good" ? "정상 작동" : item.condition === "used" ? "사용감 있음" : "정비 필요")} (${escapeHtml(item.inspectedAt)})</strong>
          </div>
        </div>

        <div class="detail-box">
          <b> 포함 구성품 및 인수 방법</b>
          <p>포함 작업기/부속: <strong>${escapeHtml(item.included)}</strong><br>인수 방식: <strong>${escapeHtml(item.pickup)}</strong></p>
        </div>

        <div class="detail-box">
          <b> 등록 농가 상세 설명</b>
          <p>${escapeHtml(item.description)}</p>
        </div>

        <div class="detail-actions">
          <button type="button" class="button button-secondary detail-fav-btn" data-detail-fav="${item.id}" aria-label="찜하기" aria-pressed="${isFav}">
            ${favoriteIcon()}
            <span class="favorite-label">${isFav ? "찜한 기계" : "찜하기"}</span>
          </button>
          <button type="button" class="button button-primary button-large" data-detail-action="${item.id}" ${unavailable || booked ? "disabled" : ""}>
            ${unavailable ? "현재 거래 불가" : booked ? "선택 기간 대여 불가" : item.type === "rent" ? " 이 농기계 대여 신청하기" : " 판매자에게 채팅 문의하기"}
          </button>
        </div>
      </div>
    </div>
  `;
  showDialog($("detailBackdrop"));
}

export function bindDetailEvents() {
  $("detailContent").addEventListener("click", (event) => {
    const favBtn = event.target.closest("[data-detail-fav]");
    if (favBtn) return app.toggleFavorite(favBtn.dataset.detailFav);
    const button = event.target.closest("[data-detail-action]");
    if (!button) return;
    hideDialog($("detailBackdrop"));
    const item = listingById(button.dataset.detailAction);
    item.type === "rent" ? app.trade.openRentalForm(item.id) : app.trade.openChat({ listingId: item.id });
  });
  $("detailContent").addEventListener("click", (event) => {
    if (event.target.closest("[data-open-garage]")) {
      hideDialog($("detailBackdrop"));
      app.setView("garage");
      $("ownedModel").focus();
    }
  });
}
