const DEFAULT_RENTAL_OFFICE_URL = "https://apis.data.go.kr/B552149/farmMachineRental/rentalOfficeList";
const DEFAULT_TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 10 * 60 * 1000;

const cache = new Map();

export function getRentalOfficeConfig(env = process.env) {
  const serviceKey = env.DATA_GO_KR_SERVICE_KEY?.trim() || "";
  const baseUrl = env.DATA_GO_KR_RENTAL_OFFICE_URL?.trim() || DEFAULT_RENTAL_OFFICE_URL;
  return {
    serviceKey,
    baseUrl,
    configured: Boolean(serviceKey),
  };
}

export function isRentalOfficeApiConfigured(env = process.env) {
  return getRentalOfficeConfig(env).configured;
}

export function resetRentalOfficeCache() {
  cache.clear();
}

function pickField(item, keys, fallback = "") {
  for (const key of keys) {
    const value = item?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return fallback;
}

export function normalizeRentalOffice(item, index = 0) {
  const officeName = pickField(item, ["officeNm", "INST_NM", "bplcNm", "rentOfficeNm", "사업소명"], "농기계 임대사업소");
  const province = pickField(item, ["ctprvnNm", "CTPRVN_NM", "sidoNm", "시도명"]);
  const city = pickField(item, ["signguNm", "SIGNGU_NM", "sigunguNm", "시군구명"]);
  const region = [province, city].filter(Boolean).join(" ") || pickField(item, ["region", "지역"]);
  const address = pickField(item, ["rdnmadr", "RDNMADR", "lnmadr", "LNMADR", "adres", "소재지도로명주소", "소재지지번주소"]);
  const phone = pickField(item, ["phoneNumber", "TELNO", "telno", "연락처"]);
  const machinesRaw = pickField(item, ["holdMachn", "MACHN_NM", "machnList", "보유농기계"]);
  const machines = machinesRaw
    ? machinesRaw.split(/[,/|]/).map((s) => s.trim()).filter(Boolean)
    : [];
  const feeInfo = pickField(item, ["rentFee", "USE_FEE", "feeInfo", "임대료"]);
  const operatingHours = pickField(item, ["operTime", "OPER_TIME", "운영시간"]);
  const id = pickField(item, ["officeId", "INST_CD", "id"]) || `office-${index + 1}-${officeName}`;

  return {
    id,
    officeName,
    region,
    address,
    phone,
    machines,
    feeInfo,
    operatingHours,
    source: "data.go.kr",
  };
}

function extractItemsAndTotal(payload) {
  if (Array.isArray(payload?.data)) {
    return {
      rawItems: payload.data,
      totalCount: Number(payload.totalCount ?? payload.matchCount ?? payload.data.length) || payload.data.length,
    };
  }
  const body = payload?.response?.body ?? payload?.body ?? payload;
  const itemsNode = body?.items?.item ?? body?.items ?? [];
  const rawItems = Array.isArray(itemsNode) ? itemsNode : itemsNode ? [itemsNode] : [];
  const totalCount = Number(body?.totalCount ?? rawItems.length) || rawItems.length;
  return { rawItems, totalCount };
}

export async function fetchRentalOffices({
  region = "",
  machineType = "",
  pageNo = 1,
  numOfRows = 20,
  env = process.env,
  fetchImpl = fetch,
  now = Date.now(),
} = {}) {
  const config = getRentalOfficeConfig(env);
  if (!config.configured) {
    return { configured: false, items: [], totalCount: 0 };
  }

  const safePage = Math.max(1, Number(pageNo) || 1);
  const safeRows = Math.min(50, Math.max(1, Number(numOfRows) || 20));
  const cleanRegion = typeof region === "string" ? region.trim() : "";
  const cleanMachine = typeof machineType === "string" ? machineType.trim() : "";
  const cacheKey = `${config.baseUrl}|${cleanRegion}|${cleanMachine}|${safePage}|${safeRows}`;

  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const url = new URL(config.baseUrl);
  url.searchParams.set("serviceKey", config.serviceKey);
  url.searchParams.set("pageNo", String(safePage));
  url.searchParams.set("numOfRows", String(safeRows));
  url.searchParams.set("type", "json");
  if (cleanRegion) url.searchParams.set("region", cleanRegion);
  if (cleanMachine) url.searchParams.set("machineType", cleanMachine);

  try {
    const response = await fetchImpl(url.toString(), {
      method: "GET",
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      return { configured: true, items: [], totalCount: 0, error: `HTTP_${response.status}` };
    }
    const payload = await response.json();
    const { rawItems, totalCount } = extractItemsAndTotal(payload);
    let items = rawItems.map((item, idx) => normalizeRentalOffice(item, idx));
    if (cleanRegion) {
      items = items.filter((o) => !o.region && !o.address ? true : `${o.region} ${o.address}`.includes(cleanRegion));
    }
    if (cleanMachine) {
      items = items.filter((o) => !o.machines.length || o.machines.some((m) => m.includes(cleanMachine)));
    }
    const result = { configured: true, items, totalCount };
    cache.set(cacheKey, { value: result, expiresAt: now + CACHE_TTL_MS });
    return result;
  } catch (error) {
    return {
      configured: true,
      items: [],
      totalCount: 0,
      error: error instanceof Error ? error.name : "FETCH_ERROR",
    };
  }
}
