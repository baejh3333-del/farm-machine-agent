// 보험 안내 데이터. 사용자가 보험을 물었을 때만 쓴다. 보험료는 확정해 말하지 않는다.

const CHECKED_AT = "2026-11-16";

export const INSURANCE_PRODUCTS = [
  {
    id: "farm-machinery-comprehensive",
    name: "농기계종합보험 (정책보험)",
    audience: ["owner"],
    machineTypes: ["cultivator", "tractor", "combine", "ricePlanter", "sprayer", "carrier"],
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
