// 예약 뒤 보험 추천 흐름.
// 1) 대여·구매 예약이 끝나면 화면이 "보험을 추천해드릴까요?"를 한 번만 묻는다 (팔기·빌려주기는 묻지 않는다).
// 2) 다음 답이 긍정이면 등록된 보험 정보로 추천하고 "가까운 농협 상담을 연결해 드릴까요?"를 묻는다.
// 3) 다시 긍정이면 상담 신청을 남긴다. 가입·결제는 하지 않는다.
// 긍정·부정은 코드로 판단해서, 사용자가 동의하기 전에는 추천도 상담 신청도 하지 않는다.
import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import { INSURANCE_OFFICES, INSURANCE_PRODUCTS, MACHINERY_INSURANCE_ELIGIBILITY } from "./knowledge/insurance.js";
import { isAffirmative, reservationNumber } from "./nongnong.js";

export const INSURANCE_ASK = "보험 추천해드릴까요?";
const ASK_AGAIN = "보험을 추천해 드릴까요, 아니면 넘어갈까요?";
const CONSULT_ASK = "가까운 농협 상담을 연결해 드릴까요?";
const PREMIUM_NOTE = "보험료는 기계와 조건에 따라 달라서 농협 상담에서 확인할 수 있어요.";
const TERMS_NOTE = "정확한 조건은 가입할 때 보험사에서 확인해 주세요.";

export const LOCAL_NH_FALLBACK = {
  id: "local-nh",
  name: "가까운 지역 농·축협",
  regions: [],
  address: "",
  phone: null,
  note: "가까운 지역 농·축협 창구에서 가입과 상담을 받을 수 있어요.",
  source: { title: "NH농협손해보험 · 정책보험 가입 안내", url: "https://www.nhfire.co.kr" },
};

const STAGES = new Set(["ask", "ask_again", "offer_consult"]);
const PRODUCT_BY_ID = Object.fromEntries(INSURANCE_PRODUCTS.map((product) => [product.id, product]));
const OFFICE_BY_ID = Object.fromEntries([...INSURANCE_OFFICES, LOCAL_NH_FALLBACK].map((office) => [office.id, office]));
const shortText = (value, max) => String(value ?? "").trim().slice(0, max);

/** 화면이 돌려준 진행 상태를 검사한다. 모르는 값은 버린다. */
export function cleanInsuranceOffer(raw) {
  if (!raw || typeof raw !== "object" || !STAGES.has(raw.stage)) return null;
  const kind = raw.kind === "purchase" ? "purchase" : raw.kind === "rental" ? "rental" : raw.kind === "repair" ? "repair" : null;
  if (!kind) return null;
  return {
    stage: raw.stage,
    kind,
    listingId: shortText(raw.listingId, 80) || null,
    machineType: shortText(raw.machineType, 40) || null,
    productId: Object.hasOwn(PRODUCT_BY_ID, raw.productId) ? raw.productId : null,
    officeId: Object.hasOwn(OFFICE_BY_ID, raw.officeId) ? raw.officeId : null,
  };
}

/** @returns {"yes" | "no" | "unclear"} */
export function classifyInsuranceReply(message) {
  const text = String(message || "").replace(/\s*\[사진 첨부\]\s*$/, "").trim();
  if (!text || /[?？]\s*$/.test(text)) return "unclear";
  if (/아니|괜찮|됐어|됐습니다|필요\s*없|안\s*(?:할|해|받)|말래|넘어|싫|다음에|나중에|그만/.test(text)) return "no";
  if (isAffirmative(text) || /^(?:네|예|응)?[,\s]*(?:추천|알려|연결|부탁|신청)/.test(text)) return "yes";
  return "unclear";
}

/** 예약을 마친 뒤 보험을 물을지와 그때 쓸 진행 상태. 팔기·빌려주기에는 묻지 않는다. */
export function insuranceOfferFor(reservation, listing) {
  if (!reservation || (reservation.kind !== "rental" && reservation.kind !== "purchase")) return null;
  return { stage: "ask", kind: reservation.kind, listingId: reservation.listingId || null, machineType: listing?.machineType || null };
}

/** 수리·고장 안내 흐름에서 보험을 물을 때 쓸 진행 상태. */
export function repairInsuranceOffer({ machineType = null, listingId = null } = {}) {
  return {
    stage: "ask",
    kind: "repair",
    listingId: shortText(listingId, 80) || null,
    machineType: shortText(machineType, 40) || null,
  };
}

export function pickOffice(...regions) {
  let hasRegion = false;
  for (const raw of regions) {
    const region = typeof raw === "string" ? raw.trim() : "";
    if (!region) continue;
    hasRegion = true;
    const office = INSURANCE_OFFICES.find((item) => item.regions.includes(region) || item.regions.some((r) => region.includes(r)));
    if (office) return office;
  }
  return hasRegion ? LOCAL_NH_FALLBACK : INSURANCE_OFFICES[0];
}

function officeLine(office) {
  return [office.name, office.phone ? `☎ ${office.phone}` : "", office.address].filter(Boolean).join(" · ");
}

function productBlock(product, office) {
  return [
    `🛡️ 추천 보험: ${product.name} / ${product.insurer}`,
    `· 보장: ${product.summary}`,
    `· 지원: ${product.subsidy}`,
    `· 가입: ${officeLine(office)}`,
  ].join("\n");
}

/**
 * 추천한 보험의 상담 연락처 카드. 수리센터 카드와 같은 모양으로 화면에 전화·사이트 버튼을 보여 준다.
 * 번호와 사이트는 등록된 공식 정보만 쓰고, 없으면 버튼을 만들지 않는다.
 */
export function insuranceContactsFor(products, office) {
  const cards = products.filter(Boolean).map((product) => ({
    id: product.id,
    name: `${product.insurer} · ${product.name.replace(/\s*\(정책보험\)$/, "")}`,
    services: "보험 상담·가입 안내 (보험사 고객센터)",
    phone: product.contact?.phone || null,
    url: product.contact?.url || null,
    checkedAt: product.contact?.checkedAt || product.checkedAt,
  }));
  if (office) {
    cards.push({
      id: office.id,
      name: office.name,
      services: `가까운 가입처 · ${office.address}`,
      phone: office.phone || null,
      url: office.url || null,
      checkedAt: office.checkedAt,
    });
  }
  return cards.filter((card) => card.phone || card.url || card.id === office?.id);
}

/** 등록된 보험 정보로만 추천 글을 만든다. 보험료는 말하지 않는다. */
export function buildInsuranceRecommendation({ kind, listing, machineType, office }) {
  const machinery = PRODUCT_BY_ID["farm-machinery-comprehensive"];
  const safety = PRODUCT_BY_ID["farmer-safety"];
  const lines = [];
  let primary;
  let alternative = null;

  if (kind === "rental") {
    const listingText = `${listing?.included || ""} ${listing?.description || ""}`;
    lines.push(/보험/.test(listingText)
      ? `이 기계는 빌려주는 곳에서 보험에 가입돼 있어요. 매물 정보: "${shortText(listingText.match(/[^.\n]*보험[^.\n]*/)?.[0], 80)}"`
      : "보험 포함 여부는 빌려주는 분께 확인이 필요해요.");
    primary = safety;
  } else if (kind === "repair") {
    lines.push("수리·점검 중인 기계도 앞으로의 사고·손해에 대비해 보험 가입이나 보장을 확인해 두시면 좋아요.");
    const resolvedType = machineType || listing?.machineType;
    const eligibility = resolvedType ? MACHINERY_INSURANCE_ELIGIBILITY[resolvedType] : null;
    if (eligibility?.status === "no") {
      lines.push("이 기종은 농기계종합보험 대상이 아니에요.");
      primary = safety;
    } else {
      if (eligibility?.status === "check") lines.push(eligibility.note);
      primary = machinery;
      alternative = safety;
    }
  } else {
    const eligibility = MACHINERY_INSURANCE_ELIGIBILITY[machineType || listing?.machineType];
    if (eligibility && eligibility.status !== "no") {
      if (eligibility.status === "check") lines.push(eligibility.note);
      primary = machinery;
      alternative = safety;
    } else {
      lines.push("이 기종은 농기계종합보험 대상이 아니에요.");
      primary = safety;
    }
  }

  lines.push(productBlock(primary, office));
  if (alternative) lines.push(`다른 선택: ${alternative.name} / ${alternative.insurer} — ${alternative.summary}`);
  lines.push(`${PREMIUM_NOTE} ${TERMS_NOTE}`);
  lines.push(CONSULT_ASK);
  return {
    text: lines.join("\n\n"),
    productId: primary.id,
    contacts: insuranceContactsFor([primary, alternative], office),
    sources: [primary, alternative, office].filter(Boolean)
      .flatMap((item) => [item.source, item.contact?.source])
      .filter(Boolean),
  };
}

/** 상담 신청을 남긴다. 같은 사람·상품·매물의 접수 중인 신청이 있으면 그것을 돌려준다. */
export async function createInsuranceConsult(user, { productId, officeId, listingId = null, kind = null, region = "" }, { pool = getPool() } = {}) {
  const normalizedRegion = shortText(region, 40);
  const selectExisting = () => pool.query(
    `SELECT id FROM insurance_consult_requests
     WHERE user_id = $1 AND product_id = $2 AND listing_id IS NOT DISTINCT FROM $3 AND status = 'requested'
     LIMIT 1`,
    [user.id, productId, listingId],
  );

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const id = randomUUID();
    const inserted = await pool.query(
      `INSERT INTO insurance_consult_requests (id, user_id, product_id, office_id, listing_id, reservation_kind, region)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [id, user.id, productId, officeId, listingId, kind, normalizedRegion],
    );
    if (inserted.rows.length) {
      return { id: String(inserted.rows[0].id), idempotent: false };
    }

    const existing = await selectExisting();
    if (existing.rows.length) {
      return { id: String(existing.rows[0].id), idempotent: true };
    }
  }

  throw new Error("INSURANCE_CONSULT_CONFLICT");
}

/**
 * 보험 추천 흐름 중인 차례를 처리한다. 흐름과 관계없는 답이면 null을 돌려 일반 상담으로 넘긴다.
 * deps: { fetchListings(), createConsult(user, payload) }
 */
export async function handleInsuranceTurn(message, rawOffer, { user, region, deps }) {
  const offer = cleanInsuranceOffer(rawOffer);
  if (!offer) return null;
  const answer = classifyInsuranceReply(message);
  const done = { stage: "done", kind: offer.kind };

  if (offer.stage === "ask" || offer.stage === "ask_again") {
    if (answer === "no") return { mode: "agent", reply: "알겠어요.", listingIds: [], insuranceOffer: done };
    if (answer === "unclear") {
      if (offer.stage === "ask_again") return null;
      return { mode: "agent", reply: ASK_AGAIN, listingIds: [], choices: ["추천해 주세요", "넘어갈게요"], insuranceOffer: { ...offer, stage: "ask_again" } };
    }
    const listings = await deps.fetchListings().catch(() => []);
    const listing = listings.find((item) => item.id === offer.listingId) || null;
    const office = pickOffice(region, listing?.region);
    const recommendation = buildInsuranceRecommendation({ kind: offer.kind, listing, machineType: offer.machineType, office });
    return {
      mode: "agent",
      reply: recommendation.text,
      listingIds: [],
      choices: ["네, 연결해 주세요", "아니요"],
      sources: recommendation.sources,
      insuranceContacts: recommendation.contacts,
      insuranceOffer: { ...offer, stage: "offer_consult", productId: recommendation.productId, officeId: office.id },
    };
  }

  // offer_consult: 상담 연결을 물은 뒤
  const office = OFFICE_BY_ID[offer.officeId] || pickOffice(region);
  if (answer === "no") {
    return {
      mode: "agent",
      reply: office.phone
        ? `알겠어요. 필요하시면 ${office.name}(☎ ${office.phone})으로 연락해 보세요.`
        : `알겠어요. 필요하시면 ${office.name}에 문의해 보세요.`,
      listingIds: [],
      insuranceOffer: done,
    };
  }
  if (answer === "unclear" || !offer.productId) return null;
  if (!user) {
    return { mode: "agent", reply: "상담 신청은 로그인한 뒤에 할 수 있어요. 로그인하고 다시 '네'라고 답해 주세요.", listingIds: [], insuranceOffer: offer };
  }
  try {
    const consult = await deps.createConsult(user, { productId: offer.productId, officeId: office.id, listingId: offer.listingId, kind: offer.kind, region });
    return {
      mode: "agent",
      reply: [
        `상담 신청했어요. 신청 번호는 ${reservationNumber("I", consult.id)}예요.`,
        `${office.name} 상담으로 연결되면 연락드릴게요.${office.phone ? ` 바로 상담받으시려면 ☎ ${office.phone}으로 전화하셔도 돼요.` : ""}`,
        "가입과 보험료 납부는 농협에서 직접 해 주세요.",
      ].join("\n"),
      listingIds: [],
      insuranceConsult: { number: reservationNumber("I", consult.id), office: office.name },
      insuranceOffer: done,
    };
  } catch (error) {
    console.warn("insurance consult failed", error?.code || error?.message);
    return { mode: "agent", reply: "상담 신청을 남기지 못했어요. 잠시 후 다시 '네'라고 답해 주세요.", listingIds: [], insuranceOffer: offer };
  }
}
