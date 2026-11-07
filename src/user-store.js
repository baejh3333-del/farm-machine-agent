import { chatApi, meApi, requestsApi } from "./api.js";

// 사용자별 데이터(찜, 보유 농기계, 대여 신청, 채팅)를 한곳에서 관리한다.
// 로그인 전: 찜과 보유 농기계만 이 브라우저에 저장한다. 로그인 후: 모두 계정(서버)에 저장한다.
const GUEST_FAVORITES = "moa-guest-favorites-v1";
const GUEST_MACHINES = "moa-owned-machines-v1";
const SELECTED_MACHINE = "moa-selected-machine-v1";
const LEGACY_STATE = "moa-farm-v1";
const LEGACY_OWNER_DB = "moa-owner-db-v1";
const LEGACY_TRADE_FIELDS = ["requests", "messages", "customListings", "statuses", "bookings"];

function read(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}
function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
function remove(key) {
  try { localStorage.removeItem(key); } catch { /* 저장소를 못 쓰면 지울 것도 없다 */ }
}

// 예전 버전이 브라우저에 남긴 거래 데이터를 지운다. 찜은 로그인 전 찜으로 옮긴다.
// 지운 거래 기록이 있었으면 true를 돌려준다(한 번 안내하기 위해).
export function cleanupLegacyData() {
  let removed = false;
  const legacy = read(LEGACY_STATE, null);
  if (legacy && typeof legacy === "object") {
    removed = LEGACY_TRADE_FIELDS.some((field) => (Array.isArray(legacy[field]) ? legacy[field].length : legacy[field] && Object.keys(legacy[field]).length));
    if (Array.isArray(legacy.favorites) && read(GUEST_FAVORITES, null) === null) write(GUEST_FAVORITES, legacy.favorites);
    for (const field of [...LEGACY_TRADE_FIELDS, "favorites"]) delete legacy[field];
    write(LEGACY_STATE, legacy);
  }
  if (read(LEGACY_OWNER_DB, null) !== null) {
    remove(LEGACY_OWNER_DB);
    removed = true;
  }
  return removed;
}

export function createUserStore({ notify }) {
  let user = null;
  let account = { favorites: [], ownedMachines: [] };
  let requests = [];
  let ownerRequests = [];
  let conversations = [];
  const listeners = new Set();
  const changed = () => listeners.forEach((listener) => listener());
  const guestFavorites = () => read(GUEST_FAVORITES, []).filter((id) => typeof id === "string");

  async function refresh() {
    if (!user) return;
    const [me, mine, owner, chats] = await Promise.allSettled([
      meApi.get(), requestsApi.list("requester"), requestsApi.list("owner"), chatApi.list(),
    ]);
    if (me.status === "fulfilled") account = me.value;
    if (mine.status === "fulfilled") requests = mine.value;
    if (owner.status === "fulfilled") ownerRequests = owner.value;
    if (chats.status === "fulfilled") conversations = chats.value;
    if ([me, mine, owner, chats].some((result) => result.status === "rejected")) notify("일부 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
    changed();
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get user() { return user; },
    get favorites() { return user ? account.favorites : guestFavorites(); },
    get requests() { return requests; },
    get ownerRequests() { return ownerRequests; },
    get conversations() { return conversations; },
    refresh,

    // 로그인하면 로그인 전에 모아 둔 찜·보유 농기계를 계정에 합친 뒤 서버 데이터를 불러온다.
    // 로그아웃하면 이전 사용자의 데이터를 메모리에서 모두 지운다.
    async setUser(nextUser) {
      user = nextUser ?? null;
      account = { favorites: [], ownedMachines: [] };
      requests = [];
      ownerRequests = [];
      conversations = [];
      if (!user) return changed();
      const favorites = guestFavorites();
      const ownedMachines = read(GUEST_MACHINES, {})?.owned ?? [];
      if (favorites.length || ownedMachines.length) {
        try {
          account = await meApi.merge({ favorites, ownedMachines });
          remove(GUEST_FAVORITES);
          remove(GUEST_MACHINES);
          changed();
          notify("로그인 전에 저장한 찜과 보유 농기계를 계정에 합쳤어요.");
        } catch (error) {
          notify(error.message);
        }
      }
      await refresh();
    },

    async toggleFavorite(listingId) {
      const on = !this.favorites.includes(listingId);
      if (!user) {
        const next = on ? [...guestFavorites(), listingId] : guestFavorites().filter((id) => id !== listingId);
        if (!write(GUEST_FAVORITES, next)) throw new Error("브라우저 저장 공간을 사용할 수 없어요.");
        changed();
        return on;
      }
      const previous = account.favorites;
      account = { ...account, favorites: on ? [...previous, listingId] : previous.filter((id) => id !== listingId) };
      changed();
      try {
        account = await meApi.favorite(listingId, on);
      } catch (error) {
        account = { ...account, favorites: previous };
        changed();
        throw error;
      }
      changed();
      return on;
    },

    // garage.js가 쓰는 저장소. 로그인 후에는 화면을 먼저 바꾸고 서버에 저장한다. 실패하면 서버 값으로 되돌린다.
    machineStorage: {
      load() {
        if (!user) return read(GUEST_MACHINES, {});
        return { owned: account.ownedMachines, selectedId: read(SELECTED_MACHINE, "") };
      },
      save(owned, selectedId) {
        if (!user) return write(GUEST_MACHINES, { owned, selectedId });
        write(SELECTED_MACHINE, selectedId);
        const changedList = JSON.stringify(owned) !== JSON.stringify(account.ownedMachines);
        account = { ...account, ownedMachines: owned };
        if (changedList) {
          meApi.saveMachines(owned)
            .then((data) => { account = data; changed(); })
            .catch((error) => { notify(error.message); refresh(); });
        }
        return true;
      },
    },

    async createRequest(input) {
      const request = await requestsApi.create(input);
      requests = [request, ...requests.filter((item) => item.id !== request.id)];
      changed();
      return request;
    },

    // 승인·거절·취소 후에는 양쪽 목록과 예약 현황이 함께 바뀌므로 다시 불러온다.
    async act(action, id) {
      const request = await requestsApi.act(action, id);
      await refresh();
      return request;
    },
  };
}
