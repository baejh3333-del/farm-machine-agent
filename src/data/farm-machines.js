import { KOREA_REGIONS, getRegionCoords, latLngToKmaGrid } from './korea-regions.js';
import { FARM_LOCATIONS_BY_REGION } from './region-farm-locations.js';

export { FARM_LOCATIONS_BY_REGION };

// 검수된 작물-작업 연결을 UI와 추천 API가 함께 사용한다.
// 기계 적합성은 예시이며 실제 작업기 호환·현장 상태는 게시자 확인이 필요하다.
export const CROPS = [
  {
    "id": "rice",
    "name": "벼",
    "emoji": "",
    "category": "식량작물",
    "description": "논 준비·써레질·이앙·드론방제·콤바인 수확",
    "peakWorkMonths": [
      4,
      5,
      7,
      8,
      9,
      10
    ],
    "growingSeasons": [
      "단작(5~10월)"
    ],
    "recommendedStages": [
      "prepare",
      "plant",
      "care",
      "harvest"
    ]
  },
  {
    "id": "soybean",
    "name": "콩",
    "emoji": "",
    "category": "식량작물",
    "description": "로터리·두둑파종·북주기·콤바인 수확·탈곡선별",
    "peakWorkMonths": [
      5,
      6,
      7,
      8,
      10,
      11
    ],
    "growingSeasons": [
      "단작(5~10월)",
      "맥류후작(6~11월)"
    ],
    "recommendedStages": [
      "prepare",
      "plant",
      "care",
      "harvest"
    ]
  },
  {
    "id": "corn",
    "name": "옥수수",
    "emoji": "",
    "category": "식량작물",
    "description": "멀칭파종·북주기·방제·식용수확 및 사료곤포",
    "peakWorkMonths": [
      4,
      5,
      7,
      8,
      9
    ],
    "growingSeasons": [
      "봄파종(4~8월)",
      "사료용(4~9월)"
    ],
    "recommendedStages": [
      "prepare",
      "plant",
      "care",
      "harvest"
    ]
  },
  {
    "id": "sweetPotato",
    "name": "고구마",
    "emoji": "",
    "category": "식량작물",
    "description": "두둑·멀칭·순 정식·줄기파쇄·굴취 수확",
    "peakWorkMonths": [
      4,
      5,
      9,
      10
    ],
    "growingSeasons": [
      "보통재배(5~10월)",
      "조기재배(4~8월)"
    ],
    "recommendedStages": [
      "prepare",
      "plant",
      "care",
      "harvest"
    ]
  },
  {
    "id": "barleyWheat",
    "name": "보리·밀",
    "emoji": "",
    "category": "식량작물",
    "description": "답리작 세조파종·배수골·추비방제·콤바인 수확",
    "peakWorkMonths": [
      10,
      11,
      2,
      3,
      5,
      6
    ],
    "growingSeasons": [
      "가을파종 월동재배(10~6월)"
    ],
    "recommendedStages": [
      "prepare",
      "plant",
      "care",
      "harvest"
    ]
  },
  {
    "id": "pepper",
    "name": "고추",
    "emoji": "",
    "category": "채소",
    "description": "두둑·멀칭·정식·주기적 방제·운반",
    "peakWorkMonths": [
      4,
      5,
      6,
      7,
      8,
      9
    ],
    "growingSeasons": [
      "노지재배(4~10월)"
    ],
    "recommendedStages": [
      "prepare",
      "plant",
      "care",
      "harvest"
    ]
  },
  {
    "id": "garlic",
    "name": "마늘",
    "emoji": "",
    "category": "채소",
    "description": "심경·비닐피복·마늘파종·방제·줄기절단·굴취",
    "peakWorkMonths": [
      9,
      10,
      4,
      5,
      6
    ],
    "growingSeasons": [
      "난지형(9~5월)",
      "한지형(10~6월)"
    ],
    "recommendedStages": [
      "prepare",
      "plant",
      "care",
      "harvest"
    ]
  },
  {
    "id": "onion",
    "name": "양파",
    "emoji": "",
    "category": "채소",
    "description": "두둑·멀칭·양파정식·방제·줄기절단·굴취",
    "peakWorkMonths": [
      10,
      11,
      4,
      5,
      6
    ],
    "growingSeasons": [
      "가을정식(10~6월)"
    ],
    "recommendedStages": [
      "prepare",
      "plant",
      "care",
      "harvest"
    ]
  },
  {
    "id": "radish",
    "name": "무",
    "emoji": "",
    "category": "채소",
    "description": "심경·두둑·직파·방제·관수·굴취/운반",
    "peakWorkMonths": [
      3,
      4,
      8,
      9,
      10,
      11
    ],
    "growingSeasons": [
      "봄무(3~6월)",
      "고랭지무(6~9월)",
      "김장무(8~11월)"
    ],
    "recommendedStages": [
      "prepare",
      "plant",
      "care",
      "harvest"
    ]
  },
  {
    "id": "cabbage",
    "name": "배추",
    "emoji": "",
    "category": "채소",
    "description": "두둑·멀칭·정식·방제·관수·수확운반",
    "peakWorkMonths": [
      4,
      5,
      8,
      9,
      10,
      11
    ],
    "growingSeasons": [
      "봄배추(3~6월)",
      "고랭지배추(5~9월)",
      "김장배추(8~11월)"
    ],
    "recommendedStages": [
      "prepare",
      "plant",
      "care",
      "harvest"
    ]
  },
  {
    "id": "potato",
    "name": "감자",
    "emoji": "",
    "category": "채소",
    "description": "파종·북주기·방제·감자굴취",
    "peakWorkMonths": [
      3,
      4,
      6,
      7,
      8,
      10
    ],
    "growingSeasons": [
      "봄감자(3~6월)",
      "고랭지감자(4~9월)",
      "가을감자(8~11월)"
    ],
    "recommendedStages": [
      "prepare",
      "plant",
      "care",
      "harvest"
    ]
  },
  {
    "id": "greenOnion",
    "name": "대파",
    "emoji": "",
    "category": "채소",
    "description": "깊이갈이·정식·연백 북주기·방제·굴취",
    "peakWorkMonths": [
      4,
      5,
      7,
      8,
      10,
      11
    ],
    "growingSeasons": [
      "봄파종(3~10월)",
      "월동대파(9~4월)"
    ],
    "recommendedStages": [
      "prepare",
      "plant",
      "care",
      "harvest"
    ]
  },
  {
    "id": "ginger",
    "name": "생강",
    "emoji": "",
    "category": "채소",
    "description": "심경·종강파종·차광/관수·서리전 굴취",
    "peakWorkMonths": [
      4,
      5,
      7,
      8,
      10,
      11
    ],
    "growingSeasons": [
      "노지재배(4~11월)"
    ],
    "recommendedStages": [
      "prepare",
      "plant",
      "care",
      "harvest"
    ]
  },
  {
    "id": "apple",
    "name": "사과",
    "emoji": "",
    "category": "과수·견과",
    "description": "동계·하계 전정 및 파쇄·SS방제·과원제초·운반",
    "peakWorkMonths": [
      2,
      3,
      5,
      6,
      7,
      9,
      10,
      11
    ],
    "growingSeasons": [
      "다년생 영년작물(연중관리, 9~11월 수확)"
    ],
    "recommendedStages": [
      "prepare",
      "care",
      "orchard",
      "harvest"
    ]
  },
  {
    "id": "pear",
    "name": "배",
    "emoji": "",
    "category": "과수·견과",
    "description": "전정·잔가지 파쇄·SS방제·초생제초·수확운반",
    "peakWorkMonths": [
      2,
      3,
      4,
      6,
      8,
      9,
      10
    ],
    "growingSeasons": [
      "다년생 영년작물(연중관리, 8~10월 수확)"
    ],
    "recommendedStages": [
      "prepare",
      "care",
      "orchard",
      "harvest"
    ]
  },
  {
    "id": "peach",
    "name": "복숭아",
    "emoji": "",
    "category": "과수·견과",
    "description": "전정·잔가지 파쇄·SS방제·예초·수확운반",
    "peakWorkMonths": [
      2,
      3,
      5,
      6,
      7,
      8,
      9
    ],
    "growingSeasons": [
      "다년생 영년작물(연중관리, 6~9월 수확)"
    ],
    "recommendedStages": [
      "prepare",
      "care",
      "orchard",
      "harvest"
    ]
  },
  {
    "id": "grape",
    "name": "포도",
    "emoji": "",
    "category": "과수·견과",
    "description": "전정·파쇄·비가림/노지 방제·예초·운반",
    "peakWorkMonths": [
      2,
      3,
      5,
      6,
      8,
      9,
      10
    ],
    "growingSeasons": [
      "다년생 영년작물(연중관리, 7~10월 수확)"
    ],
    "recommendedStages": [
      "prepare",
      "care",
      "orchard",
      "harvest"
    ]
  },
  {
    "id": "strawberry",
    "name": "딸기",
    "emoji": "",
    "category": "시설·과채",
    "description": "시설 토양로터리·두둑·정식·방제·전동운반",
    "peakWorkMonths": [
      8,
      9,
      11,
      12,
      1,
      2,
      3,
      4
    ],
    "growingSeasons": [
      "촉성재배(9~5월)",
      "반촉성(1~6월)"
    ],
    "recommendedStages": [
      "prepare",
      "plant",
      "care",
      "harvest"
    ]
  },
  {
    "id": "tomato",
    "name": "토마토",
    "emoji": "",
    "category": "시설·과채",
    "description": "하우스 경운·멀칭·정식·관비·방제·운반",
    "peakWorkMonths": [
      3,
      4,
      5,
      6,
      9,
      10,
      11
    ],
    "growingSeasons": [
      "촉성·반촉성·억제 연중시설재배"
    ],
    "recommendedStages": [
      "prepare",
      "plant",
      "care",
      "harvest"
    ]
  },
  {
    "id": "sesame",
    "name": "참깨·들깨",
    "emoji": "",
    "category": "특용·약용·버섯",
    "description": "로터리·비닐피복·직파/정식·예방방제·탈곡선별",
    "peakWorkMonths": [
      5,
      6,
      7,
      8,
      9,
      10
    ],
    "growingSeasons": [
      "참깨(5~8월)",
      "들깨(6~10월)"
    ],
    "recommendedStages": [
      "prepare",
      "plant",
      "care",
      "harvest"
    ]
  },
  {
    "id": "redBean",
    "name": "팥·녹두",
    "emoji": "",
    "category": "식량작물",
    "description": "두둑성형·직파·중경배토·직립형 콤바인 수확·건조선별",
    "peakWorkMonths": [
      5,
      6,
      7,
      9,
      10
    ],
    "growingSeasons": [
      "단작(5~10월)",
      "맥류후작(6~10월)"
    ],
    "recommendedStages": [
      "prepare",
      "plant",
      "care",
      "harvest"
    ]
  },
  {
    "id": "milletSorghum",
    "name": "조·수수·기장",
    "emoji": "",
    "category": "식량작물",
    "description": "로터리·조파/점파·중경제초·콤바인 수확·탈곡선별",
    "peakWorkMonths": [
      5,
      6,
      7,
      9,
      10
    ],
    "growingSeasons": [
      "봄파종(5~9월)",
      "후작(6~10월)"
    ],
    "recommendedStages": [
      "prepare",
      "plant",
      "care",
      "harvest"
    ]
  },
  {
    "id": "buckwheat",
    "name": "메밀",
    "emoji": "",
    "category": "식량작물",
    "description": "배수로 정비·세조파 직파·드론방제·콤바인 적기수확·건조",
    "peakWorkMonths": [
      4,
      7,
      8,
      10
    ],
    "growingSeasons": [
      "봄메밀(4~7월)",
      "가을메밀(8~10월)"
    ],
    "recommendedStages": [
      "prepare",
      "plant",
      "care",
      "harvest"
    ]
  },
  {
    "id": "peanut",
    "name": "땅콩",
    "emoji": "",
    "category": "식량작물",
    "description": "사양토 심경·비닐멀칭 파종·북주기·굴취 수확·건조선별",
    "peakWorkMonths": [
      4,
      5,
      7,
      9,
      10
    ],
    "growingSeasons": [
      "노지재배(4~10월)"
    ],
    "recommendedStages": [
      "prepare",
      "plant",
      "care",
      "harvest"
    ]
  },
  {
    "id": "forageCrops",
    "name": "사료작물·청보리·IRG",
    "emoji": "",
    "category": "식량작물",
    "description": "답리작 배수로·대면적 파종·예취 및 원형곤포 사일리지",
    "peakWorkMonths": [
      10,
      11,
      4,
      5,
      6,
      9
    ],
    "growingSeasons": [
      "월동조사료(10~5월)",
      "하계사료(5~9월)"
    ],
    "recommendedStages": [
      "prepare",
      "plant",
      "care",
      "harvest"
    ]
  },
  {
    "id": "carrot",
    "name": "당근",
    "emoji": "",
    "category": "채소",
    "description": "심경 쇄토·두둑 성형·정밀 직파·관수·굴취기 수확·세척선별",
    "peakWorkMonths": [
      3,
      4,
      8,
      9,
      12,
      1,
      2
    ],
    "growingSeasons": [
      "봄당근(3~7월)",
      "제주·겨울당근(8~2월)"
    ],
    "recommendedStages": [
      "prepare",
      "plant",
      "care",
      "harvest"
    ]
  },
  {
    "id": "chives",
    "name": "쪽파",
    "emoji": "",
    "category": "채소",
    "description": "두둑·멀칭·종구 정식·방제·관수·굴취 수확",
    "peakWorkMonths": [
      3,
      4,
      8,
      9,
      10,
      11
    ],
    "growingSeasons": [
      "봄쪽파(3~6월)",
      "김장·월동쪽파(8~4월)"
    ],
    "recommendedStages": [
      "prepare",
      "plant",
      "care",
      "harvest"
    ]
  },
  {
    "id": "spinach",
    "name": "시금치",
    "emoji": "",
    "category": "채소",
    "description": "토양산도 교정·평이랑 로터리·세조파 직파·관수·예취수확",
    "peakWorkMonths": [
      3,
      4,
      9,
      10,
      11,
      12,
      1,
      2
    ],
    "growingSeasons": [
      "가을·월동시금치(9~3월)",
      "봄·고랭지(4~8월)"
    ],
    "recommendedStages": [
      "prepare",
      "plant",
      "care",
      "harvest"
    ]
  },
  {
    "id": "lettuce",
    "name": "상추·쌈채",
    "emoji": "",
    "category": "채소",
    "description": "하우스·노지 로터리·멀칭·모종 정식·점적관수·수확운반",
    "peakWorkMonths": [
      3,
      4,
      5,
      9,
      10,
      11
    ],
    "growingSeasons": [
      "봄·가을 노지(4~10월)",
      "시설 연중재배"
    ],
    "recommendedStages": [
      "prepare",
      "plant",
      "care",
      "harvest"
    ]
  },
  {
    "id": "cabbageHead",
    "name": "양배추",
    "emoji": "",
    "category": "채소",
    "description": "심경·두둑 멀칭·트랙터 정식기·드론/동력 방제·선별운반",
    "peakWorkMonths": [
      4,
      5,
      8,
      9,
      1,
      2,
      3
    ],
    "growingSeasons": [
      "봄·고랭지(4~9월)",
      "제주 월동양배추(9~3월)"
    ],
    "recommendedStages": [
      "prepare",
      "plant",
      "care",
      "harvest"
    ]
  },
  {
    "id": "broccoli",
    "name": "브로콜리",
    "emoji": "",
    "category": "채소",
    "description": "두둑 멀칭·모종 정식·해충 방제·관수·선별 출하",
    "peakWorkMonths": [
      5,
      6,
      8,
      9,
      12,
      1,
      2
    ],
    "growingSeasons": [
      "고랭지(5~9월)",
      "제주 월동(8~3월)"
    ],
    "recommendedStages": [
      "prepare",
      "plant",
      "care",
      "harvest"
    ]
  },
  {
    "id": "leek",
    "name": "부추",
    "emoji": "",
    "category": "채소",
    "description": "다년생 하우스·노지 경운·파종정식·예초·관비·다회 수확",
    "peakWorkMonths": [
      3,
      4,
      5,
      6,
      9,
      10
    ],
    "growingSeasons": [
      "시설 촉성(11~4월)",
      "노지 다년생(4~10월)"
    ],
    "recommendedStages": [
      "prepare",
      "plant",
      "care",
      "harvest"
    ]
  },
  {
    "id": "burdockLotus",
    "name": "우엉·연근",
    "emoji": "",
    "category": "채소",
    "description": "깊이 60cm 이상 심경·굴삭기/트렌처 굴착 수확·세척선별",
    "peakWorkMonths": [
      3,
      4,
      10,
      11,
      12,
      1,
      2
    ],
    "growingSeasons": [
      "우엉(3~11월)",
      "연근(4~3월)"
    ],
    "recommendedStages": [
      "prepare",
      "plant",
      "care",
      "harvest"
    ]
  },
  {
    "id": "watermelon",
    "name": "수박",
    "emoji": "",
    "category": "시설·과채",
    "description": "하우스·터널 심경·광폭 두둑·멀칭·정식·관비·선별운반",
    "peakWorkMonths": [
      2,
      3,
      4,
      5,
      6,
      7,
      8
    ],
    "growingSeasons": [
      "반촉성(2~6월)",
      "억제·노지(5~9월)"
    ],
    "recommendedStages": [
      "prepare",
      "plant",
      "care",
      "harvest"
    ]
  },
  {
    "id": "orientalMelon",
    "name": "참외",
    "emoji": "",
    "category": "시설·과채",
    "description": "하우스 로터리·두둑·비닐 멀칭·접목묘 정식·관수·선별",
    "peakWorkMonths": [
      1,
      2,
      3,
      4,
      5,
      6
    ],
    "growingSeasons": [
      "촉성·반촉성(12~7월)"
    ],
    "recommendedStages": [
      "prepare",
      "plant",
      "care",
      "harvest"
    ]
  },
  {
    "id": "melon",
    "name": "멜론",
    "emoji": "",
    "category": "시설·과채",
    "description": "시설 정지·두둑·정식·정밀 관비·방제·당도 선별 운반",
    "peakWorkMonths": [
      3,
      4,
      5,
      8,
      9,
      10
    ],
    "growingSeasons": [
      "봄작형(2~6월)",
      "가을작형(7~11월)"
    ],
    "recommendedStages": [
      "prepare",
      "plant",
      "care",
      "harvest"
    ]
  },
  {
    "id": "cucumber",
    "name": "오이",
    "emoji": "",
    "category": "시설·과채",
    "description": "시설 로터리·두둑 멀칭·정식·관비·주기적 방제·운반",
    "peakWorkMonths": [
      3,
      4,
      5,
      6,
      9,
      10
    ],
    "growingSeasons": [
      "촉성(11~5월)",
      "반촉성·억제(3~11월)"
    ],
    "recommendedStages": [
      "prepare",
      "plant",
      "care",
      "harvest"
    ]
  },
  {
    "id": "squash",
    "name": "호박·단호박",
    "emoji": "",
    "category": "시설·과채",
    "description": "노지·시설 두둑 멀칭·정식/직파·방제·예초·수확운반",
    "peakWorkMonths": [
      4,
      5,
      6,
      7,
      8,
      10
    ],
    "growingSeasons": [
      "노지 단호박(4~8월)",
      "시설 애호박(연중)"
    ],
    "recommendedStages": [
      "prepare",
      "plant",
      "care",
      "harvest"
    ]
  },
  {
    "id": "eggplant",
    "name": "가지",
    "emoji": "",
    "category": "시설·과채",
    "description": "심경·두둑 멀칭·정식·총채벌레 방제·관비·선별운반",
    "peakWorkMonths": [
      4,
      5,
      6,
      7,
      8,
      9
    ],
    "growingSeasons": [
      "노지(4~10월)",
      "시설 촉성(10~6월)"
    ],
    "recommendedStages": [
      "prepare",
      "plant",
      "care",
      "harvest"
    ]
  },
  {
    "id": "paprika",
    "name": "파프리카·피망",
    "emoji": "",
    "category": "시설·과채",
    "description": "스마트온실 양액/토경 정식·고소작업 수확·방제·색상 선별",
    "peakWorkMonths": [
      3,
      4,
      5,
      6,
      9,
      10,
      11
    ],
    "growingSeasons": [
      "여름작형(3~11월)",
      "겨울작형(8~6월)"
    ],
    "recommendedStages": [
      "prepare",
      "plant",
      "care",
      "harvest"
    ]
  },
  {
    "id": "citrus",
    "name": "감귤",
    "emoji": "",
    "category": "과수·견과",
    "description": "전정·파쇄·SS/무인방제·고소/운반차·과원예초·비파괴 선별",
    "peakWorkMonths": [
      3,
      4,
      6,
      7,
      10,
      11,
      12
    ],
    "growingSeasons": [
      "노지감귤(10~12월 수확)",
      "하우스만감류(12~4월 수확)"
    ],
    "recommendedStages": [
      "prepare",
      "care",
      "orchard",
      "harvest"
    ]
  },
  {
    "id": "persimmon",
    "name": "단감·감",
    "emoji": "",
    "category": "과수·견과",
    "description": "동계전정·잔가지 파쇄·SS방제·고소작업 적과/수확·선별운반",
    "peakWorkMonths": [
      2,
      3,
      5,
      6,
      7,
      9,
      10,
      11
    ],
    "growingSeasons": [
      "다년생 영년작물(9~11월 수확)"
    ],
    "recommendedStages": [
      "prepare",
      "care",
      "orchard",
      "harvest"
    ]
  },
  {
    "id": "plum",
    "name": "자두",
    "emoji": "",
    "category": "과수·견과",
    "description": "전정·파쇄·SS방제·초생 예초·고소 수확·선별운반",
    "peakWorkMonths": [
      2,
      3,
      5,
      6,
      7,
      8
    ],
    "growingSeasons": [
      "다년생 영년작물(6~9월 수확)"
    ],
    "recommendedStages": [
      "prepare",
      "care",
      "orchard",
      "harvest"
    ]
  },
  {
    "id": "maesil",
    "name": "매실",
    "emoji": "",
    "category": "과수·견과",
    "description": "전정·가지 파쇄·SS방제·초생 제초·일시 수확·선별운반",
    "peakWorkMonths": [
      2,
      3,
      4,
      5,
      6
    ],
    "growingSeasons": [
      "다년생 영년작물(5~6월 수확)"
    ],
    "recommendedStages": [
      "prepare",
      "care",
      "orchard",
      "harvest"
    ]
  },
  {
    "id": "blueberry",
    "name": "블루베리",
    "emoji": "",
    "category": "과수·견과",
    "description": "피트모스 토양조성·점적관수·예초·동력방제·전정파쇄·선별",
    "peakWorkMonths": [
      2,
      3,
      5,
      6,
      7
    ],
    "growingSeasons": [
      "시설(4~6월)",
      "노지(6~8월)"
    ],
    "recommendedStages": [
      "prepare",
      "care",
      "orchard",
      "harvest"
    ]
  },
  {
    "id": "kiwi",
    "name": "참다래·키위",
    "emoji": "",
    "category": "과수·견과",
    "description": "덕 시설 하부 예초·전정파쇄·SS방제·관수·수확운반·선별",
    "peakWorkMonths": [
      2,
      3,
      5,
      7,
      10,
      11
    ],
    "growingSeasons": [
      "다년생 영년작물(10~11월 수확)"
    ],
    "recommendedStages": [
      "prepare",
      "care",
      "orchard",
      "harvest"
    ]
  },
  {
    "id": "chestnut",
    "name": "밤·호두",
    "emoji": "",
    "category": "과수·견과",
    "description": "산지 임간 예초·드론/SS 병해충 방제·가지파쇄·건조·선별운반",
    "peakWorkMonths": [
      2,
      3,
      7,
      8,
      9,
      10
    ],
    "growingSeasons": [
      "다년생 임산물·과수(9~10월 수확)"
    ],
    "recommendedStages": [
      "prepare",
      "care",
      "orchard",
      "harvest"
    ]
  },
  {
    "id": "ginseng",
    "name": "인삼",
    "emoji": "",
    "category": "특용·약용·버섯",
    "description": "1~2년 예정지 심경·배수로 굴착·높은 두둑·해가림·직파/이식·굴취",
    "peakWorkMonths": [
      3,
      4,
      5,
      9,
      10,
      11
    ],
    "growingSeasons": [
      "다년생(4~6년근, 가을 9~11월 파종·수확)"
    ],
    "recommendedStages": [
      "prepare",
      "plant",
      "care",
      "harvest"
    ]
  },
  {
    "id": "deodeokDoraji",
    "name": "더덕·도라지",
    "emoji": "",
    "category": "특용·약용·버섯",
    "description": "배수 개선 심경·두둑 멀칭·세조파 직파·제초·진동 굴취·건조",
    "peakWorkMonths": [
      3,
      4,
      10,
      11
    ],
    "growingSeasons": [
      "다년생(2~3년근, 봄파종 3~4월, 가을·봄 수확)"
    ],
    "recommendedStages": [
      "prepare",
      "plant",
      "care",
      "harvest"
    ]
  },
  {
    "id": "perillaLeaf",
    "name": "잎들깨",
    "emoji": "",
    "category": "특용·약용·버섯",
    "description": "하우스 로터리·두둑·직파/정식·전조/관비·주기 방제·선별운반",
    "peakWorkMonths": [
      1,
      2,
      3,
      4,
      9,
      10,
      11,
      12
    ],
    "growingSeasons": [
      "시설 연중재배(동계 가온 포함)"
    ],
    "recommendedStages": [
      "prepare",
      "plant",
      "care",
      "harvest"
    ]
  },
  {
    "id": "mushroom",
    "name": "버섯(표고·느타리)",
    "emoji": "",
    "category": "특용·약용·버섯",
    "description": "배지 혼합·원목 파쇄·재배사 관수/가습 방제·전동운반·건조·선별",
    "peakWorkMonths": [
      3,
      4,
      5,
      9,
      10,
      11
    ],
    "growingSeasons": [
      "시설 재배사 연중(원목표고 봄·가을)"
    ],
    "recommendedStages": [
      "prepare",
      "care",
      "harvest"
    ]
  }
];

export const STAGES = [
  {
    "id": "prepare",
    "label": "밭·논 준비",
    "operations": [
      "deepTill",
      "till",
      "spreadFertilizer",
      "ridge",
      "mulch",
      "level",
      "ridgeBuild",
      "excavateDrain"
    ]
  },
  {
    "id": "plant",
    "label": "심기",
    "operations": [
      "transplant",
      "seed",
      "ricePlant",
      "directSeed",
      "garlicOnionPlant"
    ]
  },
  {
    "id": "care",
    "label": "생육 관리",
    "operations": [
      "spray",
      "orchardSpray",
      "droneSpray",
      "water",
      "hill",
      "weedMow"
    ]
  },
  {
    "id": "orchard",
    "label": "과원·전정 관리",
    "operations": [
      "pruneShred",
      "aerialWork"
    ]
  },
  {
    "id": "harvest",
    "label": "수확·후처리",
    "operations": [
      "riceHarvest",
      "potatoHarvest",
      "rootHarvest",
      "thresh",
      "forageBale",
      "dryProduce",
      "sortProduce",
      "transport"
    ]
  }
];

export const OPERATIONS = [
  {
    "id": "till",
    "label": "흙갈이·로터리",
    "stage": "prepare",
    "defaultMachineTypes": [
      "tractor",
      "rotavator",
      "cultivator",
      "tiller"
    ]
  },
  {
    "id": "deepTill",
    "label": "심경·쟁기질",
    "stage": "prepare",
    "defaultMachineTypes": [
      "tractor",
      "plow"
    ]
  },
  {
    "id": "spreadFertilizer",
    "label": "비료·퇴비 살포",
    "stage": "prepare",
    "defaultMachineTypes": [
      "spreader",
      "tractor",
      "loader"
    ]
  },
  {
    "id": "ridge",
    "label": "두둑·고랑 만들기",
    "stage": "prepare",
    "defaultMachineTypes": [
      "ridgeMulcher",
      "cultivator",
      "tractor",
      "ridger"
    ]
  },
  {
    "id": "mulch",
    "label": "멀칭·비닐 피복",
    "stage": "prepare",
    "defaultMachineTypes": [
      "ridgeMulcher",
      "cultivator"
    ]
  },
  {
    "id": "level",
    "label": "논 고르기",
    "stage": "prepare",
    "defaultMachineTypes": [
      "tractor",
      "rotavator"
    ]
  },
  {
    "id": "transplant",
    "label": "모종 심기",
    "stage": "plant",
    "defaultMachineTypes": [
      "transplanter",
      "tractor"
    ]
  },
  {
    "id": "seed",
    "label": "씨감자 파종",
    "stage": "plant",
    "defaultMachineTypes": [
      "potatoPlanter",
      "tractor"
    ]
  },
  {
    "id": "ricePlant",
    "label": "모 심기",
    "stage": "plant",
    "defaultMachineTypes": [
      "ricePlanter"
    ]
  },
  {
    "id": "directSeed",
    "label": "밭작물·맥류 직파",
    "stage": "plant",
    "defaultMachineTypes": [
      "seeder",
      "tractor",
      "ridingCultivator"
    ]
  },
  {
    "id": "garlicOnionPlant",
    "label": "마늘·양파 파종·정식",
    "stage": "plant",
    "defaultMachineTypes": [
      "garlicOnionPlanter",
      "transplanter",
      "tractor"
    ]
  },
  {
    "id": "spray",
    "label": "방제",
    "stage": "care",
    "defaultMachineTypes": [
      "sprayer",
      "tractor",
      "cultivator"
    ]
  },
  {
    "id": "orchardSpray",
    "label": "과수 SS 방제",
    "stage": "care",
    "defaultMachineTypes": [
      "speedSprayer",
      "sprayer"
    ]
  },
  {
    "id": "droneSpray",
    "label": "드론 방제",
    "stage": "care",
    "defaultMachineTypes": [
      "agriDrone"
    ]
  },
  {
    "id": "water",
    "label": "관수",
    "stage": "care",
    "defaultMachineTypes": [
      "sprayer",
      "cultivator"
    ]
  },
  {
    "id": "hill",
    "label": "북주기",
    "stage": "care",
    "defaultMachineTypes": [
      "cultivator",
      "ridingCultivator",
      "tractor",
      "ridger"
    ]
  },
  {
    "id": "weedMow",
    "label": "제초·예초",
    "stage": "care",
    "defaultMachineTypes": [
      "mower",
      "ridingCultivator",
      "cultivator"
    ]
  },
  {
    "id": "pruneShred",
    "label": "전정·잔가지 파쇄",
    "stage": "orchard",
    "defaultMachineTypes": [
      "shredder",
      "tractor"
    ]
  },
  {
    "id": "riceHarvest",
    "label": "벼 수확",
    "stage": "harvest",
    "defaultMachineTypes": [
      "combine"
    ]
  },
  {
    "id": "potatoHarvest",
    "label": "감자 굴취",
    "stage": "harvest",
    "defaultMachineTypes": [
      "potatoHarvester",
      "tractor"
    ]
  },
  {
    "id": "rootHarvest",
    "label": "땅속작물·마늘·양파 굴취/수확",
    "stage": "harvest",
    "defaultMachineTypes": [
      "rootHarvester",
      "tractor",
      "cultivator"
    ]
  },
  {
    "id": "thresh",
    "label": "탈곡·선별",
    "stage": "harvest",
    "defaultMachineTypes": [
      "thresher",
      "combine"
    ]
  },
  {
    "id": "forageBale",
    "label": "사료작물 수확·곤포",
    "stage": "harvest",
    "defaultMachineTypes": [
      "baler",
      "tractor",
      "loader"
    ]
  },
  {
    "id": "transport",
    "label": "수확물 운반",
    "stage": "harvest",
    "defaultMachineTypes": [
      "carrier",
      "tiller",
      "loader",
      "tractor"
    ]
  },
  {
    "id": "ridgeBuild",
    "label": "논두렁 조성",
    "stage": "prepare",
    "defaultMachineTypes": [
      "ridger",
      "tractor",
      "excavator"
    ]
  },
  {
    "id": "excavateDrain",
    "label": "배수로·토목 굴착",
    "stage": "prepare",
    "defaultMachineTypes": [
      "excavator",
      "tractor",
      "loader"
    ]
  },
  {
    "id": "aerialWork",
    "label": "과수 고소작업(적과·봉지·수확)",
    "stage": "orchard",
    "defaultMachineTypes": [
      "aerialLift",
      "carrier"
    ]
  },
  {
    "id": "dryProduce",
    "label": "농산물·곡물 건조",
    "stage": "harvest",
    "defaultMachineTypes": [
      "dryer"
    ]
  },
  {
    "id": "sortProduce",
    "label": "농산물 선별·정선",
    "stage": "harvest",
    "defaultMachineTypes": [
      "sorter"
    ]
  }
];

export const MACHINE_TYPES = [
  {
    "id": "tractor",
    "label": "트랙터",
    "emoji": "",
    "role": "powerUnit",
    "areaMin": 1000,
    "areaMax": 30000,
    "description": "20~140+ PS 대역의 범용 농작업 동력 본체. 후방 3점 히치(Cat I/II) 및 PTO(540/750/1000 rpm)로 다양한 작업기 구동"
  },
  {
    "id": "cultivator",
    "label": "관리기",
    "emoji": "",
    "role": "powerUnit",
    "areaMin": 300,
    "areaMax": 1500,
    "description": "밭작물 소규모·하우스 경운, 배토, 두둑성형, 비닐피복 작업의 핵심 보행형 동력 본체"
  },
  {
    "id": "ridingCultivator",
    "label": "승용관리기",
    "emoji": "",
    "role": "powerUnit",
    "areaMin": 1000,
    "areaMax": 15000,
    "description": "높은 최저지상고와 좁은 타이어 폭으로 작물 생육 중에도 고랑 주행하며 방제·배토·비료살포를 수행하는 승용 동력체"
  },
  {
    "id": "tiller",
    "label": "경운기",
    "emoji": "",
    "role": "powerUnit",
    "areaMin": 500,
    "areaMax": 5000,
    "description": "단기통 디젤 엔진 기반의 전통적인 보행·승차 겸용 동력기계. 로터리·쟁기·트레일러 연결 가능"
  },
  {
    "id": "ricePlanter",
    "label": "이앙기",
    "emoji": "",
    "role": "standalone",
    "areaMin": 1000,
    "areaMax": 20000,
    "description": "논에 벼 모를 5조·6조·8조 등으로 정밀 이앙하는 자주식 승용 농기계"
  },
  {
    "id": "combine",
    "label": "콤바인",
    "emoji": "",
    "role": "standalone",
    "areaMin": 1500,
    "areaMax": 30000,
    "description": "벼·보리·콩 등의 예취, 탈곡, 선별을 동시에 수행하는 자주식 수확기"
  },
  {
    "id": "transplanter",
    "label": "정식기",
    "emoji": "",
    "role": "standalone",
    "areaMin": 300,
    "areaMax": 5000,
    "description": "고추·배추·양파 등 육묘 트레이 모종을 일정 주간과 깊이로 정식하는 보행형·승용형 기계"
  },
  {
    "id": "speedSprayer",
    "label": "SS기 (스피드스프레이어)",
    "emoji": "",
    "role": "standalone",
    "areaMin": 2000,
    "areaMax": 30000,
    "description": "과수원에서 대형 송풍기와 고압 노즐로 병해충 약제를 고속·광역 살포하는 자주식 방제기"
  },
  {
    "id": "agriDrone",
    "label": "농업용 방제 드론",
    "emoji": "",
    "role": "standalone",
    "areaMin": 2000,
    "areaMax": 50000,
    "description": "무인 회전익 비행체로 액상 농약 및 입제 비료·종자를 고속 정밀 살포하는 항공 방제 장비"
  },
  {
    "id": "sprayer",
    "label": "방제기",
    "emoji": "",
    "role": "standalone",
    "areaMin": 300,
    "areaMax": 15000,
    "description": "소규모 밭·하우스·과수원 약제 살포용 동력분무기 및 축산·수도작 원거리 광역방제기"
  },
  {
    "id": "carrier",
    "label": "운반차",
    "emoji": "",
    "role": "standalone",
    "areaMin": 300,
    "areaMax": 10000,
    "description": "농산물·비료·자재를 과수원·밭·임도에서 운반하는 궤도형·사륜형 동력 운반차"
  },
  {
    "id": "excavator",
    "label": "농업용 소형 굴착기",
    "emoji": "",
    "role": "standalone",
    "areaMin": 500,
    "areaMax": 20000,
    "description": "배수로 정비, 과수원 식재 구덩이 굴착, 농로 보수 등에 쓰이는 1.7~3톤급 소형 굴착기"
  },
  {
    "id": "aerialLift",
    "label": "과수용 고소작업차",
    "emoji": "",
    "role": "standalone",
    "areaMin": 1000,
    "areaMax": 20000,
    "description": "사과·배 등 과수원의 전정, 적과, 봉지 씌우기, 수확 작업을 안전하게 수행하는 무한궤도형 고소작업차"
  },
  {
    "id": "mower",
    "label": "예초기 (승용 제초기)",
    "emoji": "",
    "role": "standalone",
    "areaMin": 300,
    "areaMax": 10000,
    "description": "논둑·밭둑·과수원 하부 잡초를 제거하는 배부식 예초기 및 승용/보행 자주식 제초기"
  },
  {
    "id": "shredder",
    "label": "잔가지·목재 파쇄기",
    "emoji": "",
    "role": "standalone",
    "areaMin": 500,
    "areaMax": 15000,
    "description": "과수원 전정 가지, 고춧대, 깻대 등 영농 부산물을 파쇄해 퇴비화하는 엔진·모터·궤도형 파쇄기"
  },
  {
    "id": "thresher",
    "label": "탈곡기 (콩·잡곡)",
    "emoji": "",
    "role": "standalone",
    "areaMin": 500,
    "areaMax": 10000,
    "description": "수확한 콩·들깨·잡곡 등의 꼬투리에서 알곡을 털어내고 풍구로 정선하는 수확 후 처리 기계"
  },
  {
    "id": "rotavator",
    "label": "로타베이터",
    "emoji": "",
    "role": "implement",
    "areaMin": 1000,
    "areaMax": 30000,
    "description": "트랙터 후방 3점 히치와 PTO(540/750/1000 rpm)에 연결하여 쇄토·정지·논갈이를 수행하는 핵심 경운 작업기"
  },
  {
    "id": "plow",
    "label": "쟁기",
    "emoji": "",
    "role": "implement",
    "areaMin": 1000,
    "areaMax": 30000,
    "description": "경반층 파쇄(심경) 및 토양 반전을 수행하는 트랙터 3점 히치 부착형 쟁기류"
  },
  {
    "id": "ridgeMulcher",
    "label": "휴립·멀칭기",
    "emoji": "",
    "role": "implement",
    "areaMin": 300,
    "areaMax": 15000,
    "description": "두둑 성형과 비닐 피복(일부 제초제 살포 포함)을 동시 또는 단독 수행하는 작업기"
  },
  {
    "id": "potatoPlanter",
    "label": "감자 파종기",
    "emoji": "",
    "role": "implement",
    "areaMin": 1000,
    "areaMax": 15000,
    "description": "로터리·두둑성형·씨감자 파종·비닐피복·복토를 일괄 또는 단독 수행하는 트랙터 부착 작업기"
  },
  {
    "id": "garlicOnionPlanter",
    "label": "마늘·양파 파종기",
    "emoji": "",
    "role": "implement",
    "areaMin": 1000,
    "areaMax": 20000,
    "description": "6~9조 규모로 마늘·양파를 정밀 조파·점파하고 두둑성형·비닐피복을 병행하는 트랙터 부착 작업기"
  },
  {
    "id": "seeder",
    "label": "밭작물·콩 파종기",
    "emoji": "",
    "role": "implement",
    "areaMin": 1000,
    "areaMax": 30000,
    "description": "콩·옥수수·맥류 등의 두둑성형·줄파종·점파종을 수행하는 트랙터 부착형 및 소형 동력 파종기"
  },
  {
    "id": "potatoHarvester",
    "label": "감자·고구마 굴취기",
    "emoji": "",
    "role": "implement",
    "areaMin": 500,
    "areaMax": 15000,
    "description": "땅속의 감자·고구마 등을 굴취하고 진동·이송으로 흙을 털어 지상에 노출시키는 작업기"
  },
  {
    "id": "rootHarvester",
    "label": "땅속작물·마늘·양파 수확기",
    "emoji": "",
    "role": "implement",
    "areaMin": 1000,
    "areaMax": 20000,
    "description": "마늘·양파·생강 등의 줄기 절단, 굴취 및 수집을 수행하는 트랙터·경운기 부착 작업기"
  },
  {
    "id": "ridger",
    "label": "배토기·논두렁조성기",
    "emoji": "",
    "role": "implement",
    "areaMin": 300,
    "areaMax": 20000,
    "description": "논두렁 다짐·성형(트랙터용) 및 밭작물 북주기·배수로 형성(관리기용)에 사용하는 작업기"
  },
  {
    "id": "spreader",
    "label": "비료·퇴비 살포기",
    "emoji": "",
    "role": "implement",
    "areaMin": 1000,
    "areaMax": 30000,
    "description": "화학비료·석회·유기질퇴비를 트랙터·승용관리기 동력으로 광폭 살포하는 작업기"
  },
  {
    "id": "loader",
    "label": "프론트로더·톤백리프트",
    "emoji": "",
    "role": "implement",
    "areaMin": 1000,
    "areaMax": 30000,
    "description": "트랙터 전방 서브프레임에 장착하여 토사·퇴비·베일·톤백을 인양 및 적재하는 유압 작업기"
  },
  {
    "id": "baler",
    "label": "원형 베일러·랩핑기",
    "emoji": "",
    "role": "implement",
    "areaMin": 3000,
    "areaMax": 50000,
    "description": "볏짚 및 사료작물을 원형 곤포(베일)로 결속하고 비닐 랩핑하는 트랙터 견인·PTO 작업기"
  },
  {
    "id": "dryer",
    "label": "농산물·곡물 건조기",
    "emoji": "",
    "role": "standalone",
    "areaMin": 500,
    "areaMax": 30000,
    "description": "고추·마늘 등 밭작물용 채반식 열풍·전기건조기 및 벼·보리용 순환식 곡물건조기"
  },
  {
    "id": "sorter",
    "label": "농산물 선별기",
    "emoji": "",
    "role": "standalone",
    "areaMin": 1000,
    "areaMax": 30000,
    "description": "마늘·감자·과수 등을 봉 간격 또는 중량(추다이얼/로드셀) 기준으로 등급 선별하는 수확후처리 기계"
  },
  {
    "id": "forageHarvester",
    "label": "사료작물 수확기",
    "emoji": "",
    "role": "standalone",
    "areaMin": 5000,
    "areaMax": 50000,
    "description": "옥수수·총체보리 등 조사료를 예취·세절·베일 성형까지 일괄 수행하는 자주식 대형 수확기"
  }
];

export const CROP_OPERATIONS = {
  "rice": [
    "deepTill",
    "till",
    "spreadFertilizer",
    "level",
    "ricePlant",
    "spray",
    "droneSpray",
    "riceHarvest",
    "ridgeBuild",
    "excavateDrain",
    "dryProduce",
    "transport"
  ],
  "soybean": [
    "deepTill",
    "till",
    "spreadFertilizer",
    "ridge",
    "directSeed",
    "hill",
    "spray",
    "droneSpray",
    "riceHarvest",
    "thresh",
    "excavateDrain",
    "dryProduce",
    "sortProduce",
    "transport"
  ],
  "corn": [
    "till",
    "spreadFertilizer",
    "ridge",
    "mulch",
    "directSeed",
    "hill",
    "spray",
    "forageBale",
    "transport"
  ],
  "sweetPotato": [
    "deepTill",
    "till",
    "spreadFertilizer",
    "ridge",
    "mulch",
    "transplant",
    "spray",
    "rootHarvest",
    "transport"
  ],
  "barleyWheat": [
    "till",
    "spreadFertilizer",
    "directSeed",
    "spray",
    "droneSpray",
    "riceHarvest",
    "thresh",
    "excavateDrain",
    "dryProduce",
    "transport"
  ],
  "pepper": [
    "deepTill",
    "till",
    "spreadFertilizer",
    "ridge",
    "mulch",
    "transplant",
    "spray",
    "water",
    "dryProduce",
    "sortProduce",
    "transport"
  ],
  "garlic": [
    "deepTill",
    "till",
    "spreadFertilizer",
    "ridge",
    "mulch",
    "garlicOnionPlant",
    "spray",
    "water",
    "rootHarvest",
    "dryProduce",
    "sortProduce",
    "transport"
  ],
  "onion": [
    "deepTill",
    "till",
    "spreadFertilizer",
    "ridge",
    "mulch",
    "garlicOnionPlant",
    "spray",
    "water",
    "rootHarvest",
    "dryProduce",
    "sortProduce",
    "transport"
  ],
  "radish": [
    "deepTill",
    "till",
    "spreadFertilizer",
    "ridge",
    "mulch",
    "directSeed",
    "spray",
    "water",
    "rootHarvest",
    "transport"
  ],
  "cabbage": [
    "deepTill",
    "till",
    "spreadFertilizer",
    "ridge",
    "mulch",
    "transplant",
    "spray",
    "water",
    "transport"
  ],
  "potato": [
    "deepTill",
    "till",
    "spreadFertilizer",
    "ridge",
    "mulch",
    "seed",
    "hill",
    "spray",
    "potatoHarvest",
    "sortProduce",
    "transport"
  ],
  "greenOnion": [
    "deepTill",
    "till",
    "spreadFertilizer",
    "ridge",
    "transplant",
    "hill",
    "spray",
    "water",
    "rootHarvest",
    "transport"
  ],
  "ginger": [
    "deepTill",
    "till",
    "spreadFertilizer",
    "ridge",
    "mulch",
    "directSeed",
    "spray",
    "water",
    "rootHarvest",
    "transport"
  ],
  "apple": [
    "spreadFertilizer",
    "orchardSpray",
    "water",
    "weedMow",
    "pruneShred",
    "aerialWork",
    "sortProduce",
    "transport"
  ],
  "pear": [
    "spreadFertilizer",
    "orchardSpray",
    "water",
    "weedMow",
    "pruneShred",
    "aerialWork",
    "sortProduce",
    "transport"
  ],
  "peach": [
    "spreadFertilizer",
    "orchardSpray",
    "water",
    "weedMow",
    "pruneShred",
    "aerialWork",
    "sortProduce",
    "transport"
  ],
  "grape": [
    "spreadFertilizer",
    "orchardSpray",
    "water",
    "weedMow",
    "pruneShred",
    "sortProduce",
    "transport"
  ],
  "strawberry": [
    "till",
    "spreadFertilizer",
    "ridge",
    "mulch",
    "transplant",
    "spray",
    "water",
    "transport"
  ],
  "tomato": [
    "till",
    "spreadFertilizer",
    "ridge",
    "mulch",
    "transplant",
    "spray",
    "water",
    "transport"
  ],
  "sesame": [
    "till",
    "spreadFertilizer",
    "ridge",
    "mulch",
    "directSeed",
    "transplant",
    "spray",
    "thresh",
    "dryProduce",
    "sortProduce",
    "transport"
  ],
  "redBean": [
    "deepTill",
    "till",
    "spreadFertilizer",
    "ridge",
    "directSeed",
    "hill",
    "spray",
    "riceHarvest",
    "thresh",
    "dryProduce",
    "sortProduce",
    "transport"
  ],
  "milletSorghum": [
    "till",
    "spreadFertilizer",
    "ridge",
    "directSeed",
    "hill",
    "spray",
    "droneSpray",
    "riceHarvest",
    "thresh",
    "dryProduce",
    "sortProduce",
    "transport"
  ],
  "buckwheat": [
    "till",
    "spreadFertilizer",
    "excavateDrain",
    "directSeed",
    "droneSpray",
    "riceHarvest",
    "thresh",
    "dryProduce",
    "sortProduce",
    "transport"
  ],
  "peanut": [
    "deepTill",
    "till",
    "spreadFertilizer",
    "ridge",
    "mulch",
    "directSeed",
    "hill",
    "spray",
    "rootHarvest",
    "dryProduce",
    "sortProduce",
    "transport"
  ],
  "forageCrops": [
    "till",
    "spreadFertilizer",
    "excavateDrain",
    "directSeed",
    "spray",
    "weedMow",
    "forageBale",
    "transport"
  ],
  "carrot": [
    "deepTill",
    "till",
    "spreadFertilizer",
    "ridge",
    "directSeed",
    "spray",
    "water",
    "rootHarvest",
    "sortProduce",
    "transport"
  ],
  "chives": [
    "deepTill",
    "till",
    "spreadFertilizer",
    "ridge",
    "mulch",
    "garlicOnionPlant",
    "spray",
    "water",
    "rootHarvest",
    "transport"
  ],
  "spinach": [
    "till",
    "spreadFertilizer",
    "ridge",
    "directSeed",
    "spray",
    "water",
    "rootHarvest",
    "transport"
  ],
  "lettuce": [
    "till",
    "spreadFertilizer",
    "ridge",
    "mulch",
    "transplant",
    "spray",
    "water",
    "transport"
  ],
  "cabbageHead": [
    "deepTill",
    "till",
    "spreadFertilizer",
    "ridge",
    "mulch",
    "transplant",
    "spray",
    "droneSpray",
    "water",
    "sortProduce",
    "transport"
  ],
  "broccoli": [
    "deepTill",
    "till",
    "spreadFertilizer",
    "ridge",
    "mulch",
    "transplant",
    "spray",
    "water",
    "sortProduce",
    "transport"
  ],
  "leek": [
    "deepTill",
    "till",
    "spreadFertilizer",
    "ridge",
    "directSeed",
    "transplant",
    "spray",
    "water",
    "transport"
  ],
  "burdockLotus": [
    "deepTill",
    "excavateDrain",
    "till",
    "spreadFertilizer",
    "ridge",
    "directSeed",
    "spray",
    "water",
    "rootHarvest",
    "sortProduce",
    "transport"
  ],
  "watermelon": [
    "deepTill",
    "till",
    "spreadFertilizer",
    "ridge",
    "mulch",
    "transplant",
    "spray",
    "water",
    "sortProduce",
    "transport"
  ],
  "orientalMelon": [
    "till",
    "spreadFertilizer",
    "ridge",
    "mulch",
    "transplant",
    "spray",
    "water",
    "sortProduce",
    "transport"
  ],
  "melon": [
    "till",
    "spreadFertilizer",
    "ridge",
    "mulch",
    "transplant",
    "spray",
    "water",
    "sortProduce",
    "transport"
  ],
  "cucumber": [
    "till",
    "spreadFertilizer",
    "ridge",
    "mulch",
    "transplant",
    "spray",
    "water",
    "sortProduce",
    "transport"
  ],
  "squash": [
    "till",
    "spreadFertilizer",
    "ridge",
    "mulch",
    "transplant",
    "directSeed",
    "spray",
    "water",
    "weedMow",
    "transport"
  ],
  "eggplant": [
    "deepTill",
    "till",
    "spreadFertilizer",
    "ridge",
    "mulch",
    "transplant",
    "spray",
    "water",
    "sortProduce",
    "transport"
  ],
  "paprika": [
    "till",
    "spreadFertilizer",
    "transplant",
    "spray",
    "water",
    "sortProduce",
    "transport"
  ],
  "citrus": [
    "spreadFertilizer",
    "orchardSpray",
    "water",
    "weedMow",
    "pruneShred",
    "aerialWork",
    "sortProduce",
    "transport"
  ],
  "persimmon": [
    "spreadFertilizer",
    "orchardSpray",
    "water",
    "weedMow",
    "pruneShred",
    "aerialWork",
    "dryProduce",
    "sortProduce",
    "transport"
  ],
  "plum": [
    "spreadFertilizer",
    "orchardSpray",
    "water",
    "weedMow",
    "pruneShred",
    "aerialWork",
    "sortProduce",
    "transport"
  ],
  "maesil": [
    "spreadFertilizer",
    "orchardSpray",
    "water",
    "weedMow",
    "pruneShred",
    "aerialWork",
    "sortProduce",
    "transport"
  ],
  "blueberry": [
    "spreadFertilizer",
    "spray",
    "water",
    "weedMow",
    "pruneShred",
    "sortProduce",
    "transport"
  ],
  "kiwi": [
    "spreadFertilizer",
    "orchardSpray",
    "water",
    "weedMow",
    "pruneShred",
    "sortProduce",
    "transport"
  ],
  "chestnut": [
    "spreadFertilizer",
    "orchardSpray",
    "droneSpray",
    "weedMow",
    "pruneShred",
    "aerialWork",
    "dryProduce",
    "sortProduce",
    "transport"
  ],
  "ginseng": [
    "deepTill",
    "excavateDrain",
    "till",
    "spreadFertilizer",
    "ridge",
    "directSeed",
    "transplant",
    "spray",
    "water",
    "rootHarvest",
    "dryProduce",
    "sortProduce",
    "transport"
  ],
  "deodeokDoraji": [
    "deepTill",
    "excavateDrain",
    "till",
    "spreadFertilizer",
    "ridge",
    "mulch",
    "directSeed",
    "spray",
    "weedMow",
    "rootHarvest",
    "dryProduce",
    "sortProduce",
    "transport"
  ],
  "perillaLeaf": [
    "till",
    "spreadFertilizer",
    "ridge",
    "directSeed",
    "transplant",
    "spray",
    "water",
    "sortProduce",
    "transport"
  ],
  "mushroom": [
    "spreadFertilizer",
    "spray",
    "water",
    "dryProduce",
    "sortProduce",
    "transport"
  ]
};
export const CROP_BY_ID = Object.fromEntries(CROPS.map((item) => [item.id, item]));
export const OPERATION_BY_ID = Object.fromEntries(OPERATIONS.map((item) => [item.id, item]));
export const MACHINE_BY_ID = Object.fromEntries(MACHINE_TYPES.map((item) => [item.id, item]));

export const REGION_COORDS = {
  영양읍: { name: "영양읍", lat: 36.6667, lng: 129.1124, nx: 88, ny: 108 },
  청기면: { name: "청기면", lat: 36.7064, lng: 129.0695, nx: 87, ny: 109 },
  입암면: { name: "입암면", lat: 36.5992, lng: 129.0888, nx: 88, ny: 107 },
  수비면: { name: "수비면", lat: 36.7988, lng: 129.2116, nx: 89, ny: 111 },
  석보면: { name: "석보면", lat: 36.5675, lng: 129.138, nx: 88, ny: 106 },
  일월면: { name: "일월면", lat: 36.7438, lng: 129.1135, nx: 88, ny: 109 },
  "홍천 비발디파크": { name: "홍천 비발디파크", lat: 37.6456, lng: 127.6844, nx: 72, ny: 129 },
  "서면 팔봉리": { name: "서면 팔봉리", lat: 37.6538, lng: 127.6942, nx: 72, ny: 129 },
};

for (const prov of KOREA_REGIONS) {
  for (const city of prov.cities) {
    const fullName = `${prov.name} ${city.name}`;
    if (!Object.hasOwn(REGION_COORDS, fullName)) {
      const { nx, ny } = latLngToKmaGrid(city.lat, city.lng);
      REGION_COORDS[fullName] = { name: fullName, lat: city.lat, lng: city.lng, nx, ny };
    }
    if (Array.isArray(city.subRegions)) {
      for (const sub of city.subRegions) {
        if (!Object.hasOwn(REGION_COORDS, sub.name)) {
          const { nx, ny } = latLngToKmaGrid(sub.lat, sub.lng);
          REGION_COORDS[sub.name] = { name: sub.name, lat: sub.lat, lng: sub.lng, nx, ny };
        }
      }
    }
  }
}

function stableHash(str) {
  let h = 2166136261;
  const text = String(str || "");
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function listingCoords(itemOrRegion, itemId = "") {
  if (
    itemOrRegion &&
    typeof itemOrRegion === "object" &&
    Number.isFinite(Number(itemOrRegion.lat)) &&
    Number.isFinite(Number(itemOrRegion.lng))
  ) {
    return {
      lat: Number(itemOrRegion.lat),
      lng: Number(itemOrRegion.lng),
    };
  }
  const region = typeof itemOrRegion === "string" ? itemOrRegion : itemOrRegion?.region;
  const id = typeof itemOrRegion === "string" ? itemId : itemOrRegion?.id || itemId;
  if (id === "hc-vivaldi-1") {
    const palbong = REGION_COORDS["서면 팔봉리"];
    return { lat: palbong.lat, lng: palbong.lng };
  }
  const spots = FARM_LOCATIONS_BY_REGION[region];
  if (Array.isArray(spots) && spots.length > 0) {
    const slotMatch = typeof id === "string" ? id.match(/-slot-(\d+)$/) : null;
    const spotIdx = slotMatch
      ? (Number(slotMatch[1]) - 1) % spots.length
      : stableHash(id || region) % spots.length;
    const chosen = spots[spotIdx];
    return { lat: chosen.lat, lng: chosen.lng };
  }
  const base = REGION_COORDS[region] || getRegionCoords(region) || REGION_COORDS["영양읍"];
  if (!id || region === "서면 팔봉리") {
    return { lat: base.lat, lng: base.lng };
  }
  const h1 = stableHash(`${id}:lat`);
  const h2 = stableHash(`${id}:lng`);
  const latOffset = ((h1 % 1000) / 1000 - 0.5) * 0.026;
  const lngOffset = ((h2 % 1000) / 1000 - 0.5) * 0.032;
  return {
    lat: Number((base.lat + latOffset).toFixed(6)),
    lng: Number((base.lng + lngOffset).toFixed(6)),
  };
}

export function haversineKm(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const distanceCache = new Map();

export function distanceKm(from, to, itemId) {
  const fromCoords =
    from && typeof from === "object" && Number.isFinite(Number(from.lat)) && Number.isFinite(Number(from.lng))
      ? { lat: Number(from.lat), lng: Number(from.lng) }
      : REGION_COORDS[from] || getRegionCoords(from) || REGION_COORDS["영양읍"];
  const fromKey =
    from && typeof from === "object" && Number.isFinite(Number(from.lat))
      ? `${Number(from.lat).toFixed(4)},${Number(from.lng).toFixed(4)}`
      : String(from || "영양읍");

  const toRegion = typeof to === "object" && to ? to.region : to;
  const toId = (typeof to === "object" && to ? to.id : null) || itemId || "";
  const toCoordsKey =
    typeof to === "object" && to && Number.isFinite(Number(to.lat)) && Number.isFinite(Number(to.lng))
      ? `${Number(to.lat).toFixed(6)},${Number(to.lng).toFixed(6)}`
      : `${toRegion || ""}:${toId}`;

  const key = JSON.stringify([fromKey, toCoordsKey]);
  if (!distanceCache.has(key)) {
    const toCoords = listingCoords(to, itemId);
    const raw = haversineKm(fromCoords, toCoords);
    const distance = Math.max(0.2, Math.round(raw * 10) / 10);
    distanceCache.set(key, distance);
  }
  return distanceCache.get(key);
}

