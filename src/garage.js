import { MACHINE_SPECIFICATIONS, SPEC_BY_ID, checkModelCompatibility } from "./data/machine-specifications.js";
import { findCompatibleRentals } from "./data/compatibility.js";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = (value) => `${value.toLocaleString("ko-KR")}원`;
const labels = { compatible: "호환 가능", check: "추가 확인 필요", incompatible: "호환 불가", notApplicable: "연결 불필요" };
export const compatibilityBadge = (verdict) => `<span class="compat-badge compat-${verdict.status}">${labels[verdict.status]}</span>`;

// storage.load()은 { owned, selectedId }를, storage.save(owned, selectedId)는 성공 여부를 돌려준다.
// 로그인 전에는 브라우저에, 로그인 후에는 계정에 저장한다(user-store.js).
function sanitize(saved) {
  const ids = new Set();
  const owned = (Array.isArray(saved?.owned) ? saved.owned : []).filter((item) => {
    if (!item || typeof item.id !== "string" || ids.has(item.id) || SPEC_BY_ID[item.modelId]?.role !== "powerUnit" || typeof item.name !== "string") return false;
    ids.add(item.id); return true;
  }).map((item) => ({ id: item.id, modelId: item.modelId, name: item.name.slice(0, 40) }));
  const selectedId = owned.some((item) => item.id === saved?.selectedId) ? saved.selectedId : owned[0]?.id || "";
  return { owned, selectedId };
}

export function createGarage({ root, storage, getListings, getCatalogState, today, openListing, openRental, notify }) {
  let { owned, selectedId } = sanitize(storage.load());
  let mode = owned.length ? "owned" : "set";
  const selected = () => owned.find((item) => item.id === selectedId);
  function save(next, nextSelected) {
    if (!storage.save(next, nextSelected)) { notify("보유 농기계를 저장하지 못했습니다."); return false; }
    owned = next; selectedId = nextSelected; return true;
  }
  root.innerHTML = `
    <section class="garage-hero"><div><span class="garage-eyebrow">MY FARM GARAGE</span><h1>내 기계에 딱 맞는<br>작업기를 찾아보세요.</h1><p>보유한 농기계를 등록해 연결 규격을 비교하고,<br>기계가 없다면 호환되는 세트로 찾아보세요.</p></div><div class="garage-hero-mark" aria-hidden="true">🚜<span> + </span>🌱</div></section>
    <div class="garage-layout">
      <section class="garage-panel" aria-labelledby="ownedTitle"><div class="garage-section-title"><h2 id="ownedTitle">내 농기계</h2><span id="ownedCount"></span></div><p class="garage-note">판매·대여 매물 등록과 별개입니다. 이 브라우저에만 저장돼요.</p><div id="ownedMachines"></div>
        <details class="garage-register" open><summary>+ 보유 농기계 등록</summary><form id="ownedMachineForm">
          <label for="ownedModel">제조사 · 모델<select id="ownedModel" required><option value="">모델을 선택하세요</option>${MACHINE_SPECIFICATIONS.filter((m) => m.role === "powerUnit").map((m) => `<option value="${m.id}">${esc(m.brand)} ${esc(m.model)}</option>`).join("")}</select></label>
          <label for="ownedName">기계 별명 <span>(선택)</span><input id="ownedName" maxlength="40" placeholder="예: 우리 집 관리기"></label>
          <p class="garage-note">목록에 없는 모델은 규격 확인 후 추가할 수 있어요. 비슷한 모델로 대신 등록하지 마세요.</p><button class="button button-primary" type="submit">내 농기계 저장</button>
        </form></details>
      </section>
      <section class="garage-panel garage-discovery" aria-labelledby="compatTitle"><div class="garage-section-title"><h2 id="compatTitle">호환 작업기 찾기</h2><span class="garage-demo">시연용 매물</span></div>
        <div class="garage-tabs" role="group" aria-label="추천 방식"><button type="button" data-garage-mode="owned">내 기계에 연결</button><button type="button" data-garage-mode="set">본체 + 작업기 세트</button></div>
        <p id="garageModeHelp" class="garage-mode-help"></p>
        <form id="compatSearch"><div class="garage-search-fields"><label>작업<select id="compatOperation"><option value="">모든 작업</option><option value="ridge">두둑 만들기</option><option value="mulch">비닐 멀칭</option><option value="seed">감자 파종</option><option value="potatoHarvest">감자 굴취</option></select></label><label>대여 시작일<input id="compatStart" type="date" min="${today()}" required></label><label>반납일<input id="compatEnd" type="date" min="${today()}" required></label></div>
        <div class="garage-search-actions"><label id="compatOnlyLabel"><input id="compatOnly" type="checkbox"> 호환 가능한 작업기만</label><button class="button button-primary" type="submit">호환 매물 찾기</button></div></form>
        <p class="garage-note">제조사 명시 조합을 우선합니다. 연식·개조 여부·실제 부속 구성은 인수 전에 확인해 주세요.</p><div id="compatResults" aria-live="polite"></div>
      </section>
    </div>`;
  const $ = (id) => root.querySelector(`#${id}`);
  let searched = false;
  function refreshOwned() {
    $("ownedCount").textContent = `${owned.length}대`;
    $("ownedMachines").innerHTML = owned.length ? owned.map((item) => {
      const model = SPEC_BY_ID[item.modelId];
      return `<article class="owned-machine ${item.id === selectedId ? "is-selected" : ""}"><div class="owned-machine-icon" aria-hidden="true">🚜</div><div><strong>${esc(item.name || model.model)}</strong><p>${esc(model.brand)} ${esc(model.model)}</p><small>${esc(model.facts.find(([label]) => /마력|출력/.test(label))?.[1] || model.connection.label)}</small><div class="owned-actions"><button type="button" data-owned-select="${esc(item.id)}" aria-pressed="${item.id === selectedId}">${item.id === selectedId ? "✓ 기준 기계" : "기준으로 선택"}</button><button type="button" data-owned-remove="${esc(item.id)}" aria-label="${esc(item.name || model.model)} 삭제">삭제</button></div></div></article>`;
    }).join("") : `<div class="garage-empty"><strong>아직 등록한 기계가 없어요</strong><p>트랙터나 관리기를 등록하면<br>호환 이유를 함께 확인할 수 있어요.</p></div>`;
    refreshMode();
  }
  function refreshMode() {
    root.querySelectorAll("[data-garage-mode]").forEach((button) => { button.setAttribute("aria-pressed", String(button.dataset.garageMode === mode)); });
    $("compatOnlyLabel").hidden = mode === "set";
    $("garageModeHelp").textContent = mode === "set" ? "같은 기간에 빌릴 수 있는 호환 본체와 작업기를 총 대여료 순으로 추천해요. 인수 장소는 각각 확인하세요." : selected() ? `${selected().name || SPEC_BY_ID[selected().modelId].model} 기준으로 비교해요. 본체 대여료는 포함하지 않아요.` : "왼쪽에서 내 농기계를 등록하면 작업기와 비교할 수 있어요.";
    refreshResults();
  }
  function searchOptions() { return { mode, modelId: selected()?.modelId, operation: $("compatOperation").value, start: $("compatStart").value, end: $("compatEnd").value, today: today(), onlyCompatible: $("compatOnly").checked }; }
  function refreshResults() {
    if (!searched) { $("compatResults").innerHTML = '<div class="garage-empty"><strong>어떤 날, 어떤 작업이 필요한가요?</strong><p>기간을 선택하면 예약이 겹치는 매물은 제외해 드려요.</p></div>'; return; }
    if (getCatalogState() !== "ready") { $("compatResults").innerHTML = `<div class="garage-empty">${getCatalogState() === "loading" ? "매물을 불러오는 중입니다…" : "매물을 불러오지 못했습니다. 매물 찾기에서 다시 불러와 주세요."}</div>`; return; }
    const { error, results } = findCompatibleRentals(getListings(), searchOptions());
    if (error) { $("compatResults").innerHTML = `<div class="garage-empty">${esc(error)}</div>`; return; }
    if (!results.length) { $("compatResults").innerHTML = `<div class="garage-empty"><strong>조건에 맞는 ${mode === "set" ? "호환 세트" : "작업기"}가 없어요</strong><p>작업이나 기간을 변경해 보세요.${mode === "set" ? " 확인되지 않은 조합은 세트로 추천하지 않아요." : ""}</p></div>`; return; }
    $("compatResults").innerHTML = `<p class="garage-result-count">${results.length}개 ${mode === "set" ? "호환 조합" : "작업기"} · ${results[0].days}일 기준 · 호환 여부와 총액 순${results.length > 12 ? " · 상위 12개 표시" : ""}</p>` + results.slice(0, 12).map((result) => {
      const { power, implement, verdict, dailyPrice, totalPrice, days } = result;
      const machines = power ? [power, implement] : [implement];
      return `<article class="compat-result">${compatibilityBadge(verdict)}<h3>${power ? `${esc(power.model)} <span>+</span> ` : ""}${esc(implement.model)}</h3><p class="compat-reason">${esc(verdict.reason)}</p><div class="compat-machines">${machines.map((item) => `<div><span>${item === power ? "본체" : "작업기"}</span><strong>${esc(item.brand)} ${esc(item.model)}</strong><small>${esc(item.region)} · ${esc(item.pickup)} · ${money(item.price)}/일</small><div class="compat-item-actions"><button type="button" data-garage-detail="${esc(item.id)}">사양·상세 보기 ↗</button>${verdict.status === "compatible" ? `<button type="button" data-garage-rent="${esc(item.id)}">대여 요청</button>` : ""}</div></div>`).join("")}</div><div class="compat-total"><span>${days}일 총 대여료<small>하루 ${money(dailyPrice)} · 운반비 별도</small></span><strong>${money(totalPrice)}</strong></div>${power ? '<p class="garage-note">두 매물에 각각 요청하고 승인을 받아야 해요. 세트 예약이 한 번에 확정되지는 않아요.</p>' : ""}</article>`;
    }).join("");
  }
  $("ownedMachineForm").addEventListener("submit", (event) => {
    event.preventDefault(); const modelId = $("ownedModel").value;
    if (SPEC_BY_ID[modelId]?.role !== "powerUnit") return;
    const item = { id: crypto.randomUUID(), modelId, name: $("ownedName").value.trim() || SPEC_BY_ID[modelId].model };
    if (!save([...owned, item], item.id)) return;
    mode = "owned"; $("ownedMachineForm").reset(); refreshOwned(); notify("내 농기계를 저장하고 기준 기계로 선택했습니다.");
  });
  $("compatSearch").addEventListener("submit", (event) => { event.preventDefault(); searched = true; refreshResults(); });
  $("compatStart").addEventListener("change", () => {
    $("compatEnd").min = $("compatStart").value || today();
    if (!$("compatEnd").value || $("compatEnd").value < $("compatStart").value) $("compatEnd").value = $("compatStart").value;
    if (searched) refreshResults();
  });
  for (const id of ["compatEnd", "compatOperation", "compatOnly"]) $(id).addEventListener("change", () => { if (searched) refreshResults(); });
  root.addEventListener("click", (event) => {
    const button = event.target.closest("button"); if (!button) return;
    if (button.dataset.garageMode) { mode = button.dataset.garageMode; refreshMode(); }
    if (button.dataset.ownedSelect && save(owned, button.dataset.ownedSelect)) refreshOwned();
    if (button.dataset.ownedRemove) {
      const next = owned.filter((item) => item.id !== button.dataset.ownedRemove);
      if (save(next, next.some((item) => item.id === selectedId) ? selectedId : next[0]?.id || "")) { refreshOwned(); notify("보유 목록에서 삭제했습니다."); }
    }
    if (button.dataset.garageDetail) openListing(button.dataset.garageDetail);
    if (button.dataset.garageRent) {
      const current = findCompatibleRentals(getListings(), searchOptions());
      const result = current.results.find((item) => item.verdict.status === "compatible" && (item.implement.id === button.dataset.garageRent || item.power?.id === button.dataset.garageRent));
      if (!result) { refreshResults(); notify("대여 조건이 변경됐습니다. 다시 확인해 주세요."); return; }
      openRental(button.dataset.garageRent, $("compatStart").value, $("compatEnd").value);
    }
  });
  refreshOwned();
  return {
    refresh: refreshResults,
    // 로그인·로그아웃이나 서버 저장 결과가 오면 저장소에서 다시 읽는다.
    reload() {
      ({ owned, selectedId } = sanitize(storage.load()));
      if (!owned.length) mode = "set";
      refreshOwned();
    },
    detail(item) {
      if (!item.specification) return "";
      if (item.specification.role !== "implement") return `<div class="detail-compatibility"><strong>${item.specification.role === "powerUnit" ? "내 기계와 작업기를 함께 비교하세요" : "독립 구동 장비입니다"}</strong><p>${item.specification.role === "powerUnit" ? "내 농기계에 등록하거나, 이 모델과 호환되는 대여 세트를 찾아보세요." : "트랙터·관리기에 연결하지 않고 사용합니다."}</p><button type="button" class="button button-secondary" data-open-garage>내 농기계 · 호환 세트 찾기</button></div>`;
      const own = selected();
      const verdict = own ? checkModelCompatibility(own.modelId, item.modelId) : { status: "check", reason: "내 트랙터·관리기를 등록하면 호환 여부를 비교할 수 있어요." };
      return `<div class="detail-compatibility">${compatibilityBadge(verdict)}<strong>${own ? `${esc(own.name)} 기준` : "내 농기계와 맞을까요?"}</strong><p>${esc(verdict.reason)}</p><button type="button" class="button button-secondary" data-open-garage>내 농기계 · 호환 세트 찾기</button></div>`;
    },
  };
}
