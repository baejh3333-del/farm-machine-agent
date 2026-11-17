// 전국 17개 시·도 및 시·군·구 행정구역 좌표 + 기상청 단기예보 격자(LCC) 변환 유틸리티

const KMA_RE = 6371.00877; // 지구 반경 (km)
const KMA_GRID = 5.0; // 격자 간격 (km)
const KMA_SLAT1 = 30.0; // 투영 위도1 (degree)
const KMA_SLAT2 = 60.0; // 투영 위도2 (degree)
const KMA_OLON = 126.0; // 기준점 경도 (degree)
const KMA_OLAT = 38.0; // 기준점 위도 (degree)
const KMA_XO = 43; // 기준점 X좌표 (GRID)
const KMA_YO = 136; // 기준점 Y좌표 (GRID)

const DEGRAD = Math.PI / 180.0;
const _re = KMA_RE / KMA_GRID;
const _slat1 = KMA_SLAT1 * DEGRAD;
const _slat2 = KMA_SLAT2 * DEGRAD;
const _olon = KMA_OLON * DEGRAD;
const _olat = KMA_OLAT * DEGRAD;

const _sn =
  Math.log(Math.cos(_slat1) / Math.cos(_slat2)) /
  Math.log(Math.tan(Math.PI * 0.25 + _slat2 * 0.5) / Math.tan(Math.PI * 0.25 + _slat1 * 0.5));
const _sf = (Math.pow(Math.tan(Math.PI * 0.25 + _slat1 * 0.5), _sn) * Math.cos(_slat1)) / _sn;
const _ro = _re * _sf / Math.pow(Math.tan(Math.PI * 0.25 + _olat * 0.5), _sn);

/**
 * 위·경도(WGS84)를 기상청 단기예보 격자 좌표(nx, ny)로 변환합니다. (Lambert Conformal Conic)
 */
export function latLngToKmaGrid(lat, lng) {
  const numLat = Number(lat);
  const numLng = Number(lng);
  if (!Number.isFinite(numLat) || !Number.isFinite(numLng)) {
    return { nx: 88, ny: 108 };
  }
  const ra = _re * _sf / Math.pow(Math.tan(Math.PI * 0.25 + numLat * DEGRAD * 0.5), _sn);
  let theta = numLng * DEGRAD - _olon;
  if (theta > Math.PI) theta -= 2.0 * Math.PI;
  if (theta < -Math.PI) theta += 2.0 * Math.PI;
  theta *= _sn;

  const nx = Math.floor(ra * Math.sin(theta) + KMA_XO + 0.5);
  const ny = Math.floor(_ro - ra * Math.cos(theta) + KMA_YO + 0.5);
  return { nx, ny };
}

export const KOREA_REGIONS = [
  {
    name: "서울특별시",
    shortName: "서울",
    lat: 37.5665,
    lng: 126.978,
    cities: [
      { name: "강남구", lat: 37.5172, lng: 127.0473 },
      { name: "강동구", lat: 37.5301, lng: 127.1238 },
      { name: "강북구", lat: 37.6396, lng: 127.0257 },
      { name: "강서구", lat: 37.551, lng: 126.8495 },
      { name: "관악구", lat: 37.4784, lng: 126.9516 },
      { name: "광진구", lat: 37.5385, lng: 127.0823 },
      { name: "구로구", lat: 37.4954, lng: 126.8874 },
      { name: "금천구", lat: 37.4569, lng: 126.8955 },
      { name: "노원구", lat: 37.6542, lng: 127.0568 },
      { name: "도봉구", lat: 37.6688, lng: 127.0471 },
      { name: "동대문구", lat: 37.5744, lng: 127.0396 },
      { name: "동작구", lat: 37.5124, lng: 126.9393 },
      { name: "마포구", lat: 37.5663, lng: 126.9019 },
      { name: "서대문구", lat: 37.5791, lng: 126.9368 },
      { name: "서초구", lat: 37.4837, lng: 127.0324 },
      { name: "성동구", lat: 37.5633, lng: 127.0371 },
      { name: "성북구", lat: 37.5891, lng: 127.0182 },
      { name: "송파구", lat: 37.5145, lng: 127.1066 },
      { name: "양천구", lat: 37.5169, lng: 126.8664 },
      { name: "영등포구", lat: 37.5264, lng: 126.8962 },
      { name: "용산구", lat: 37.5326, lng: 126.9905 },
      { name: "은평구", lat: 37.6027, lng: 126.9291 },
      { name: "종로구", lat: 37.573, lng: 126.9794 },
      { name: "중구", lat: 37.5641, lng: 126.9979 },
      { name: "중랑구", lat: 37.6063, lng: 127.0927 },
    ],
  },
  {
    name: "부산광역시",
    shortName: "부산",
    lat: 35.1796,
    lng: 129.0756,
    cities: [
      { name: "강서구", lat: 35.2122, lng: 128.9806 },
      { name: "금정구", lat: 35.2428, lng: 129.0926 },
      { name: "기장군", lat: 35.2446, lng: 129.2223 },
      { name: "남구", lat: 35.1366, lng: 129.0844 },
      { name: "동구", lat: 35.1293, lng: 129.0455 },
      { name: "동래구", lat: 35.2048, lng: 129.0837 },
      { name: "부산진구", lat: 35.1631, lng: 129.0532 },
      { name: "북구", lat: 35.1972, lng: 128.9903 },
      { name: "사상구", lat: 35.1526, lng: 128.9912 },
      { name: "사하구", lat: 35.1045, lng: 128.9748 },
      { name: "서구", lat: 35.0979, lng: 129.0242 },
      { name: "수영구", lat: 35.1456, lng: 129.1131 },
      { name: "연제구", lat: 35.1762, lng: 129.0798 },
      { name: "영도구", lat: 35.0912, lng: 129.0679 },
      { name: "중구", lat: 35.1062, lng: 129.0324 },
      { name: "해운대구", lat: 35.1631, lng: 129.1636 },
    ],
  },
  {
    name: "대구광역시",
    shortName: "대구",
    lat: 35.8714,
    lng: 128.6014,
    cities: [
      { name: "군위군", lat: 36.2428, lng: 128.5728 },
      { name: "남구", lat: 35.846, lng: 128.5977 },
      { name: "달서구", lat: 35.8299, lng: 128.5326 },
      { name: "달성군", lat: 35.7747, lng: 128.4313 },
      { name: "동구", lat: 35.8865, lng: 128.6355 },
      { name: "북구", lat: 35.8857, lng: 128.5829 },
      { name: "서구", lat: 35.8719, lng: 128.5592 },
      { name: "수성구", lat: 35.8582, lng: 128.6306 },
      { name: "중구", lat: 35.8694, lng: 128.6062 },
    ],
  },
  {
    name: "인천광역시",
    shortName: "인천",
    lat: 37.4563,
    lng: 126.7052,
    cities: [
      { name: "강화군", lat: 37.7465, lng: 126.488 },
      { name: "계양구", lat: 37.5374, lng: 126.7378 },
      { name: "남동구", lat: 37.4472, lng: 126.7315 },
      { name: "동구", lat: 37.4738, lng: 126.6432 },
      { name: "미추홀구", lat: 37.4636, lng: 126.6503 },
      { name: "부평구", lat: 37.5074, lng: 126.7219 },
      { name: "서구", lat: 37.5454, lng: 126.676 },
      { name: "연수구", lat: 37.4102, lng: 126.6783 },
      { name: "옹진군", lat: 37.4463, lng: 126.6368 },
      { name: "중구", lat: 37.4737, lng: 126.6216 },
    ],
  },
  {
    name: "광주광역시",
    shortName: "광주",
    lat: 35.1595,
    lng: 126.8526,
    cities: [
      { name: "광산구", lat: 35.1396, lng: 126.7936 },
      { name: "남구", lat: 35.133, lng: 126.9025 },
      { name: "동구", lat: 35.1461, lng: 126.9231 },
      { name: "북구", lat: 35.1742, lng: 126.912 },
      { name: "서구", lat: 35.152, lng: 126.8895 },
    ],
  },
  {
    name: "대전광역시",
    shortName: "대전",
    lat: 36.3504,
    lng: 127.3845,
    cities: [
      { name: "대덕구", lat: 36.3466, lng: 127.4158 },
      { name: "동구", lat: 36.312, lng: 127.4549 },
      { name: "서구", lat: 36.3554, lng: 127.3838 },
      { name: "유성구", lat: 36.3622, lng: 127.3563 },
      { name: "중구", lat: 36.3258, lng: 127.4214 },
    ],
  },
  {
    name: "울산광역시",
    shortName: "울산",
    lat: 35.5384,
    lng: 129.3114,
    cities: [
      { name: "남구", lat: 35.5438, lng: 129.33 },
      { name: "동구", lat: 35.5047, lng: 129.4164 },
      { name: "북구", lat: 35.5826, lng: 129.3612 },
      { name: "울주군", lat: 35.5223, lng: 129.2423 },
      { name: "중구", lat: 35.5694, lng: 129.3328 },
    ],
  },
  {
    name: "세종특별자치시",
    shortName: "세종",
    lat: 36.4801,
    lng: 127.289,
    cities: [
      {
        name: "세종시",
        lat: 36.4801,
        lng: 127.289,
        subRegions: [
          { name: "조치원읍", lat: 36.6012, lng: 127.2987 },
          { name: "연기면", lat: 36.5335, lng: 127.2695 },
          { name: "연동면", lat: 36.5592, lng: 127.3264 },
          { name: "부강면", lat: 36.5313, lng: 127.3672 },
          { name: "금남면", lat: 36.4628, lng: 127.2815 },
          { name: "장군면", lat: 36.4978, lng: 127.2116 },
          { name: "연서면", lat: 36.5784, lng: 127.2591 },
          { name: "전의면", lat: 36.6788, lng: 127.2036 },
          { name: "전동면", lat: 36.6525, lng: 127.2584 },
          { name: "소정면", lat: 36.7124, lng: 127.1558 },
        ],
      },
    ],
  },
  {
    name: "경기도",
    shortName: "경기",
    lat: 37.2752,
    lng: 127.0095,
    cities: [
      { name: "가평군", lat: 37.8315, lng: 127.5095 },
      { name: "고양시", lat: 37.6584, lng: 126.832 },
      { name: "과천시", lat: 37.4292, lng: 126.9877 },
      { name: "광명시", lat: 37.4786, lng: 126.8644 },
      { name: "광주시", lat: 37.4294, lng: 127.2551 },
      { name: "구리시", lat: 37.5943, lng: 127.1296 },
      { name: "군포시", lat: 37.3617, lng: 126.9352 },
      { name: "김포시", lat: 37.6153, lng: 126.7156 },
      { name: "남양주시", lat: 37.636, lng: 127.2165 },
      { name: "동두천시", lat: 37.9035, lng: 127.0605 },
      { name: "부천시", lat: 37.5034, lng: 126.766 },
      { name: "성남시", lat: 37.4201, lng: 127.1265 },
      { name: "수원시", lat: 37.2636, lng: 127.0286 },
      { name: "시흥시", lat: 37.38, lng: 126.803 },
      { name: "안산시", lat: 37.3219, lng: 126.8309 },
      { name: "안성시", lat: 37.008, lng: 127.2797 },
      { name: "안양시", lat: 37.3943, lng: 126.9568 },
      { name: "양주시", lat: 37.7853, lng: 127.0457 },
      { name: "양평군", lat: 37.4917, lng: 127.4876 },
      { name: "여주시", lat: 37.2983, lng: 127.6373 },
      { name: "연천군", lat: 38.0965, lng: 127.0748 },
      { name: "오산시", lat: 37.1498, lng: 127.0772 },
      { name: "용인시", lat: 37.2411, lng: 127.1776 },
      { name: "의왕시", lat: 37.3449, lng: 126.9683 },
      { name: "의정부시", lat: 37.7381, lng: 127.0337 },
      { name: "이천시", lat: 37.272, lng: 127.435 },
      { name: "파주시", lat: 37.7599, lng: 126.7802 },
      { name: "평택시", lat: 36.9923, lng: 127.1127 },
      { name: "포천시", lat: 37.8949, lng: 127.2003 },
      { name: "하남시", lat: 37.5393, lng: 127.2148 },
      { name: "화성시", lat: 37.1995, lng: 126.8313 },
    ],
  },
  {
    name: "강원특별자치도",
    shortName: "강원",
    lat: 37.8854,
    lng: 127.7298,
    cities: [
      { name: "강릉시", lat: 37.7519, lng: 128.8761 },
      { name: "고성군", lat: 38.3806, lng: 128.4678 },
      { name: "동해시", lat: 37.5247, lng: 129.1143 },
      { name: "삼척시", lat: 37.4499, lng: 129.1653 },
      { name: "속초시", lat: 38.207, lng: 128.5918 },
      { name: "양구군", lat: 38.1099, lng: 127.9899 },
      { name: "양양군", lat: 38.0754, lng: 128.619 },
      { name: "영월군", lat: 37.1836, lng: 128.4618 },
      { name: "원주시", lat: 37.3422, lng: 127.9202 },
      { name: "인제군", lat: 38.0697, lng: 128.1704 },
      { name: "정선군", lat: 37.3806, lng: 128.6609 },
      { name: "철원군", lat: 38.1466, lng: 127.3134 },
      { name: "춘천시", lat: 37.8813, lng: 127.7298 },
      { name: "태백시", lat: 37.1641, lng: 128.9856 },
      { name: "평창군", lat: 37.3705, lng: 128.3905 },
      { name: "홍천군", lat: 37.697, lng: 127.8886 },
      { name: "화천군", lat: 38.1062, lng: 127.7082 },
      { name: "횡성군", lat: 37.4917, lng: 127.9849 },
    ],
  },
  {
    name: "충청북도",
    shortName: "충북",
    lat: 36.6357,
    lng: 127.4912,
    cities: [
      { name: "괴산군", lat: 36.8154, lng: 127.7867 },
      { name: "단양군", lat: 36.9846, lng: 128.3656 },
      { name: "보은군", lat: 36.4893, lng: 127.7295 },
      { name: "영동군", lat: 36.175, lng: 127.7835 },
      { name: "옥천군", lat: 36.3064, lng: 127.5715 },
      { name: "음성군", lat: 36.9403, lng: 127.6906 },
      { name: "제천시", lat: 37.1326, lng: 128.191 },
      { name: "증평군", lat: 36.7853, lng: 127.5815 },
      { name: "진천군", lat: 36.8553, lng: 127.4355 },
      { name: "청주시", lat: 36.6424, lng: 127.489 },
      { name: "충주시", lat: 36.991, lng: 127.9259 },
    ],
  },
  {
    name: "충청남도",
    shortName: "충남",
    lat: 36.6588,
    lng: 126.6728,
    cities: [
      { name: "계룡시", lat: 36.2746, lng: 127.2486 },
      { name: "공주시", lat: 36.4466, lng: 127.119 },
      { name: "금산군", lat: 36.1088, lng: 127.4882 },
      { name: "논산시", lat: 36.1872, lng: 127.0987 },
      { name: "당진시", lat: 36.8899, lng: 126.6458 },
      { name: "보령시", lat: 36.3335, lng: 126.6129 },
      { name: "부여군", lat: 36.2756, lng: 126.9098 },
      { name: "서산시", lat: 36.7848, lng: 126.4503 },
      { name: "서천군", lat: 36.0804, lng: 126.6915 },
      { name: "아산시", lat: 36.7898, lng: 127.0025 },
      { name: "예산군", lat: 36.6824, lng: 126.8483 },
      { name: "천안시", lat: 36.8151, lng: 127.1139 },
      { name: "청양군", lat: 36.4591, lng: 126.8022 },
      { name: "태안군", lat: 36.7456, lng: 126.2981 },
      { name: "홍성군", lat: 36.6012, lng: 126.6608 },
    ],
  },
  {
    name: "전북특별자치도",
    shortName: "전북",
    lat: 35.8204,
    lng: 127.1088,
    cities: [
      { name: "고창군", lat: 35.4358, lng: 126.7019 },
      { name: "군산시", lat: 35.9677, lng: 126.7366 },
      { name: "김제시", lat: 35.8036, lng: 126.8807 },
      { name: "남원시", lat: 35.4164, lng: 127.3904 },
      { name: "무주군", lat: 36.0068, lng: 127.6608 },
      { name: "부안군", lat: 35.7316, lng: 126.7335 },
      { name: "순창군", lat: 35.3744, lng: 127.1374 },
      { name: "완주군", lat: 35.9048, lng: 127.1621 },
      { name: "익산시", lat: 35.9483, lng: 126.9578 },
      { name: "임실군", lat: 35.6178, lng: 127.289 },
      { name: "장수군", lat: 35.6473, lng: 127.5214 },
      { name: "전주시", lat: 35.8242, lng: 127.148 },
      { name: "정읍시", lat: 35.5699, lng: 126.8559 },
      { name: "진안군", lat: 35.7917, lng: 127.4249 },
    ],
  },
  {
    name: "전라남도",
    shortName: "전남",
    lat: 34.8161,
    lng: 126.4629,
    cities: [
      { name: "강진군", lat: 34.642, lng: 126.7672 },
      { name: "고흥군", lat: 34.6112, lng: 127.285 },
      { name: "곡성군", lat: 35.282, lng: 127.2919 },
      { name: "광양시", lat: 34.9407, lng: 127.6959 },
      { name: "구례군", lat: 35.2025, lng: 127.4628 },
      { name: "나주시", lat: 35.0158, lng: 126.7108 },
      { name: "담양군", lat: 35.3212, lng: 126.9882 },
      { name: "목포시", lat: 34.8118, lng: 126.3922 },
      { name: "무안군", lat: 34.9905, lng: 126.4817 },
      { name: "보성군", lat: 34.7715, lng: 127.0801 },
      { name: "순천시", lat: 34.9506, lng: 127.4872 },
      { name: "신안군", lat: 34.8336, lng: 126.3511 },
      { name: "여수시", lat: 34.7604, lng: 127.6622 },
      { name: "영광군", lat: 35.2772, lng: 126.512 },
      { name: "영암군", lat: 34.8002, lng: 126.6968 },
      { name: "완도군", lat: 34.311, lng: 126.7551 },
      { name: "장성군", lat: 35.3019, lng: 126.7848 },
      { name: "장흥군", lat: 34.6817, lng: 126.9069 },
      { name: "진도군", lat: 34.4868, lng: 126.2634 },
      { name: "함평군", lat: 35.0659, lng: 126.5166 },
      { name: "해남군", lat: 34.5735, lng: 126.5993 },
      { name: "화순군", lat: 35.0645, lng: 126.9865 },
    ],
  },
  {
    name: "경상북도",
    shortName: "경북",
    lat: 36.576,
    lng: 128.5056,
    cities: [
      { name: "경산시", lat: 35.8251, lng: 128.7413 },
      { name: "경주시", lat: 35.8562, lng: 129.2247 },
      { name: "고령군", lat: 35.7261, lng: 128.2629 },
      { name: "구미시", lat: 36.1195, lng: 128.3446 },
      { name: "김천시", lat: 36.1398, lng: 128.1136 },
      { name: "문경시", lat: 36.5865, lng: 128.1868 },
      { name: "봉화군", lat: 36.8931, lng: 128.7324 },
      { name: "상주시", lat: 36.4109, lng: 128.1591 },
      { name: "성주군", lat: 35.919, lng: 128.283 },
      { name: "안동시", lat: 36.5684, lng: 128.7294 },
      { name: "영덕군", lat: 36.4151, lng: 129.3653 },
      {
        name: "영양군",
        lat: 36.6667,
        lng: 129.1124,
        subRegions: [
          { name: "영양읍", lat: 36.6667, lng: 129.1124 },
          { name: "청기면", lat: 36.7064, lng: 129.0695 },
          { name: "입암면", lat: 36.5992, lng: 129.0888 },
          { name: "수비면", lat: 36.7988, lng: 129.2116 },
          { name: "석보면", lat: 36.5675, lng: 129.138 },
          { name: "일월면", lat: 36.7438, lng: 129.1135 },
        ],
      },
      { name: "영주시", lat: 36.8057, lng: 128.624 },
      { name: "영천시", lat: 35.9733, lng: 128.9385 },
      { name: "예천군", lat: 36.6578, lng: 128.4528 },
      { name: "울릉군", lat: 37.4844, lng: 130.9057 },
      { name: "울진군", lat: 36.9931, lng: 129.4004 },
      { name: "의성군", lat: 36.3526, lng: 128.697 },
      { name: "청도군", lat: 35.6474, lng: 128.7339 },
      { name: "청송군", lat: 36.4363, lng: 129.0572 },
      { name: "칠곡군", lat: 35.9955, lng: 128.4017 },
      { name: "포항시", lat: 36.019, lng: 129.3435 },
    ],
  },
  {
    name: "경상남도",
    shortName: "경남",
    lat: 35.2383,
    lng: 128.6924,
    cities: [
      { name: "거제시", lat: 34.8806, lng: 128.6211 },
      { name: "거창군", lat: 35.6867, lng: 127.9095 },
      { name: "고성군", lat: 34.973, lng: 128.3223 },
      { name: "김해시", lat: 35.2285, lng: 128.8894 },
      { name: "남해군", lat: 34.8377, lng: 127.8924 },
      { name: "밀양시", lat: 35.5038, lng: 128.7465 },
      { name: "사천시", lat: 35.0038, lng: 128.0642 },
      { name: "산청군", lat: 35.4156, lng: 127.8735 },
      { name: "양산시", lat: 35.335, lng: 129.0372 },
      { name: "의령군", lat: 35.3222, lng: 128.2617 },
      { name: "진주시", lat: 35.1802, lng: 128.1076 },
      { name: "창녕군", lat: 35.5446, lng: 128.4923 },
      { name: "창원시", lat: 35.228, lng: 128.6811 },
      { name: "통영시", lat: 34.8544, lng: 128.4332 },
      { name: "하동군", lat: 35.0672, lng: 127.7513 },
      { name: "함안군", lat: 35.2725, lng: 128.4065 },
      { name: "함양군", lat: 35.5205, lng: 127.7252 },
      { name: "합천군", lat: 35.5667, lng: 128.1658 },
    ],
  },
  {
    name: "제주특별자치도",
    shortName: "제주",
    lat: 33.4996,
    lng: 126.5312,
    cities: [
      { name: "서귀포시", lat: 33.2541, lng: 126.5601 },
      { name: "제주시", lat: 33.4996, lng: 126.5312 },
    ],
  },
];

function makeEntry({ name, province, city, subRegion = null, lat, lng }) {
  const { nx, ny } = latLngToKmaGrid(lat, lng);
  return {
    name,
    province,
    city,
    ...(subRegion ? { subRegion } : {}),
    lat,
    lng,
    nx,
    ny,
  };
}

// 빠른 조회용 인덱스 구축
const exactIndex = new Map();
const cityIndex = new Map();
const provinceIndex = new Map();
const searchableEntries = [];

for (const prov of KOREA_REGIONS) {
  const provEntry = makeEntry({
    name: prov.name,
    province: prov.name,
    city: prov.name,
    lat: prov.lat,
    lng: prov.lng,
  });
  provinceIndex.set(prov.name, provEntry);
  provinceIndex.set(prov.shortName, provEntry);

  for (const city of prov.cities) {
    const fullName = `${prov.name} ${city.name}`;
    const shortFullName = `${prov.shortName} ${city.name}`;
    const cityEntry = makeEntry({
      name: fullName,
      province: prov.name,
      city: city.name,
      lat: city.lat,
      lng: city.lng,
    });
    exactIndex.set(fullName, cityEntry);
    exactIndex.set(shortFullName, cityEntry);
    if (!cityIndex.has(city.name)) {
      cityIndex.set(city.name, cityEntry);
    }

    if (Array.isArray(city.subRegions) && city.subRegions.length) {
      for (const sub of city.subRegions) {
        const subEntry = makeEntry({
          name: sub.name,
          province: prov.name,
          city: city.name,
          subRegion: sub.name,
          lat: sub.lat,
          lng: sub.lng,
        });
        // 기존 영양읍/청기면/입암면/수비면 등 읍·면 단축키 지원
        exactIndex.set(sub.name, subEntry);
        exactIndex.set(`${city.name} ${sub.name}`, subEntry);
        exactIndex.set(`${prov.name} ${city.name} ${sub.name}`, subEntry);
        exactIndex.set(`${prov.shortName} ${city.name} ${sub.name}`, subEntry);
        searchableEntries.push(subEntry);
      }
    } else {
      searchableEntries.push(cityEntry);
    }
  }
}

const DEFAULT_REGION_ENTRY = exactIndex.get("영양읍");

/**
 * 지역명(예: "영양읍", "경상북도 영양군", "경기도 수원시", "영양군 청기면")을 좌표 및 기상청 격자로 변환합니다.
 */
export function getRegionCoords(regionName) {
  const raw = typeof regionName === "string" ? regionName.trim() : "";
  if (!raw) return DEFAULT_REGION_ENTRY;

  if (exactIndex.has(raw)) return exactIndex.get(raw);
  const normalized = raw.replace(/\s*·\s*/g, " ").replace(/\s+/g, " ").trim();
  if (exactIndex.has(normalized)) return exactIndex.get(normalized);
  if (cityIndex.has(normalized)) return cityIndex.get(normalized);
  if (provinceIndex.has(normalized)) return provinceIndex.get(normalized);

  // 공백 구분 토큰 마지막 요소(예: "경상북도 영양군 영양읍"의 끝) 또는 부분 일치
  const parts = normalized.split(" ");
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    if (exactIndex.has(last)) return exactIndex.get(last);
    if (cityIndex.has(last)) return cityIndex.get(last);
  }

  for (const [key, entry] of exactIndex.entries()) {
    if (key.endsWith(normalized) || normalized.endsWith(key)) {
      return entry;
    }
  }

  return DEFAULT_REGION_ENTRY;
}

function haversineDistanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * DEGRAD;
  const dLng = (lng2 - lng1) * DEGRAD;
  const sLat = Math.sin(dLat / 2);
  const sLng = Math.sin(dLng / 2);
  const h = sLat * sLat + Math.cos(lat1 * DEGRAD) * Math.cos(lat2 * DEGRAD) * sLng * sLng;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * GPS 위·경도와 가장 가까운 대한민국 시·군·구(또는 읍·면) 지역을 반환합니다.
 */
export function findNearestRegion(lat, lng) {
  const numLat = Number(lat);
  const numLng = Number(lng);
  if (!Number.isFinite(numLat) || !Number.isFinite(numLng)) {
    return { ...DEFAULT_REGION_ENTRY, distanceKm: 0 };
  }

  let best = searchableEntries[0];
  let bestDist = Infinity;
  for (const entry of searchableEntries) {
    const d = haversineDistanceKm(numLat, numLng, entry.lat, entry.lng);
    if (d < bestDist) {
      bestDist = d;
      best = entry;
    }
  }

  return {
    ...best,
    distanceKm: Math.round(bestDist * 10) / 10,
  };
}
