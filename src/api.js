// 서버 API 호출. 실패하면 서버가 보낸 안내 문구를 담은 ApiError를 던진다.
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api(path, data, { timeout = 8000 } = {}) {
  let response;
  try {
    response = await fetch(path, {
      cache: "no-store",
      signal: AbortSignal.timeout(timeout),
      ...(data !== undefined && { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
    });
  } catch {
    throw new ApiError(0, "NETWORK", "서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.");
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(response.status, body?.code ?? "ERROR", body?.error ?? "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.");
  }
  return body;
}

export const listingsApi = {
  list: () => api("/api/listings").then((body) => body.listings),
};

export const requestsApi = {
  list: (role) => api(`/api/requests?role=${role}`).then((body) => body.requests),
  create: (input) => api("/api/requests", input).then((body) => body.request),
  act: (action, id) => api(`/api/requests?action=${action}`, { id }).then((body) => body.request),
};

export const chatApi = {
  list: () => api("/api/conversations").then((body) => body.conversations),
  get: (id) => api(`/api/conversations?id=${encodeURIComponent(id)}`),
  open: (listingId) => api("/api/conversations?action=open", { listingId }),
  send: (id, body) => api("/api/conversations?action=send", { id, body }),
};

export const meApi = {
  get: () => api("/api/me"),
  favorite: (listingId, on) => api("/api/me?action=favorite", { listingId, on }),
  saveMachines: (ownedMachines) => api("/api/me?action=machines", { ownedMachines }),
  merge: (data) => api("/api/me?action=merge", data),
};
