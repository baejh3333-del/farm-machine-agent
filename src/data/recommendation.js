import { CROPS, CROP_BY_ID, OPERATION_BY_ID, distanceKm } from "./farm-machines.js";

const operationPatterns = [
  ["ridge", /두둑|고랑|이랑/], ["mulch", /멀칭|비닐|피복/],
  ["till", /흙\s*갈|갈아|로터리|경운|밭\s*갈/], ["level", /논.*고르|균평/],
  ["transplant", /모종|정식/], ["seed", /씨감자|파종/], ["ricePlant", /모\s*심|모내기|이앙/],
  ["spray", /방제|농약|병해충/], ["water", /관수|물\s*주기/], ["hill", /북주기/],
  ["riceHarvest", /벼.*수확|벼.*베|콤바인/], ["potatoHarvest", /감자.*수확|감자.*캐|굴취/],
  ["transport", /운반|실어나르/],
];

export function available(item, start, end = start) {
  return item?.type === "rent" && item.status === "open" && item.condition !== "repair" &&
    (!start || (end >= start && !item.booked.some((range) => start <= range.end && range.start <= end)));
}

export function compareListings(a, b, region, sort) {
  const distance = distanceKm(region, a.region, a.id) - distanceKm(region, b.region, b.id);
  if (sort === "price" && a.price !== b.price) return a.price - b.price;
  if (sort === "inspection" && a.inspectedAt !== b.inspectedAt) return b.inspectedAt.localeCompare(a.inspectedAt);
  return distance || a.price - b.price || a.id.localeCompare(b.id);
}

export function selectMatchingListings(message, context, listings) {
  const namedCrops = CROPS.filter(({ name }) => message.includes(name)).map(({ id }) => id);
  const cropIds = namedCrops.length ? namedCrops : (Array.isArray(context.cropIds) ? context.cropIds.filter((id) => Object.hasOwn(CROP_BY_ID, id)) : []);
  const cropId = cropIds.length === 1 ? cropIds[0] : undefined;
  const namedOperations = operationPatterns.filter(([, pattern]) => pattern.test(message)).map(([id]) => id);
  const operations = namedOperations.length ? namedOperations : (Array.isArray(context.operations) ? context.operations.filter((id) => Object.hasOwn(OPERATION_BY_ID, id)) : []);
  const separately = /각각|따로|작업별/.test(message);
  const combined = !separately && operations.length > 1 && (namedOperations.length > 1 || Boolean(context.combined));
  const transaction = /구매|구입|사고 싶|살래/.test(message) ? "sale" : /대여|임대|빌리|빌릴|빌려/.test(message) ? "rent" : context.transaction === "sale" ? "sale" : "rent";
  const budgetMatch = [...message.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(만\s*원|원)/g)].at(-1);
  const maxPrice = budgetMatch ? Number(budgetMatch[1].replaceAll(",", "")) * (budgetMatch[2].startsWith("만") ? 10000 : 1) : Number(context.maxPrice) || 0;
  const areaMatch = message.match(/(\d[\d,]*(?:\.\d+)?)\s*(평|㎡|제곱미터)/);
  const areaPyeong = areaMatch ? Number(areaMatch[1].replaceAll(",", "")) / (areaMatch[2] === "평" ? 1 : 3.305785) : Number(context.areaPyeong) || 0;
  const date = typeof context.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(context.date) ? context.date : "";
  const dateEnd = date && typeof context.dateEnd === "string" && /^\d{4}-\d{2}-\d{2}$/.test(context.dateEnd) ? context.dateEnd : date;
  const { region, sort, radius, minPrice } = context;
  const candidates = listings.filter((item) =>
    item.type === transaction &&
    (transaction === "rent" ? available(item, date, dateEnd) : item.status === "open" && item.condition !== "repair") &&
    (!cropId || item.cropIds.includes(cropId)) &&
    (!Array.isArray(context.stageIds) || !context.stageIds.length || item.operations.some((id) => context.stageIds.includes(OPERATION_BY_ID[id]?.stage))) &&
    (!operations.length || (combined ? operations.every((id) => item.operations.includes(id)) : operations.some((id) => item.operations.includes(id)))) &&
    (!Array.isArray(context.brands) || !context.brands.length || context.brands.includes(item.brand)) &&
    (!Array.isArray(context.machineTypes) || !context.machineTypes.length || context.machineTypes.includes(item.machineType)) &&
    (!Array.isArray(context.conditions) || !context.conditions.length || context.conditions.includes(item.condition)) &&
    (!Number(minPrice) || item.price >= Number(minPrice)) &&
    (!maxPrice || item.price <= maxPrice) &&
    (!areaPyeong || (areaPyeong * 3.305785 >= item.areaMin && areaPyeong * 3.305785 <= item.areaMax)) &&
    (!Number(radius) || !region || distanceKm(region, item.region, item.id) <= Number(radius))
  ).sort((a, b) => compareListings(a, b, region, sort)).slice(0, 8);
  return { cropId, operationId: operations[0], operations, combined, transaction, maxPrice, areaPyeong, date, dateEnd, candidates };
}

export function recommendationGuide(selection) {
  const { cropId, operations, combined, transaction, date, dateEnd, candidates } = selection;
  const crop = CROP_BY_ID[cropId]?.name;
  const work = operations.map((id) => OPERATION_BY_ID[id].label).join(combined ? " + " : " / ");
  const listingIds = crop && work ? candidates.slice(0, 3).map(({ id }) => id) : [];
  let reply;
  if (!crop) reply = "어떤 작물의 장비를 찾으시나요? 고추·벼·배추·감자 중 하나를 알려주세요.";
  else if (!work) reply = `${crop}에 어떤 작업이 필요한가요? 흙갈이, 두둑, 멀칭, 심기, 방제처럼 작업 이름을 알려주세요.`;
  else if (transaction === "rent" && date && dateEnd < date) reply = "반납일을 시작일과 같거나 이후 날짜로 선택해 주세요.";
  else if (!listingIds.length) reply = combined
    ? `${crop} ${work}를 모두 지원하면서 나머지 조건도 충족하는 매물이 없습니다. 작업별로 보려면 ‘각각 찾아줘’라고 입력해 보세요.`
    : `${crop} ${work}에 선택한 조건을 모두 충족하는 매물이 없습니다. 기간, 거리 또는 예산을 바꿔 다시 확인해 보세요.`;
  else {
    const shown = candidates.slice(0, 3);
    const prices = shown.map(({ price }) => price);
    const format = (price) => price.toLocaleString("ko-KR") + "원";
    const low = format(Math.min(...prices));
    const high = format(Math.max(...prices));
    const priceRange = low === high ? low : `${low}~${high}`;
    reply = `${crop} ${work} 조건에 맞는 매물 ${shown.length}개를 골랐어요. 표시한 매물의 ${transaction === "rent" ? "하루 대여료" : "판매가"}는 ${priceRange}입니다.`;
    if (transaction === "rent" && !date) reply += " 대여 가능 여부는 날짜를 정하면 확인할 수 있어요.";
    reply += " 카드에서 권장 면적과 인수 방법을 비교하고, 필요한 작업기가 포함되는지 확인해 주세요.";
  }
  return { mode: "guide", reply, listingIds };
}
