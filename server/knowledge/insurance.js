// 보험 안내 데이터. 사용자가 물었을 때, 또는 예약 뒤 "보험을 추천해드릴까요?"에 긍정했을 때만 쓴다.
// 보험료는 확정해 말하지 않는다.

const CHECKED_AT = "2026-11-16";

export const INSURANCE_PRODUCTS = [
  {
    id: "farm-machinery-comprehensive",
    name: "농기계종합보험 (정책보험)",
    insurer: "NH농협손해보험",
    audience: ["owner"],
    machineTypes: [
      "cultivator", "tractor", "combine", "ricePlanter", "sprayer", "carrier",
      "tiller", "speedSprayer", "agriDrone", "loader", "baler", "ridingCultivator",
      "excavator", "aerialLift",
    ],
    summary: "농기계를 운전하거나 농작업을 하다 생긴 사고를 보상해요. 대인배상, 대물배상, 자기신체사고, 농기계 손해를 보장해요.",
    coveredTypesNote: "가입 대상은 경운기, 트랙터, 콤바인, 관리기, 이앙기, SS분무기, 항공방제기, 농업용 동력운반차, 농업용 로우더, 광역방제기, 농업용 굴착기, 베일러 12종에 고소작업차·리프트가 추가됐어요. 작업기만 따로는 대상이 아닐 수 있어요.",
    subsidy: "보험료의 50%를 나라에서 지원해요(영세농업인은 일부 70%). 시·군에 따라 추가 지원이 있을 수 있어요.",
    whereToJoin: [{ name: "가까운 지역 농협(농·축협)", phone: null, url: null }],
    checklist: [
      "내 기계가 가입 대상 기종인지 농협에서 확인하세요.",
      "빌려줄 기계라면 빌려 간 사람이 운전하다 난 사고도 보상되는지 약관을 꼭 확인하세요.",
      "농업경영체 등록이 되어 있어야 지원을 받을 수 있어요.",
    ],
    source: { title: "농림축산식품부 보도자료 · 농기계종합보험 가입 대상 확대 (2024.8.26)", url: "https://www.mafra.go.kr/bbs/home/792/580249/download.do" },
    checkedAt: CHECKED_AT,
  },
  {
    id: "farmer-safety",
    name: "농업인안전보험 (정책보험)",
    insurer: "NH농협생명",
    audience: ["renter", "owner"],
    machineTypes: "all",
    summary: "농작업을 하다 다치거나 관련 질병이 생겼을 때 본인을 보상해요. 기계를 빌려 쓰는 분에게도 해당돼요.",
    subsidy: "주계약 보험료의 50%를 나라에서 지원해요(영세농업인 70%).",
    whereToJoin: [{ name: "가까운 지역 농협(농·축협)", phone: null, url: null }],
    checklist: [
      "빌린 기계로 일하다 내가 다치는 경우를 대비하는 보험이에요.",
      "가입 나이와 상품 종류(일반형·산재형 등)는 농협에서 확인하세요.",
      "빌리기 전에 기계 주인이 농기계종합보험에 들어 있는지도 물어보세요.",
    ],
    source: { title: "농업인안전재해보험 지원 지침 (농업인안전보험 및 농기계종합보험)", url: "https://uni.agrix.go.kr/guide/lmxsrv/law/lawFullContent.do?SEQ=9149&SEQ_HISTORY=5992" },
    checkedAt: CHECKED_AT,
  },
];

// 농기계종합보험 가입 대상인지 (농식품부 2024.8.26 보도자료 기준 12종 + 고소작업차·리프트).
// eligible: 대상, check: 세부 종류에 따라 다름, no: 대상 목록에 없음
export const MACHINERY_INSURANCE_ELIGIBILITY = {
  cultivator: { status: "eligible", note: "관리기는 가입 대상이에요." },
  tractor: { status: "eligible", note: "트랙터는 가입 대상이에요." },
  ricePlanter: { status: "eligible", note: "이앙기는 가입 대상이에요." },
  combine: { status: "eligible", note: "콤바인은 가입 대상이에요." },
  carrier: { status: "eligible", note: "농업용 동력운반차는 가입 대상이에요." },
  tiller: { status: "eligible", note: "경운기는 가입 대상이에요." },
  speedSprayer: { status: "eligible", note: "SS기(스피드스프레이어)는 가입 대상이에요." },
  agriDrone: { status: "eligible", note: "항공방제기(농업용 방제 드론)는 가입 대상이에요." },
  loader: { status: "eligible", note: "농업용 로우더는 가입 대상이에요." },
  baler: { status: "eligible", note: "베일러는 가입 대상이에요." },
  sprayer: { status: "check", note: "SS분무기·광역방제기·항공방제기는 대상이에요. 다른 방제기는 농협에서 확인해 주세요." },
  ridingCultivator: { status: "check", note: "관리기(자주식) 범주에 해당할 수 있어요. 승용관리기 모델별 가입 가능 여부는 농협에서 확인해 주세요." },
  ridgeMulcher: { status: "no", note: "휴립·멀칭 작업기는 대상 목록에 없어요." },
  transplanter: { status: "no", note: "정식기는 대상 목록에 없어요." },
  potatoPlanter: { status: "no", note: "감자 파종기는 대상 목록에 없어요." },
  potatoHarvester: { status: "no", note: "감자 굴취기는 대상 목록에 없어요." },
  rotavator: { status: "no", note: "로타베이터(부착 작업기)는 단독 가입 대상 목록에 없어요." },
  plow: { status: "no", note: "쟁기(부착 작업기)는 단독 가입 대상 목록에 없어요." },
  spreader: { status: "no", note: "비료·퇴비 살포기는 대상 목록에 없어요." },
  mower: { status: "no", note: "예초기·승용 제초기는 대상 목록에 없어요." },
  shredder: { status: "no", note: "잔가지·목재 파쇄기는 대상 목록에 없어요." },
  thresher: { status: "no", note: "탈곡기는 대상 목록에 없어요." },
  garlicOnionPlanter: { status: "no", note: "마늘·양파 파종기는 대상 목록에 없어요." },
  rootHarvester: { status: "no", note: "땅속작물 수확기는 대상 목록에 없어요." },
  excavator: { status: "eligible", note: "농업용 굴착기는 가입 대상이에요." },
  aerialLift: { status: "eligible", note: "고소작업차·리프트는 가입 대상이에요." },
  seeder: { status: "no", note: "밭작물·콩 파종기(부착 작업기)는 대상 목록에 없어요." },
  ridger: { status: "no", note: "배토기·논두렁조성기(부착 작업기)는 대상 목록에 없어요." },
  dryer: { status: "no", note: "농산물·곡물 건조기는 대상 목록에 없어요." },
  sorter: { status: "no", note: "농산물 선별기는 대상 목록에 없어요." },
  forageHarvester: { status: "check", note: "자주식 사료작물 수확기(예초·수확 겸용)는 모델에 따라 달라요. 농협에서 확인해 주세요." },
};

// 영양군 보험 가입처(지역 농협). 전화번호는 공식 자료로 확인한 뒤에만 채운다(null이면 안내하지 않는다).
export const INSURANCE_OFFICES = [
  {
    id: "yeongyang-nh",
    name: "영양농협",
    regions: ["영양읍", "청기면", "일월면", "수비면"],
    address: "경북 영양군 영양읍",
    phone: null,
    note: "읍·면 지점은 영양농협에 확인해 주세요.",
    source: { title: "쿠키뉴스 · 영양군·영양농협·남영양농협 업무협약 (2026.2.10)", url: "https://www.kukinews.com/article/view/kuk202602100210" },
    checkedAt: "2026-11-17",
  },
  {
    id: "nam-yeongyang-nh",
    name: "남영양농협",
    regions: ["입암면", "석보면"],
    address: "입암지소: 경북 영양군 입암로 129-3 · 석보지소: 경북 영양군 석보면 원리길 19",
    phone: null,
    note: "",
    source: { title: "경북매일 · 남영양농협 신규조합원 교육 (2026.5.28)", url: "https://www.kbmaeil.com/article/20260528500441" },
    checkedAt: "2026-11-17",
  },
];
