const DEFAULT_NONGSARO_URL = "https://api.nongsaro.go.kr/service/weekFarmInfo/weekFarmInfoList";
const DEFAULT_TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 30 * 60 * 1000;

const cache = new Map();

export function getNongsaroConfig(env = process.env) {
  const apiKey = env.NONGSARO_API_KEY?.trim() || "";
  const baseUrl = env.NONGSARO_BASE_URL?.trim() || DEFAULT_NONGSARO_URL;
  return {
    apiKey,
    baseUrl,
    configured: Boolean(apiKey),
  };
}

export function isNongsaroConfigured(env = process.env) {
  return getNongsaroConfig(env).configured;
}

export function resetNongsaroCache() {
  cache.clear();
}

function stripCdata(value) {
  return value.replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, "$1").trim();
}

export function parseNongsaroXmlItems(xmlText) {
  if (typeof xmlText !== "string" || !xmlText.includes("<item")) return [];
  const items = [];
  const itemMatches = xmlText.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi);
  for (const match of itemMatches) {
    const block = match[1];
    const record = {};
    const tagMatches = block.matchAll(/<([a-zA-Z0-9_]+)>([\s\S]*?)<\/\1>/g);
    for (const tag of tagMatches) {
      record[tag[1]] = stripCdata(tag[2]);
    }
    items.push(record);
  }
  return items;
}

export function normalizeCropGuidance(item, index = 0) {
  const title = item?.subject || item?.cntntsSj || item?.title || "농작업 안내";
  const cropName = item?.cropName || item?.sCropNm || "";
  const workStage = item?.workStage || item?.svcDtl || "";
  const summary = item?.summary || item?.cn || item?.downUrl || "";
  const publishedAt = item?.regDt || item?.svcDt || "";
  const url = item?.fileDownUrlInfo || item?.url || "";
  const id = item?.cntntsNo || item?.id || `nongsaro-${index + 1}`;

  return {
    id: String(id),
    cropName: String(cropName).trim(),
    title: String(title).trim(),
    workStage: String(workStage).trim(),
    summary: String(summary).trim(),
    publishedAt: String(publishedAt).trim(),
    url: String(url).trim(),
    source: "nongsaro",
  };
}

export async function fetchCropGuidance({
  cropName = "",
  pageNo = 1,
  numOfRows = 10,
  env = process.env,
  fetchImpl = fetch,
  now = Date.now(),
} = {}) {
  const config = getNongsaroConfig(env);
  if (!config.configured) {
    return { configured: false, items: [], totalCount: 0 };
  }

  const safePage = Math.max(1, Number(pageNo) || 1);
  const safeRows = Math.min(30, Math.max(1, Number(numOfRows) || 10));
  const cleanCrop = typeof cropName === "string" ? cropName.trim() : "";
  const cacheKey = `${config.baseUrl}|${cleanCrop}|${safePage}|${safeRows}`;

  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const url = new URL(config.baseUrl);
  url.searchParams.set("apiKey", config.apiKey);
  url.searchParams.set("pageNo", String(safePage));
  url.searchParams.set("numOfRows", String(safeRows));
  if (cleanCrop) url.searchParams.set("sText", cleanCrop);

  try {
    const response = await fetchImpl(url.toString(), {
      method: "GET",
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    if (!response.ok) {
      return { configured: true, items: [], totalCount: 0, error: `HTTP_${response.status}` };
    }
    const text = await response.text();
    let rawItems = [];
    if (text.trim().startsWith("{")) {
      const json = JSON.parse(text);
      rawItems = Array.isArray(json?.body?.items) ? json.body.items : Array.isArray(json?.items) ? json.items : [];
    } else {
      rawItems = parseNongsaroXmlItems(text);
    }
    const items = rawItems.map((item, idx) => normalizeCropGuidance(item, idx));
    const result = { configured: true, items, totalCount: items.length };
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
