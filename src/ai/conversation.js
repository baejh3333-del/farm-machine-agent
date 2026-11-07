import { CROPS, CROP_BY_ID, CROP_OPERATIONS, OPERATION_BY_ID } from "../data/farm-machines.js";
import { selectMatchingListings } from "../data/recommendation.js";
import { readRentalDates } from "./rental-dates.js";

const buy = /구매|구입|사고 싶|살래/;
const rent = /대여|임대|빌리|빌릴|빌려/;
const noPreference = /^(아직 모름|모르겠어요|정해지지 않았어요|상관없어요|건너뛰기)$/;
const optional = ["area", "date", "budget"];
const resetRequest = /^(?:새 상담(?: 시작)?|(?:상담|검색) 조건(?:을)?\s*(?:초기화|지워|잊어)(?:\s*해\s*줘|\s*줘)?|처음부터 다시(?: 할래요?)?)[.!?\s]*$/;
const instructionRequest = /(?:프롬프트|(?:시스템|개발자|이전|기존|모든)\s*(?:지시|명령|규칙)|ignore.{0,30}(?:instructions|prompt)|system\s+prompt)/i;

export function unrelatedTurn(previous) {
  return { ...previous, reply: "농기계 추천과 매물 이용 방법을 도와드려요. 찾으시는 작업이나 궁금한 기능을 말씀해 주세요." };
}

const socialReplies = [
  [/^(ㅎㅇ|안녕(?:하세요|하십니까)?|반가워(?:요)?|하이|hello|hi)[!?.~\s]*$/i, "안녕하세요! 저는 농농이에요. 농기계가 필요하면 어떤 일을 하실 건지 편하게 말씀해 주세요."],
  [/^(?:(?:지금|너|농농이)\s*)*(?:뭐\s*(?:해(?:요)?|하니|하는 중이야|하는 애야|하는 봇이야|할 수 있(?:어|어요))|무슨 일을 해(?:요)?|누구야|넌 누구야|무엇을 할 수 있(?:어|어요))[!?.~\s]*$/, "농사일에 맞는 장비를 고르는 걸 도와드려요. 예를 들어 ‘고추밭에 비닐을 씌우려고 해’라고 하면 어떤 장비가 필요한지부터 같이 살펴볼 수 있어요."],
  [/^(고마워(?:요)?|감사(?:해요|합니다)|땡큐)[!?.~\s]*$/, "천만에요! 이어서 궁금한 게 있으면 편하게 말씀해 주세요."],
];

function answerInterruption(message, field) {
  const social = socialReplies.find(([pattern]) => pattern.test(message));
  if (social) return social[1];
  if (/대여\s*(?:신청|예약).*(?:어떻게|방법)|어떻게.*(?:빌려|대여)|(?:빌리는|예약하는)\s*방법/.test(message)) {
    return "매물 상세에서 ‘대여 신청하기’를 누르고 시작일과 반납일을 고르세요. 요청을 보낸 뒤 ‘내 대여 요청’에서 신청 내용을 확인할 수 있어요. 소유 농가의 승인 기능은 아직 준비 중이에요.";
  }
  if (/멀칭(?:이|은)?\s*(?:뭐|무엇)|비닐\s*피복(?:이|은)?\s*뭐/.test(message)) {
    return "멀칭은 흙 표면을 비닐 같은 재료로 덮는 작업이에요. 비닐을 깔 장비를 찾고 계시면 ‘멀칭 장비 찾아줘’라고 말씀해 주세요.";
  }
  if (/두둑(?:이|은)?\s*(?:뭐|무엇)/.test(message)) {
    return "두둑은 작물을 심으려고 흙을 도톰하게 올린 줄이에요. 두둑을 만드는 작업이라면 매물에서 두둑 성형 작업기가 포함됐는지 확인할 수 있어요.";
  }
  if (field && /^(?:그걸\s*)?왜\s*(?:물어(?:봐|봐요|보세요)|필요해(?:요)?)[?!.\s]*$/.test(message)) {
    return {
      crop: "같은 심기 작업이어도 작물에 따라 맞는 장비가 달라서 확인해요.",
      operation: "같은 밭에서도 흙을 가는 장비와 비닐을 씌우는 장비가 달라요.",
      transaction: "대여 매물과 구매 매물은 따로 검색하고 가격 기준도 달라요.",
      area: "작업 면적을 알면 권장 면적에 맞는 장비를 골라드릴 수 있어요. 모르시면 건너뛰어도 돼요.",
      date: "빌리려는 기간에 이미 예약된 매물을 빼기 위해서예요. 날짜가 미정이면 건너뛰어도 돼요.",
      budget: "예산을 넘는 매물을 빼고 비교하려고요. 정해진 금액이 없다면 건너뛰어도 돼요.",
    }[field];
  }
}


function nextQuestion(selection, known) {
  if (!selection.cropId) return { field: "crop", reply: "어떤 작물을 키우시나요?", choices: CROPS.map(({ name }) => name) };
  const crop = CROP_BY_ID[selection.cropId];
  if (!selection.operations.length || !selection.operations.every((id) => CROP_OPERATIONS[crop.id].includes(id))) {
    return {
      field: "operation",
      reply: `${crop.name}에 어떤 작업을 하실 건가요? 아래에서 고르거나 하려는 일을 설명해 주세요.`,
      choices: CROP_OPERATIONS[crop.id].map((id) => OPERATION_BY_ID[id].label),
    };
  }
  if (!known.transaction) return { field: "transaction", reply: "필요한 기간만 빌리실 건가요, 구매하실 건가요?", choices: ["대여", "구매"] };
  if (!known.area) return { field: "area", reply: "작업할 농지는 대략 몇 평인가요? 면적을 알면 크기가 맞는 장비로 좁힐 수 있어요.", choices: ["100평", "300평", "1000평", "건너뛰기", "바로 추천"] };
  if (selection.transaction === "rent" && !known.date) return { field: "date", reply: "언제 빌리실 건가요? 날짜를 4자리 숫자로 입력해 주세요. 예: 1107 또는 1107~1110. 하루만 필요하면 날짜 하나만 입력해도 돼요.", choices: ["건너뛰기", "바로 추천"] };
  if (!known.budget) return { field: "budget", reply: selection.transaction === "rent" ? "하루 대여료는 얼마까지 생각하세요?" : "구매 예산은 얼마까지 생각하세요?", choices: selection.transaction === "rent" ? ["5만원 이하", "10만원 이하", "바로 추천"] : ["100만원 이하", "300만원 이하", "바로 추천"] };
  return null;
}

export function conversationTurn(message, filters, previous) {
  message = message.trim();
  if (resetRequest.test(message)) return { reset: true, reply: "상담 조건을 초기화했어요. 어떤 작업에 쓸 장비를 찾으시나요?" };
  if (instructionRequest.test(message)) return unrelatedTurn(previous);
  const reply = answerInterruption(message, previous?.field);
  if (reply) return { ...previous, reply, question: previous?.question };
  const context = { ...filters, ...previous?.context };
  const known = { transaction: false, area: Boolean(filters.areaPyeong), date: Boolean(filters.date), budget: Boolean(filters.maxPrice), ...previous?.known };
  const field = previous?.field;
  const namedCrops = CROPS.filter(({ name }) => message.includes(name));
  if (namedCrops.length && context.cropIds?.length && !context.cropIds.includes(namedCrops[0].id)) {
    context.operations = [];
    context.combined = false;
    context.stageIds = [];
  }
  const transaction = buy.test(message) && !rent.test(message) ? "sale" : rent.test(message) && !buy.test(message) ? "rent" : "";
  if (transaction) {
    if (context.transaction && transaction !== context.transaction) {
      context.minPrice = "";
      context.maxPrice = "";
      known.budget = false;
    }
    context.transaction = transaction;
    known.transaction = true;
  } else if (buy.test(message) && rent.test(message)) {
    known.transaction = false;
  }

  const dates = readRentalDates(message);
  if (dates.length) {
    if (dates.some((date) => !date) || (dates[1] && dates[1] < dates[0])) {
      return {
        context, known, field: "date",
        question: { reply: "날짜를 다시 확인해 주세요. 시작일부터 반납일까지 입력해 주세요. 예: 1120~1122 (또는 1230~0103)", choices: ["건너뛰기"] },
      };
    }
    [context.date, context.dateEnd = dates[0]] = dates;
    known.date = true;
  }

  if (field === "area" && /^\d[\d,]*$/.test(message)) message += "평";
  if (field === "budget" && /^\d[\d,]*(?:\.\d+)?(?:\s*만)?$/.test(message)) {
    // Every positive unitless rental amount is expressed in 10,000 KRW units.
    // Explicit "만" amounts work for both rental and purchase budgets.
    if (/만$/.test(message)) message += "원";
    else if (context.transaction === "rent") message += "만원";
    else message += "원";
  }
  if (noPreference.test(message) && optional.includes(field)) known[field] = true;
  if (/^(바로 추천|그냥 추천)(해줘)?$/.test(message)) {
    for (const key of optional) known[key] = true;
  }

  // Resolve short work names using the crop already named in this conversation.
  const cropId = namedCrops[0]?.id || context.cropIds?.[0];
  if (cropId === "rice" && /^(수확|심기|모\s*심기)$/.test(message)) message = /수확/.test(message) ? "벼 수확" : "벼 모내기";
  if (cropId === "potato" && message === "수확") message = "감자 굴취";
  if (cropId && ["pepper", "cabbage"].includes(cropId) && message === "심기") message = "모종 심기";
  if (cropId === "potato" && message === "심기") message = "씨감자 파종";

  const selection = selectMatchingListings(message, context, []);
  if (selection.areaPyeong) known.area = true;
  if (selection.maxPrice) known.budget = true;
  const question = nextQuestion(selection, known);
  if (question && question.field === field && previous.question?.reply !== undefined) {
    const prompts = {
      crop: "작물 이름을 확인하지 못했어요. 아래에서 하나를 골라 주세요.",
      operation: "어떤 작업인지 아직 모르겠어요. 아래에서 고르거나 ‘흙을 갈고 싶어’처럼 말씀해 주세요.",
      transaction: "빌리려는 건지 사려는 건지 한 가지를 골라 주세요.",
      area: "면적은 ‘300평’처럼 알려주세요. 아직 모르시면 건너뛰어도 돼요.",
      date: "날짜는 ‘1120~1122’처럼 붙여 적어 주셔도 돼요. 연도가 바뀌면 자동으로 계산해 드려요. 또는 건너뛸 수 있어요.",
      budget: "하루 대여료는 ‘3’, ‘7’, ‘15’처럼 어떤 숫자든 만원 단위로 적어도 돼요. 예산이 미정이면 ‘바로 추천’을 눌러 주세요.",
    };
    question.reply = prompts[field];
  }
  return {
    message,
    context: {
      ...context,
      cropIds: selection.cropId ? [selection.cropId] : [],
      operations: selection.operations,
      combined: selection.combined,
      transaction: transaction || selection.transaction,
      maxPrice: selection.maxPrice,
      areaPyeong: selection.areaPyeong,
    },
    known,
    field: question?.field,
    question,
  };
}
