// 농농이(에이전트)가 로그인한 사용자의 마이페이지를 읽고, 허용된 항목만 고치게 해 주는 도우미.
//
// 원칙
// - 읽기·쓰기 모두 세션의 user.id로만 한다. 모델이 준 사용자 ID는 받지 않는다.
// - 쓰기는 모델이 곧바로 하지 않는다. propose → (화면 승인 또는 "네") → execute 순서로만 실행한다.
// - 실행은 마이페이지 화면이 쓰는 기존 서비스 함수(user-data, rentals, listings-service, education-certificate)를
//   그대로 불러 소유권·상태·입력 검증을 서비스에 맡긴다. DB를 직접 고치지 않는다.
// - 아래 MY_PAGE_OPERATIONS에 있는 작업과 필드만 허용한다. 비밀번호·아이디(이메일)·세션·전화번호,
//   교육이수증 사진 원본 같은 민감 정보는 읽지도 쓰지도 않는다.
import { randomUUID } from "node:crypto";
import { SPEC_BY_ID } from "../src/data/machine-specifications.js";
import { getPool } from "./db.js";
import { fail, HttpError } from "./http.js";
import { isUuid } from "./validate.js";

const SECTIONS = ["profile", "favorites", "ownedMachines", "rentalRequests", "myListings", "deals", "educationCertificate"];
const LISTING_STATUS_LABEL = { open: "거래 가능", dealing: "거래 중", done: "거래 완료", removed: "숨김" };
const REQUEST_STATE_LABEL = {
  approvable: "승인 대기",
  conflict: "다른 예약과 겹침",
  expired: "기간 지남",
  upcoming: "예약 확정(시작 전)",
  active: "대여 중",
  completed: "대여 끝",
  rejected: "거절됨",
  cancelled: "취소됨",
};
const MAX_ITEMS = 20;

/** 기본 의존성: 마이페이지 화면(/api/me, /api/requests, /api/listings)이 쓰는 서비스와 같다. 테스트에서 바꿔 끼운다. */
async function defaultDeps(pool) {
  const [userData, rentals, listingsDb, listingsService, cert, chat] = await Promise.all([
    import("./user-data.js"),
    import("./rentals.js"),
    import("./listings-db.js"),
    import("./listings-service.js"),
    import("./education-certificate.js"),
    import("./chat.js"),
  ]);
  return {
    getUserData: (userId) => userData.getUserData(userId, { pool }),
    fetchListings: (opts) => listingsDb.fetchListings({ ...opts, pool }),
    listRequestsForUser: (userId) => rentals.listRequestsForUser(userId, { pool }),
    listConversationsForUser: (userId) => chat.listConversationsForUser(userId, { pool }),
    getEducationCertificateStatus: (userId) => cert.getEducationCertificateStatus(userId, { pool }),
    updateUserNickname: (userId, name) => userData.updateUserNickname(userId, name, { pool }),
    toggleFavorite: (userId, listingId, favorite) => userData.toggleFavorite(userId, listingId, { favorite, pool }),
    addOwnedMachine: (userId, payload) => userData.addOwnedMachine(userId, payload, { pool }),
    selectOwnedMachine: (userId, id) => userData.selectOwnedMachine(userId, id, { pool }),
    removeOwnedMachine: (userId, id) => userData.removeOwnedMachine(userId, id, { pool }),
    approveRentalRequest: (user, id) => rentals.approveRentalRequest(user, id, { pool }),
    rejectRentalRequest: (user, id) => rentals.rejectRentalRequest(user, id, { pool }),
    cancelRentalRequest: (user, id) => rentals.cancelRentalRequest(user, id, { pool }),
    updateListing: (user, payload) => listingsService.updateListing(user, payload, { pool }),
    deleteEducationCertificate: (userId) => cert.deleteEducationCertificate(userId, { pool }),
  };
}

async function resolveDeps(deps) {
  if (deps) return deps;
  return defaultDeps(getPool());
}

function requireSignedIn(user) {
  if (!user || typeof user.id !== "string" || !user.id) {
    fail(401, "LOGIN_REQUIRED", "로그인 후에 마이페이지를 볼 수 있어요.");
  }
}

function clip(value, max = 60) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function cleanSections(raw) {
  const list = Array.isArray(raw) ? raw.filter((s) => SECTIONS.includes(s)) : [];
  return list.length ? [...new Set(list)] : SECTIONS;
}

function rentalView(r, role) {
  return {
    id: r.id,
    listingTitle: clip(r.listingTitle),
    counterpartName: clip(role === "incoming" ? r.requesterName : r.listingOwnerName, 40),
    start: r.start,
    end: r.end,
    days: r.days,
    totalPrice: r.totalPrice,
    state: r.derivedState,
    stateLabel: REQUEST_STATE_LABEL[r.derivedState] || REQUEST_STATE_LABEL[r.status] || r.status,
    canApprove: Boolean(r.canApprove),
    canReject: Boolean(r.canReject),
    canCancel: Boolean(r.canCancel),
  };
}

function dealView(c) {
  const stage = c.trade?.stage ?? c.trade?.negotiation?.stage ?? null;
  return {
    id: c.id,
    listingTitle: clip(c.listingTitle),
    listingType: c.listingType,
    myRole: c.myRole,
    counterpartName: clip(c.myRole === "owner" ? c.buyerName : c.ownerName, 40),
    unreadCount: Number(c.unreadCount) || 0,
    waitingForUser: Boolean(c.waitingForUser),
    myAiMode: c.myRole === "owner" ? c.ownerAiMode : c.buyerAiMode,
    ...(typeof stage === "string" ? { stage } : {}),
  };
}

/**
 * 로그인 사용자의 마이페이지 요약(읽기 전용). 모두 user.id 범위로만 조회하고, 화면에 보이는 정도의 필드만 돌려준다.
 * 메시지 본문·요청 메모·이수증 사진·이메일·다른 사용자 ID는 담지 않는다.
 */
export async function getMyPageSnapshot(user, { sections, deps } = {}) {
  requireSignedIn(user);
  const d = await resolveDeps(deps);
  const want = new Set(cleanSections(sections));
  const needUserData = want.has("favorites") || want.has("ownedMachines");
  const needCatalog = want.has("favorites");

  const [userData, catalog, requests, ownListings, conversations, cert] = await Promise.all([
    needUserData ? d.getUserData(user.id) : null,
    needCatalog ? d.fetchListings({ viewerId: user.id }) : null,
    want.has("rentalRequests") ? d.listRequestsForUser(user.id) : null,
    want.has("myListings") ? d.fetchListings({ viewerId: user.id, ownerOnly: true }) : null,
    want.has("deals") ? d.listConversationsForUser(user.id) : null,
    want.has("educationCertificate") ? d.getEducationCertificateStatus(user.id) : null,
  ]);

  const out = {};
  if (want.has("profile")) out.profile = { name: clip(user.name, 40) };
  if (want.has("favorites")) {
    const byId = new Map((catalog || []).map((l) => [l.id, l]));
    const favs = (userData?.favorites || []).map((id) => byId.get(id)).filter(Boolean);
    out.favorites = {
      count: favs.length,
      items: favs.slice(0, MAX_ITEMS).map((l) => ({ listingId: l.id, title: clip(l.title), type: l.type, price: l.price, region: clip(l.region, 40) })),
    };
  }
  if (want.has("ownedMachines")) {
    out.ownedMachines = (userData?.ownedMachines || []).slice(0, MAX_ITEMS).map((m) => ({
      id: m.id,
      name: clip(m.name, 40),
      modelId: m.modelId,
      model: clip(m.specification?.model || "", 40),
      isSelected: Boolean(m.isSelected),
    }));
  }
  if (want.has("rentalRequests")) {
    out.rentalRequests = {
      sent: (requests?.outgoing || []).slice(0, MAX_ITEMS).map((r) => rentalView(r, "outgoing")),
      received: (requests?.incoming || []).slice(0, MAX_ITEMS).map((r) => rentalView(r, "incoming")),
      approvableCount: Number(requests?.approvableCount) || 0,
    };
  }
  if (want.has("myListings")) {
    out.myListings = (ownListings || []).filter((l) => l.ownerId === user.id).slice(0, MAX_ITEMS).map((l) => ({
      listingId: l.id,
      title: clip(l.title),
      type: l.type,
      price: l.price,
      status: l.status,
      statusLabel: LISTING_STATUS_LABEL[l.status] || l.status,
    }));
  }
  if (want.has("deals")) {
    out.deals = (conversations || []).slice(0, MAX_ITEMS).map(dealView);
  }
  if (want.has("educationCertificate")) {
    out.educationCertificate = { uploaded: Boolean(cert?.uploaded), uploadedAt: cert?.uploadedAt || null };
  }
  return out;
}

// ---------------------------------------------------------------------------
// 쓰기: 허용 목록. 각 작업은 받을 필드(args)와 검증, 사전 확인(precheck), 실행(run)을 가진다.
// precheck는 읽기만 해서 "확인 카드"를 만들기 전에 대상이 내 것인지, 지금 가능한지를 미리 본다.
// run은 승인 뒤 기존 서비스로만 실행한다(서비스가 소유권·상태를 다시 검사한다).
// ---------------------------------------------------------------------------

function text(value, { field, max }) {
  const v = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (!v || v.length > max) fail(400, "INVALID_INPUT", `${field}은(는) 1~${max}자여야 합니다.`);
  return v;
}

function listingId(value) {
  return text(value, { field: "매물 ID", max: 80 });
}

function uuid(value, field) {
  if (!isUuid(value)) fail(400, "INVALID_INPUT", `${field} 형식이 올바르지 않습니다.`);
  return value.trim().toLowerCase();
}

async function findRequest(d, user, id) {
  const data = await d.listRequestsForUser(user.id);
  const all = [...(data?.incoming || []).map((r) => ({ ...r, side: "received" })), ...(data?.outgoing || []).map((r) => ({ ...r, side: "sent" }))];
  const found = all.find((r) => r.id === id);
  if (!found) fail(404, "RENTAL_REQUEST_NOT_FOUND", "내 대여 요청 목록에서 찾을 수 없어요.");
  return found;
}

async function findOwned(d, user, id) {
  const data = await d.getUserData(user.id);
  const found = (data?.ownedMachines || []).find((m) => m.id === id);
  if (!found) fail(404, "OWNED_MACHINE_NOT_FOUND", "내 농기계 목록에서 찾을 수 없어요.");
  return found;
}

async function findOwnListing(d, user, id) {
  const own = await d.fetchListings({ viewerId: user.id, ownerOnly: true });
  const found = (own || []).find((l) => l.id === id && l.ownerId === user.id && l.status !== "removed");
  if (!found) fail(404, "LISTING_NOT_FOUND", "내가 등록한 매물에서 찾을 수 없어요.");
  return found;
}

function reqLabel(r) {
  return `${clip(r.listingTitle, 40)} ${r.start}~${r.end}`;
}

export const MY_PAGE_OPERATIONS = {
  update_nickname: {
    rateKind: "message",
    args: (a) => ({ name: text(a?.name, { field: "닉네임", max: 40 }) }),
    precheck: async (_d, _u, args) => ({ summary: `닉네임을 '${args.name}'(으)로 바꿀까요?` }),
    run: async (d, user, args) => {
      const res = await d.updateUserNickname(user.id, args.name);
      return { message: `닉네임을 '${res.user?.name ?? args.name}'(으)로 바꿨어요.`, profile: { name: res.user?.name ?? args.name } };
    },
  },
  add_favorite: {
    rateKind: "message",
    args: (a) => ({ listingId: listingId(a?.listingId) }),
    precheck: async (d, user, args) => {
      const item = (await d.fetchListings({ viewerId: user.id })).find((l) => l.id === args.listingId && l.status !== "removed");
      if (!item) fail(404, "LISTING_NOT_FOUND", "매물을 찾을 수 없어요.");
      return { summary: `'${clip(item.title, 40)}'을(를) 찜 목록에 넣을까요?`, title: clip(item.title, 40) };
    },
    run: async (d, user, args) => {
      const res = await d.toggleFavorite(user.id, args.listingId, true);
      return { message: "찜 목록에 저장했어요.", favoriteAction: { listingId: args.listingId, favorite: res.isFavorite }, userData: res.userData };
    },
  },
  remove_favorite: {
    rateKind: "message",
    args: (a) => ({ listingId: listingId(a?.listingId) }),
    precheck: async (d, user, args) => {
      const data = await d.getUserData(user.id);
      if (!(data?.favorites || []).includes(args.listingId)) fail(404, "FAVORITE_NOT_FOUND", "찜 목록에 없는 매물이에요.");
      const item = (await d.fetchListings({ viewerId: user.id })).find((l) => l.id === args.listingId);
      return { summary: `'${clip(item?.title || args.listingId, 40)}'을(를) 찜 목록에서 뺄까요?` };
    },
    run: async (d, user, args) => {
      const res = await d.toggleFavorite(user.id, args.listingId, false);
      return { message: "찜 목록에서 뺐어요.", favoriteAction: { listingId: args.listingId, favorite: res.isFavorite }, userData: res.userData };
    },
  },
  add_owned_machine: {
    rateKind: "message",
    args: (a) => {
      const modelId = typeof a?.modelId === "string" ? a.modelId.trim() : "";
      const spec = SPEC_BY_ID[modelId];
      if (!spec || spec.role !== "powerUnit") fail(400, "INVALID_MODEL", "등록할 수 있는 본체 모델이 아니에요.");
      const name = typeof a?.name === "string" && a.name.trim() ? text(a.name, { field: "기계 별명", max: 40 }) : null;
      return { modelId, ...(name ? { name } : {}) };
    },
    precheck: async (_d, _u, args) => ({ summary: `내 농기계에 '${args.name || SPEC_BY_ID[args.modelId].model}'(${SPEC_BY_ID[args.modelId].model})을(를) 추가할까요?` }),
    // requestId를 보유 농기계 ID로 써서, 같은 승인을 두 번 눌러도 한 대만 생긴다(서비스의 멱등 처리).
    run: async (d, user, args, { requestId }) => {
      const res = await d.addOwnedMachine(user.id, { id: requestId, modelId: args.modelId, ...(args.name ? { name: args.name } : {}) });
      return { message: "내 농기계에 추가했어요.", userData: res.userData };
    },
  },
  select_owned_machine: {
    rateKind: "message",
    args: (a) => ({ ownedMachineId: uuid(a?.ownedMachineId, "보유 농기계 ID") }),
    precheck: async (d, user, args) => {
      const m = await findOwned(d, user, args.ownedMachineId);
      return { summary: `'${clip(m.name, 40)}'을(를) 대표 농기계로 고를까요?` };
    },
    run: async (d, user, args) => {
      const res = await d.selectOwnedMachine(user.id, args.ownedMachineId);
      return { message: "대표 농기계를 바꿨어요.", userData: res.userData };
    },
  },
  remove_owned_machine: {
    rateKind: "message",
    args: (a) => ({ ownedMachineId: uuid(a?.ownedMachineId, "보유 농기계 ID") }),
    precheck: async (d, user, args) => {
      const m = await findOwned(d, user, args.ownedMachineId);
      return { summary: `내 농기계에서 '${clip(m.name, 40)}'을(를) 지울까요?` };
    },
    run: async (d, user, args) => {
      const res = await d.removeOwnedMachine(user.id, args.ownedMachineId);
      return { message: "내 농기계에서 지웠어요.", userData: res.userData };
    },
  },
  approve_rental_request: {
    rateKind: "rental",
    args: (a) => ({ rentalRequestId: uuid(a?.rentalRequestId, "대여 요청 ID") }),
    precheck: async (d, user, args) => {
      const r = await findRequest(d, user, args.rentalRequestId);
      if (r.side !== "received" || !r.canApprove) fail(409, "INVALID_STATE_TRANSITION", "지금 승인할 수 있는 요청이 아니에요.");
      return { summary: `${clip(r.requesterName, 20)}님의 대여 요청(${reqLabel(r)})을 승인할까요?` };
    },
    run: async (d, user, args) => {
      const res = await d.approveRentalRequest(user, args.rentalRequestId);
      return { message: "대여 요청을 승인했어요.", rentalRequest: rentalView(res.request, "incoming") };
    },
  },
  reject_rental_request: {
    rateKind: "rental",
    args: (a) => ({ rentalRequestId: uuid(a?.rentalRequestId, "대여 요청 ID") }),
    precheck: async (d, user, args) => {
      const r = await findRequest(d, user, args.rentalRequestId);
      if (r.side !== "received" || !r.canReject) fail(409, "INVALID_STATE_TRANSITION", "지금 거절할 수 있는 요청이 아니에요.");
      return { summary: `${clip(r.requesterName, 20)}님의 대여 요청(${reqLabel(r)})을 거절할까요?` };
    },
    run: async (d, user, args) => {
      const res = await d.rejectRentalRequest(user, args.rentalRequestId);
      return { message: "대여 요청을 거절했어요.", rentalRequest: rentalView(res.request, "incoming") };
    },
  },
  cancel_rental_request: {
    rateKind: "rental",
    args: (a) => ({ rentalRequestId: uuid(a?.rentalRequestId, "대여 요청 ID") }),
    precheck: async (d, user, args) => {
      const r = await findRequest(d, user, args.rentalRequestId);
      if (!r.canCancel) fail(409, "INVALID_STATE_TRANSITION", "지금 취소할 수 있는 요청이 아니에요.");
      return { summary: `대여 ${r.side === "sent" ? "요청" : "예약"}(${reqLabel(r)})을 취소할까요?` };
    },
    run: async (d, user, args) => {
      const res = await d.cancelRentalRequest(user, args.rentalRequestId);
      const side = res.request?.requesterId === user.id ? "outgoing" : "incoming";
      return { message: "대여 요청을 취소했어요.", rentalRequest: rentalView(res.request, side) };
    },
  },
  set_listing_status: {
    rateKind: "listing",
    args: (a) => {
      const status = typeof a?.status === "string" ? a.status.trim() : "";
      if (!["open", "dealing", "done"].includes(status)) fail(400, "INVALID_STATUS", "바꿀 수 있는 매물 상태가 아니에요.");
      return { listingId: listingId(a?.listingId), status };
    },
    precheck: async (d, user, args) => {
      const l = await findOwnListing(d, user, args.listingId);
      return { summary: `'${clip(l.title, 40)}' 매물 상태를 '${LISTING_STATUS_LABEL[args.status]}'(으)로 바꿀까요?` };
    },
    run: async (d, user, args) => {
      const res = await d.updateListing(user, { action: "status", id: args.listingId, status: args.status });
      return { message: `매물 상태를 '${LISTING_STATUS_LABEL[args.status]}'(으)로 바꿨어요.`, listing: { id: args.listingId, status: res.listing?.status ?? args.status } };
    },
  },
  hide_listing: {
    rateKind: "listing",
    args: (a) => ({ listingId: listingId(a?.listingId) }),
    precheck: async (d, user, args) => {
      const l = await findOwnListing(d, user, args.listingId);
      return { summary: `'${clip(l.title, 40)}' 매물을 목록에서 숨길까요? 숨긴 매물은 다시 보이게 할 수 없어요.` };
    },
    run: async (d, user, args) => {
      await d.updateListing(user, { action: "remove", id: args.listingId });
      return { message: "매물을 목록에서 숨겼어요.", listing: { id: args.listingId, status: "removed" } };
    },
  },
  delete_education_certificate: {
    rateKind: "message",
    args: () => ({}),
    precheck: async (d, user) => {
      const cert = await d.getEducationCertificateStatus(user.id);
      if (!cert?.uploaded) fail(404, "CERTIFICATE_NOT_FOUND", "올려 둔 교육이수증이 없어요.");
      return { summary: "올려 둔 교육이수증 사진을 지울까요? 지우면 되돌릴 수 없어요." };
    },
    run: async (d, user) => {
      const educationCertificate = await d.deleteEducationCertificate(user.id);
      return { message: "교육이수증 사진을 지웠어요.", educationCertificate };
    },
  },
};

export const MY_PAGE_ACTION_TYPE = "my_page_action";

function pickOperation(name) {
  const op = typeof name === "string" && Object.hasOwn(MY_PAGE_OPERATIONS, name) ? MY_PAGE_OPERATIONS[name] : null;
  if (!op) fail(400, "UNSUPPORTED_OPERATION", "마이페이지에서 농농이가 바꿀 수 없는 항목이에요.");
  return op;
}

/**
 * 쓰기 제안: 허용된 작업·필드만 골라 검증하고, 대상이 내 것인지 읽기로만 확인한 뒤 확인 카드(pendingAction)를 만든다.
 * 여기서는 아무것도 바꾸지 않는다.
 */
export async function prepareMyPageAction(user, input, { deps } = {}) {
  requireSignedIn(user);
  const d = await resolveDeps(deps);
  const operation = input?.operation;
  const op = pickOperation(operation);
  const args = op.args(input?.args && typeof input.args === "object" ? input.args : {});
  const { summary } = await op.precheck(d, user, args);
  return { type: MY_PAGE_ACTION_TYPE, operation, args, title: summary, summary, requestId: randomUUID() };
}

/**
 * 승인된 마이페이지 작업 실행. pendingAction은 브라우저에서 다시 오므로 믿지 않고 허용 목록·필드 검증을 처음부터 다시 한다.
 * 실행은 기존 서비스 함수만 쓰며, 서비스가 user.id 기준으로 소유권과 상태를 다시 검사한다.
 */
export async function executeMyPageAction(user, pending, { requestId, deps } = {}) {
  requireSignedIn(user);
  if (!pending || typeof pending !== "object" || pending.type !== MY_PAGE_ACTION_TYPE) {
    fail(400, "INVALID_ACTION", "승인할 작업 내용이 올바르지 않습니다.");
  }
  const op = pickOperation(pending.operation);
  const args = op.args(pending.args && typeof pending.args === "object" ? pending.args : {});
  const d = await resolveDeps(deps);
  const id = isUuid(requestId) ? requestId.trim().toLowerCase() : randomUUID();
  try {
    const result = await op.run(d, user, args, { requestId: id });
    return { outcome: "completed", myPageAction: { operation: pending.operation, ...args }, ...result };
  } catch (error) {
    if (error instanceof HttpError && error.status !== 401 && error.status < 500) {
      return { outcome: "failed", code: error.code, message: error.message };
    }
    throw error;
  }
}

export function myPageRateKind(pending) {
  const op = typeof pending?.operation === "string" && Object.hasOwn(MY_PAGE_OPERATIONS, pending.operation)
    ? MY_PAGE_OPERATIONS[pending.operation]
    : null;
  return op?.rateKind || "message";
}

/** 모델에게 줄 도구 정의(Anthropic tool 형식). */
export const MY_PAGE_TOOLS = [
  {
    name: "get_my_page",
    description: "로그인한 사용자의 마이페이지(닉네임, 찜 목록, 내 농기계, 보낸·받은 대여 요청, 내 매물, 거래 관리 대화, 교육이수증 업로드 여부)를 조회한다. 사용자가 자기 마이페이지·내 정보·내 예약·내 매물을 물을 때만 쓴다.",
    input_schema: {
      type: "object",
      properties: {
        sections: { type: "array", items: { type: "string", enum: SECTIONS }, description: "필요한 부분만. 비우면 전부" },
      },
    },
  },
  {
    name: "propose_my_page_action",
    description: "마이페이지 항목 변경을 제안한다. 바로 바꾸지 않고 확인 카드를 보여 주며, 사용자가 승인해야 실행된다. ID는 get_my_page 결과에 있는 것만 쓴다. 호출하면 이번 응답이 끝난다.",
    input_schema: {
      type: "object",
      properties: {
        operation: { type: "string", enum: Object.keys(MY_PAGE_OPERATIONS) },
        args: {
          type: "object",
          description: "update_nickname: {name} · add_favorite/remove_favorite: {listingId} · add_owned_machine: {modelId, name?} · select_owned_machine/remove_owned_machine: {ownedMachineId} · approve/reject/cancel_rental_request: {rentalRequestId} · set_listing_status: {listingId, status: open|dealing|done} · hide_listing: {listingId} · delete_education_certificate: {}",
          properties: {
            name: { type: "string" },
            listingId: { type: "string" },
            modelId: { type: "string" },
            ownedMachineId: { type: "string" },
            rentalRequestId: { type: "string" },
            status: { type: "string", enum: ["open", "dealing", "done"] },
          },
        },
      },
      required: ["operation"],
    },
  },
];

export const MY_PAGE_TOOL_NAMES = new Set(MY_PAGE_TOOLS.map((t) => t.name));

/** 마이페이지 관련 말인지(도구 선택용). */
export const MY_PAGE_PATTERN = /마이\s*페이지|내\s*정보|닉네임|별명|찜\s*(?:목록|한|해\s*둔|해제|빼)|내\s*(?:농기계|기계|매물|예약|대여|요청)|보낸\s*요청|받은\s*요청|(?:대여\s*)?요청\s*(?:을\s*)?(?:승인|거절|취소)|예약\s*(?:을\s*)?(?:현황|취소|목록)|승인해\s*줘|거절해\s*줘|교육\s*이수증|이수증|거래\s*관리/;
