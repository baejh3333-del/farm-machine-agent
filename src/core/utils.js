export const $ = (id) => document.getElementById(id);

export const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);

export const money = (value) => `${Number(value).toLocaleString("ko-KR")}원`;
export const toPyeong = (sqm) => Math.max(1, Math.round(Number(sqm) / 3.305785));
export const areaLabel = (minSqm, maxSqm) => `약 ${toPyeong(minSqm).toLocaleString()}~${toPyeong(maxSqm).toLocaleString()}평`;
export const areaFullLabel = (minSqm, maxSqm) =>
  `약 ${toPyeong(minSqm).toLocaleString()}~${toPyeong(maxSqm).toLocaleString()}평 (${Number(minSqm).toLocaleString()}~${Number(maxSqm).toLocaleString()}㎡)`;

// 웹서버 시간과 내 기기 시간의 차이 (서버 응답의 Date 헤더로 맞춘다)
let serverTimeOffset = 0;
export const serverNow = () => new Date(Date.now() + serverTimeOffset);
export const today = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(serverNow());

export const addDays = (isoDate, days) => {
  const d = new Date(`${isoDate}T12:00:00+09:00`);
  d.setUTCDate(d.getUTCDate() + days);
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
};

export const koreanDateParts = (isoDate) => {
  const d = new Date(`${isoDate}T12:00:00+09:00`);
  const fmt = (opts) => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", ...opts }).format(d);
  return { date: fmt({ year: "numeric", month: "long", day: "numeric" }), weekday: fmt({ weekday: "long" }) };
};

export async function syncServerTime() {
  try {
    const response = await fetch(location.pathname || "/", { method: "HEAD", cache: "no-store" });
    const header = response.headers.get("date");
    if (header) serverTimeOffset = new Date(header).getTime() - Date.now();
  } catch {
    // 서버 시간을 못 받으면 기기 시간을 그대로 쓴다
  }
}

export const BEGINNER_TIPS = {
  pepper: {
    default: "고추 농사는 봄철 밭 갈기와 두둑 만들기·비닐 멀칭이 핵심이에요. 작업 면적과 필요한 부착기를 확인한 뒤 관리기와 휴립·멀칭기를 비교해 보세요.",
    till: "흙갈이(로터리) 작업은 땅을 부드럽게 부수어 뿌리가 잘 내리게 해줘요. 작은 밭은 관리기, 넓은 밭은 트랙터를 선택하세요.",
    ridge: "고추는 물빠짐이 중요해 높은 두둑을 만들어야 해요. 두둑성형기가 달린 관리기는 두둑 폭과 작업기 규격을 확인해 보세요.",
    mulch: "비닐 씌우기(멀칭)는 잡초를 막고 땅 온도를 유지해 줘요. 휴립·멀칭기를 쓰면 두둑과 비닐 피복을 한 번에 할 수 있어요.",
    transplant: "모종 심기(정식)는 정식기를 사용하면 허리를 굽히지 않고 일정한 간격으로 빠르게 심을 수 있어요.",
    spray: "고추 탄저병·진딧물 예방을 위해 주기적인 방제가 필수예요. 동력분무기나 방제기를 대여해 시간을 아껴보세요.",
  },
  rice: {
    default: "벼농사는 봄철 논 고르기·모내기(이앙)와 가을 콤바인 수확이 가장 큰일이에요. 고가 장비는 필요한 날만 대여해 보세요.",
    level: "모내기 전 논바닥을 평평하게 고르는 작업이에요. 트랙터 로터리·써레 작업기를 확인하세요.",
    ricePlant: "이앙기는 논에 모를 옮겨 심는 데 쓰입니다. 조수(줄 수)와 승용/보행 여부를 확인하세요.",
    riceHarvest: "콤바인은 벼를 베고 탈곡하는 장비입니다. 작업 기간과 논 진입 조건을 확인하세요.",
  },
  cabbage: {
    default: "배추는 초기 두둑 만들기, 비닐 멀칭, 모종 정식과 수확 후 운반 작업에 농기계를 쓰면 노동력을 크게 줄일 수 있어요.",
    mulch: "배추밭도 비닐 멀칭을 해두면 풀 뽑는 수고와 물 주기가 훨씬 수월해집니다.",
    transplant: "배추 모종을 일정한 간격으로 빠르게 심을 수 있는 정식기를 추천해요.",
    transport: "무거운 배추 망을 밭에서 옮길 때는 농용 운반차가 있으면 허리 부담 없이 안전하게 실어 나를 수 있어요.",
  },
  potato: {
    default: "감자는 파종부터 북주기, 땅속 감자를 캐내는 굴취 작업까지 전용 작업기를 쓰면 손상이 적고 수확이 정말 빨라져요.",
    seed: "씨감자 파종기를 쓰면 일정한 깊이와 간격으로 빠르게 심을 수 있어요.",
    hill: "감자가 자랄 때 흙을 덮어주는 북주기를 해주면 감자가 푸르게 변하는 것을 막고 수확량이 늘어납니다.",
    potatoHarvest: "감자 굴취기는 땅속 감자를 들어 올리는 작업기입니다. 두둑 폭과 부착 방식을 확인하세요.",
  },
  all: {
    default: "키우는 작물(고추·벼·배추·감자)을 먼저 누르면, 해당 작물의 작업과 관련 농기계를 찾아볼 수 있어요.",
  },
};

let toastTimer;
export function setToastVisible(value) {
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

export function hideDialog(backdrop, onBeforeHide) {
  if (backdrop.hidden) return;
  if (typeof onBeforeHide === "function") onBeforeHide(backdrop);
  backdrop.hidden = true;
  dialogOpeners.get(backdrop)?.focus();
  dialogOpeners.delete(backdrop);
  if (["filterBackdrop", "detailBackdrop", "formBackdrop"].every((id) => $(id).hidden)) {
    document.body.style.overflow = "";
  }
}

const LISTING_PHOTO = /^data:image\/(?:png|jpeg|webp);base64,/i;
export const getListingPhotoSrc = (item) => {
  if (typeof item?.photoUrl === "string" && item.photoUrl.startsWith("/api/photos")) return item.photoUrl;
  if (typeof item?.photo === "string" && LISTING_PHOTO.test(item.photo)) return item.photo;
  return "";
};
export const hasListingPhoto = (item) => Boolean(getListingPhotoSrc(item));
const MACHINE_IMAGE_FALLBACK = {
  tiller: "cultivator",
  ridingCultivator: "cultivator",
  rotavator: "tractor",
  plow: "tractor",
  spreader: "tractor",
  loader: "tractor",
  baler: "tractor",
  speedSprayer: "sprayer",
  agriDrone: "sprayer",
  garlicOnionPlanter: "potatoPlanter",
  rootHarvester: "potatoHarvester",
  mower: "cultivator",
  shredder: "cultivator",
  thresher: "combine",
  excavator: "tractor",
  aerialLift: "carrier",
  seeder: "potatoPlanter",
  ridger: "ridgeMulcher",
  dryer: "combine",
  sorter: "combine",
  forageHarvester: "combine",
};
export const machineImage = (type) => {
  const id = typeof type === "string" ? type : type?.id;
  const resolved = MACHINE_IMAGE_FALLBACK[id] || id || "tractor";
  return `./src/images/machines/${resolved}.jpg`;
};

const AVAILABLE_PICTURE_ICONS = new Set([
  "bulb",
  "cabbage",
  "calendar",
  "envelope",
  "good",
  "handshake",
  "heart-outline",
  "heart",
  "pepper",
  "pickup",
  "potato",
  "repair",
  "rice",
  "search",
  "sliders",
  "sprout",
]);

const CROP_FALLBACK_EMOJI = {
  soybean: "🥜",
  corn: "🌽",
  sweetPotato: "🍠",
  barley: "🌾",
  garlic: "🧄",
  onion: "🧅",
  radish: "🌱",
  greenOnion: "🥬",
  ginger: "🌿",
  apple: "🍎",
  pear: "🍐",
  peach: "🍑",
  grape: "🍇",
  strawberry: "🍓",
  tomato: "🍅",
  sesame: "🌱",
  redBean: "🥜",
  millet: "🌾",
};

export function pictureIcon(name) {
  if (AVAILABLE_PICTURE_ICONS.has(name)) {
    return `<img class="picture-icon" src="./src/images/icons/${name}.jpg" alt="" width="32" height="32">`;
  }
  const emoji = CROP_FALLBACK_EMOJI[name] || "🌱";
  return `<span class="picture-icon picture-icon-emoji" aria-hidden="true">${emoji}</span>`;
}

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
