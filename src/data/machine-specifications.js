// Actual model specifications; rental price, stock, condition and bookings remain demo data.
// null means unverified, never a wildcard or a compatible connection.
export const MACHINE_SPECIFICATIONS = [
  {
    "id": "kubota-b2320",
    "brand": "한국구보다",
    "model": "B2320",
    "machineType": "tractor",
    "role": "powerUnit",
    "specs": {
      "nominalPowerPs": 20
    },
    "facts": [
      [
        "호칭 마력",
        "20 PS"
      ],
      [
        "체급",
        "소형 콤팩트 트랙터 (B 시리즈)"
      ],
      [
        "주 용도",
        "비닐하우스 및 소규모 농지 경운·관리"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 · 세부 규격(Cat I 예상) 및 PTO 회전수 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.kubotakorea.com/",
        "title": "한국구보다 공식 제품 라인업 (B2320)",
        "note": "제조사 공식 홈페이지 트랙터 B시리즈 20마력 표기",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "엔진 배기량",
      "기체 치수 및 중량",
      "3점 히치 카테고리(Cat I 여부)",
      "PTO 회전수",
      "후방 양력"
    ]
  },
  {
    "id": "tym-t25",
    "brand": "TYM",
    "model": "T25",
    "machineType": "tractor",
    "role": "powerUnit",
    "specs": {
      "nominalPowerPs": 24.2,
      "dimensionsMm": [
        2395,
        1170,
        2500
      ],
      "wheelbaseMm": 1460,
      "weightKg": 835,
      "threePointLiftKgf": 730.1,
      "fuelTankL": 20
    },
    "facts": [
      [
        "호칭 마력",
        "24.2 PS (얀마 3기통 엔진)"
      ],
      [
        "크기 (접이식 ROPS)",
        "2,395 × 1,170 × 2,500 mm"
      ],
      [
        "중량",
        "835 kg (기계식) / 820 kg (HST)"
      ],
      [
        "3점 히치 양력",
        "730.1 kgf"
      ],
      [
        "연료탱크",
        "20 L"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 · 양력 730.1 kgf, 세부 히치 카테고리·PTO 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://tym.world/",
        "title": "TYM T25 (시리즈 1) 공식 제품 제원",
        "note": "기계식 835kg / HST 820kg 병기",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "3점 히치 카테고리(Cat I 여부)",
      "핀 직경",
      "PTO 회전수 및 스플라인"
    ]
  },
  {
    "id": "daedong-dk450",
    "brand": "대동",
    "model": "DK450HSRQ5",
    "machineType": "tractor",
    "role": "powerUnit",
    "specs": {
      "nominalPowerPs": 45,
      "enginePowerKw": 33.5,
      "engineRpm": 2600,
      "displacementCc": 1826,
      "ptoRpm": [
        540,
        750,
        1000
      ],
      "rearHydraulicPorts": 6
    },
    "facts": [
      [
        "호칭 마력",
        "45 PS"
      ],
      [
        "엔진 출력",
        "33.5 kW / 2,600 rpm"
      ],
      [
        "배기량",
        "1,826 cc"
      ],
      [
        "독립형 PTO",
        "540 / 750 / 1,000 rpm"
      ],
      [
        "후방 유압 인출구",
        "6개"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 작업기 연결 · PTO 540/750/1000 rpm, 히치 세부 규격 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": [
        540,
        750,
        1000
      ]
    },
    "sources": [
      {
        "url": "https://ko.daedong.co.kr/product/12",
        "title": "대동 DK 시리즈 · 상세 형식별 제원",
        "note": "제조사 공식 제품 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "3점 히치 카테고리",
      "핀 직경",
      "PTO 축 규격",
      "작업 위치별 승강력"
    ]
  },
  {
    "id": "daedong-dk550",
    "brand": "대동",
    "model": "DK550HSRQ5",
    "machineType": "tractor",
    "role": "powerUnit",
    "specs": {
      "nominalPowerPs": 55,
      "enginePowerKw": 41,
      "engineRpm": 2600,
      "displacementCc": 1826,
      "ptoRpm": [
        540,
        750,
        1000
      ],
      "rearHydraulicPorts": 6
    },
    "facts": [
      [
        "호칭 마력",
        "55 PS"
      ],
      [
        "엔진 출력",
        "41 kW / 2,600 rpm"
      ],
      [
        "배기량",
        "1,826 cc"
      ],
      [
        "독립형 PTO",
        "540 / 750 / 1,000 rpm"
      ],
      [
        "후방 유압 인출구",
        "6개"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 작업기 연결 · PTO 540/750/1000 rpm, 히치 세부 규격 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": [
        540,
        750,
        1000
      ]
    },
    "sources": [
      {
        "url": "https://ko.daedong.co.kr/product/12",
        "title": "대동 DK 시리즈 · 상세 형식별 제원",
        "note": "제조사 공식 제품 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "3점 히치 카테고리",
      "핀 직경",
      "PTO 축 규격",
      "작업 위치별 승강력"
    ]
  },
  {
    "id": "daedong-dk600",
    "brand": "대동",
    "model": "DK600HSRQ5",
    "machineType": "tractor",
    "role": "powerUnit",
    "specs": {
      "nominalPowerPs": 58,
      "enginePowerKw": 43,
      "engineRpm": 2600,
      "displacementCc": 1826,
      "ptoRpm": [
        540,
        750,
        1000
      ],
      "rearHydraulicPorts": 6
    },
    "facts": [
      [
        "호칭 마력",
        "58 PS"
      ],
      [
        "엔진 출력",
        "43 kW / 2,600 rpm"
      ],
      [
        "배기량",
        "1,826 cc"
      ],
      [
        "독립형 PTO",
        "540 / 750 / 1,000 rpm"
      ],
      [
        "후방 유압 인출구",
        "6개"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 작업기 연결 · PTO 540/750/1000 rpm, 히치 세부 규격 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": [
        540,
        750,
        1000
      ]
    },
    "sources": [
      {
        "url": "https://ko.daedong.co.kr/product/12",
        "title": "대동 DK 시리즈 · 상세 형식별 제원",
        "note": "제조사 공식 제품 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "3점 히치 카테고리",
      "핀 직경",
      "PTO 축 규격",
      "작업 위치별 승강력"
    ]
  },
  {
    "id": "ls-mt3-58",
    "brand": "LS엠트론",
    "model": "MT3.58",
    "machineType": "tractor",
    "role": "powerUnit",
    "specs": {
      "enginePowerPs": 58.9,
      "ptoPowerPs": 48.9,
      "fuelTankL": 52
    },
    "facts": [
      [
        "엔진 마력",
        "58.9 PS"
      ],
      [
        "PTO 마력",
        "48.9 PS"
      ],
      [
        "연료탱크",
        "52 L"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 작업기 연결 · 히치 카테고리 및 PTO 회전수 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.lstractor.com/",
        "title": "LS엠트론 MT3.58 공식 제품 사양",
        "note": "엔진 마력과 PTO 마력을 구분 표기한 공식 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "기체 치수 및 중량",
      "3점 히치 카테고리·핀 직경",
      "PTO 회전수 단수",
      "후방 양력"
    ]
  },
  {
    "id": "yanmar-yt470a",
    "brand": "얀마",
    "model": "YT470A",
    "machineType": "tractor",
    "role": "powerUnit",
    "specs": {
      "nominalPowerPs": 70,
      "weightKg": 2975
    },
    "facts": [
      [
        "호칭 마력",
        "70.0 PS"
      ],
      [
        "기체 중량",
        "약 2,975 kg"
      ],
      [
        "체급",
        "중형 YT4 시리즈"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 작업기 연결 · 히치 세부 규격 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.yanmar.com/kr/agri/",
        "title": "얀마농기코리아 YT470A 공식 제품 정보",
        "note": "제조사 한국 사이트 공개 제원",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "기체 외형 치수",
      "3점 히치 카테고리",
      "PTO 회전수 및 출력",
      "후방 승강력"
    ]
  },
  {
    "id": "tym-t75",
    "brand": "TYM",
    "model": "K75E",
    "machineType": "tractor",
    "role": "powerUnit",
    "specs": {
      "nominalPowerPs": 75,
      "dimensionsMm": [
        3685,
        1890,
        2720
      ],
      "wheelbaseMm": 2200,
      "weightKg": 2935,
      "threePointLiftKgf": 2376,
      "fuelTankL": 90
    },
    "facts": [
      [
        "마력",
        "73.9 ~ 75 PS (4기통 디젤 터보)"
      ],
      [
        "크기",
        "3,685 × 1,890 × 2,720 mm"
      ],
      [
        "중량",
        "2,935 kg"
      ],
      [
        "3점 히치 양력",
        "2,376 kgf"
      ],
      [
        "변속",
        "파워셔틀 전진 16단 × 후진 16단"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 작업기 연결 · 양력 2,376 kgf, 히치 카테고리·PTO 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://tym.world/",
        "title": "TYM K75E (75마력급) 공식 제원",
        "note": "제조사 공식 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "3점 히치 카테고리",
      "핀 직경",
      "PTO 회전수"
    ]
  },
  {
    "id": "tym-t110",
    "brand": "TYM",
    "model": "T110",
    "machineType": "tractor",
    "role": "powerUnit",
    "specs": {
      "nominalPowerPs": 111,
      "threePointLiftKgf": 4170,
      "hydraulicPorts": 6
    },
    "facts": [
      [
        "호칭 마력",
        "111 ~ 111.5 PS (대형 시리즈 6)"
      ],
      [
        "3점 히치 양력",
        "약 4,170 kgf"
      ],
      [
        "외부 유압 밸브",
        "전후방 6포트"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "대형 트랙터 작업기 연결 · 양력 4,170 kgf, 히치·PTO 규격 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://tym.world/",
        "title": "TYM T110 (시리즈 6) 공식 제품 사양",
        "note": "제조사 공개 제원",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "기체 치수 및 중량",
      "3점 히치 카테고리(Cat II 여부)",
      "PTO 회전수 단수"
    ]
  },
  {
    "id": "daedong-hx1400",
    "brand": "대동",
    "model": "HX1400",
    "machineType": "tractor",
    "role": "powerUnit",
    "specs": {
      "nominalPowerPs": 142,
      "displacementCc": 3800
    },
    "facts": [
      [
        "호칭 마력",
        "142 PS (대형 플래그십)"
      ],
      [
        "엔진",
        "대동 자체 개발 3.8L 디젤 엔진"
      ],
      [
        "특징",
        "로드센싱 유압 시스템·LSD 앞차축"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "대형 트랙터 작업기 연결 · 히치 카테고리 및 PTO 회전수 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://ko.daedong.co.kr/",
        "title": "대동 HX1400 공식 제품 소개",
        "note": "제조사 공식 웹사이트",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "기체 치수 및 중량",
      "3점 히치 카테고리",
      "PTO 회전수 단수",
      "후방 양력"
    ]
  },
  {
    "id": "asia-amc900",
    "brand": "아세아텍",
    "model": "AMC-900",
    "machineType": "cultivator",
    "role": "powerUnit",
    "specs": {
      "engineModel": "GB290L",
      "displacementCc": 296,
      "ratedPowerKw": 4.8,
      "maxPowerKw": 5.8,
      "weightKg": 162,
      "ptoRpm": [
        714,
        1350
      ]
    },
    "facts": [
      [
        "엔진",
        "GB290L · 296 cc 공냉 OHV 가솔린"
      ],
      [
        "출력",
        "정격 4.8 kW / 최대 5.8 kW"
      ],
      [
        "기체 중량",
        "162 kg"
      ],
      [
        "PTO 회전수",
        "714 / 1,350 rpm"
      ]
    ],
    "connection": {
      "hostType": "cultivator",
      "label": "아세아 관리기 전용 히치핀 방식",
      "family": "asia-900",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": [
        714,
        1350
      ]
    },
    "sources": [
      {
        "url": "https://www.asiakor.com/mobile/design/subpage/goods.php?catalog=G1619677688&category=",
        "title": "아세아텍 AMC-900",
        "note": "제조사 공개 제품 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "히치핀 직경",
      "PTO 축 치수",
      "연식별 엔진 사양"
    ]
  },
  {
    "id": "asia-amc1000",
    "brand": "아세아텍",
    "model": "AMC-1000",
    "machineType": "cultivator",
    "role": "powerUnit",
    "specs": {
      "engineModel": "GB300L",
      "displacementCc": 296,
      "weightKg": 163
    },
    "facts": [
      [
        "엔진",
        "GB300L · 296 cc 공냉 OHV 4사이클 가솔린"
      ],
      [
        "기체 중량",
        "약 163 kg (로타리 포함)"
      ],
      [
        "규격",
        "전장 1,490~1,700 × 전폭 680~850 × 전고 820~1,140 mm"
      ]
    ],
    "connection": {
      "hostType": "cultivator",
      "label": "아세아 관리기 전용 히치핀 방식",
      "family": "asia-900",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.asiakor.com/",
        "title": "아세아텍 AMC-1000 공식 제품 사양",
        "note": "아세아 880/900/1000 시리즈 호환 히치핀 공유",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "정격/최대 출력(kW)",
      "히치핀 직경",
      "PTO 회전수"
    ]
  },
  {
    "id": "daedong-dt100",
    "brand": "대동",
    "model": "DT100 / DT100N",
    "machineType": "tiller",
    "role": "powerUnit",
    "specs": {
      "engineModel": "ND10DE",
      "displacementCc": 673,
      "ratedPowerPs": 10,
      "fuelTankL": 11
    },
    "facts": [
      [
        "엔진",
        "ND10DE · 673 cc 횡형 수냉 단기통 디젤"
      ],
      [
        "상용 마력",
        "10 PS"
      ],
      [
        "중량",
        "약 383 ~ 469 kg (트레일러·로터리 옵션별 상이)"
      ],
      [
        "연료탱크",
        "11 L"
      ]
    ],
    "connection": {
      "hostType": "tiller",
      "label": "경운기 전용 히치·벨트/PTO 연결 (트랙터/관리기와 비호환)",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://ko.daedong.co.kr/",
        "title": "대동 경운기 DT100 / DT100N 제원",
        "note": "유통·임대사업소 제원표 기준 상용 10마력",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "세부 트레일러 적재중량",
      "로터리 작업폭",
      "히치핀 직경"
    ]
  },
  {
    "id": "yanmar-md20",
    "brand": "얀마",
    "model": "MD20",
    "machineType": "ridingCultivator",
    "role": "powerUnit",
    "specs": {
      "enginePowerKw": 13.4,
      "nominalPowerPs": 18,
      "engineRpm": 2800,
      "displacementCc": 688,
      "weightKg": 665
    },
    "facts": [
      [
        "출력",
        "13.4 kW (18.0 PS) / 2,800 rpm"
      ],
      [
        "엔진",
        "공냉 4행정 가솔린 · 688 cc"
      ],
      [
        "구동 방식",
        "3륜 구동 · 미드마운트 작업기 구조"
      ],
      [
        "중량",
        "665 kg"
      ]
    ],
    "connection": {
      "hostType": "ridingCultivator",
      "label": "얀마 MD20 미드마운트 전용 작업기 연결",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.yanmar.com/kr/agri/",
        "title": "얀마농기코리아 MD20 3륜 승용관리기 제원",
        "note": "제조사 한국 사이트 공개 제원",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "외형 치수",
      "전용 부착 작업기 상세 규격"
    ]
  },
  {
    "id": "wecan-sgw",
    "brand": "위캔글로벌",
    "model": "SGW 시리즈",
    "machineType": "rotavator",
    "role": "implement",
    "specs": {
      "publishedTractorPowerRange": {
        "min": 35,
        "max": 75,
        "unit": "마력(원문)",
        "basis": "unspecified"
      }
    },
    "facts": [
      [
        "용도",
        "논 전용 트랙터 부착형 로타베이터"
      ],
      [
        "작업폭 범위",
        "1,650 ~ 3,000 mm (세부 형식별 상이)"
      ],
      [
        "적용 트랙터",
        "35 ~ 75 마력"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 부착형 · 모델별 작업폭·히치 카테고리 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://wecan21.com/",
        "title": "위캔글로벌 SGW 논 전용 로타베이터",
        "note": "제조사 공개 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "개별 세부 형식명별 중량 및 치수",
      "3점 히치 카테고리(Cat I/II)",
      "PTO 입력 회전수(540 rpm 여부)"
    ]
  },
  {
    "id": "woongjin-wj230se",
    "brand": "웅진기계",
    "model": "WJ230SE",
    "machineType": "rotavator",
    "role": "implement",
    "specs": {
      "publishedTractorPowerRange": {
        "min": 85,
        "max": 105,
        "unit": "마력(원문)",
        "basis": "unspecified"
      }
    },
    "facts": [
      [
        "용도",
        "대형 보강형 트랙터 로타베이터"
      ],
      [
        "작업폭",
        "약 2,200 ~ 2,250 mm"
      ],
      [
        "적용 트랙터",
        "85 ~ 105 마력 (최대 150마력대 대응 언급)"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 부착형 · 대형 트랙터(85PS 이상) 권장, 히치/PTO 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.kamico.or.kr/",
        "title": "웅진기계 WJ230SE 로타베이터 제원",
        "note": "농기계 전문지 및 KAMICO 목록 참조",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "기체 중량 및 외형 치수",
      "3점 히치 카테고리(Cat II 여부)",
      "PTO 입력 회전수"
    ]
  },
  {
    "id": "asia-fm120n",
    "brand": "아세아텍",
    "model": "FM-120N",
    "machineType": "ridgeMulcher",
    "role": "implement",
    "specs": {
      "dimensionsMm": [
        1400,
        1420,
        800
      ],
      "roundRidgeFilmWidthMm": [
        750,
        1200
      ],
      "squareRidgeFilmWidthMm": [
        750,
        1800
      ]
    },
    "facts": [
      [
        "크기 (로타리 부착 상태)",
        "1,400 × 1,420 × 800 mm"
      ],
      [
        "둥근 두둑 비닐 폭",
        "750 ~ 1,200 mm"
      ],
      [
        "각 두둑 비닐 폭",
        "750 ~ 1,800 mm"
      ],
      [
        "제조사 부착 가능 기종",
        "아세아 880 / 900 / 1000 시리즈"
      ]
    ],
    "connection": {
      "hostType": "cultivator",
      "label": "아세아 관리기 전용",
      "approvedModelIds": [
        "asia-amc900",
        "asia-amc1000"
      ],
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.asiakor.com/mobile/design/subpage/goods.php?catalog=G1619677610&category=",
        "title": "아세아텍 FM-120N",
        "note": "제조사 공개 제품 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "히치핀 직경",
      "PTO 입력 회전수",
      "중량(원문 단위 오류로 보류)"
    ]
  },
  {
    "id": "dooroo-drb1200pc",
    "brand": "두루기계통상",
    "model": "DRB-1200PC",
    "machineType": "ridgeMulcher",
    "role": "implement",
    "specs": {
      "dimensionsMm": [
        2500,
        1950,
        1380
      ],
      "weightKg": 830,
      "rotaryRpm": 168
    },
    "facts": [
      [
        "규격",
        "1두둑용 휴립복토·비닐피복기 (마늘·양파 등)"
      ],
      [
        "크기",
        "2,500 × 1,950 × 1,380 mm"
      ],
      [
        "중량",
        "830 kg"
      ],
      [
        "로터리",
        "168 rpm · L형 경운날 30개 · 스크류 495 mm"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 부착형 · 830 kg 중량에 따른 트랙터 승강력·히치 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.dooroo21.com/",
        "title": "두루기계통상 DRB-1200PC 제원",
        "note": "제조사 공식 제품 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "권장 트랙터 마력 범위",
      "3점 히치 카테고리",
      "PTO 입력 회전수(540 rpm 여부)"
    ]
  },
  {
    "id": "woongjin-uj3ps",
    "brand": "웅진기계",
    "model": "UJ3PS",
    "machineType": "plow",
    "role": "implement",
    "specs": {
      "workingWidthMm": 950,
      "weightKg": 420,
      "dimensionsMm": [
        2660,
        1370,
        1540
      ],
      "publishedTractorPowerRange": {
        "min": 50,
        "max": 70,
        "unit": "마력(원문)",
        "basis": "unspecified"
      }
    },
    "facts": [
      [
        "구분",
        "단용 3련 대형 삭쟁기"
      ],
      [
        "경운폭",
        "950 mm"
      ],
      [
        "중량",
        "420 kg"
      ],
      [
        "크기",
        "2,660 × 1,370 × 1,540 mm"
      ],
      [
        "적용 트랙터",
        "50 ~ 70 마력"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 부착형 · 50~70마력, 히치 카테고리 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.komachine.com/",
        "title": "웅진기계 삭쟁기 UJ3PS 제원",
        "note": "제조사 공개 카탈로그 제원",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "3점 히치 카테고리(Cat I/II)",
      "핀 직경"
    ]
  },
  {
    "id": "woongjin-w62dp",
    "brand": "웅진기계",
    "model": "W62-DP",
    "machineType": "plow",
    "role": "implement",
    "specs": {
      "workingWidthMm": 1800,
      "weightKg": 425,
      "dimensionsMm": [
        1060,
        2200,
        1150
      ],
      "publishedTractorPowerRange": {
        "min": 35,
        "max": 55,
        "unit": "마력(원문)",
        "basis": "unspecified"
      }
    },
    "facts": [
      [
        "구분",
        "원판쟁기 (원판 6+2개 구성)"
      ],
      [
        "경운폭",
        "1,800 mm"
      ],
      [
        "중량",
        "425 kg"
      ],
      [
        "크기",
        "1,060 × 2,200 × 1,150 mm"
      ],
      [
        "적용 트랙터",
        "35 ~ 55 마력"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 부착형 · 35~55마력, 히치 카테고리 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.komachine.com/",
        "title": "웅진기계 원판쟁기 W62-DP 제원",
        "note": "제조사 공개 카탈로그 제원",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "3점 히치 카테고리",
      "핀 직경"
    ]
  },
  {
    "id": "knong-kgph9000",
    "brand": "강농",
    "model": "KG-PH9000",
    "machineType": "potatoPlanter",
    "role": "implement",
    "specs": {
      "rows": 2,
      "dimensionsMm": [
        1910,
        1980,
        1620
      ],
      "weightKg": 819,
      "plantSpacingMm": [
        250,
        350
      ],
      "publishedTractorPowerRange": {
        "min": 50,
        "max": 200,
        "unit": "HP",
        "basis": "unspecified"
      }
    },
    "facts": [
      [
        "파종",
        "2조식 (1두둑 2줄 재배, 주간 250~350 mm)"
      ],
      [
        "크기 / 중량",
        "1,910 × 1,980 × 1,620 mm / 819 kg"
      ],
      [
        "부착 방식",
        "트랙터 3점 링크 Cat I"
      ],
      [
        "적용 마력",
        "50 ~ 200 HP (일부 자료 50~90마력 안내)"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 링크 Cat I 부착형 · 로터리 PTO 및 유압 확인 필요",
      "hitchCategory": "Cat I",
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.knong.kr/blank-6",
        "title": "강농 KG-PH9000 공식 제품 사양",
        "note": "제조사 페이지에서 Cat I, 치수, 중량 819kg, 50~200HP 확인",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "로터리 PTO 입력 회전수",
      "유압 요구량",
      "Cat II 트랙터 장착 시 부싱 필요 여부"
    ]
  },
  {
    "id": "dooroo-drp1006sg",
    "brand": "두루기계통상",
    "model": "DRP-1006SG",
    "machineType": "garlicOnionPlanter",
    "role": "implement",
    "specs": {
      "rows": 6,
      "dimensionsMm": [
        1800,
        1880,
        1770
      ],
      "weightKg": 1085,
      "seedHopperL": 210,
      "publishedTractorPowerRange": {
        "min": 70,
        "max": null,
        "unit": "HP",
        "basis": "unspecified"
      }
    },
    "facts": [
      [
        "파종 조수",
        "6조 (7조 DRP-1007SG / 8조 DRP-1008SG)"
      ],
      [
        "크기",
        "1,800 × 1,880 × 1,770 mm"
      ],
      [
        "중량",
        "1,085 kg (비닐피복기 부착 시 1,220 kg)"
      ],
      [
        "종자함",
        "210 L (약 100 kg)"
      ],
      [
        "필요 트랙터",
        "70 HP 이상"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 PTO 및 접지륜 구동 · 70HP 이상 및 1,220kg 승강력 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.dooroo21.com/",
        "title": "두루기계통상 DRP-1006SG 마늘 파종기 제원",
        "note": "제조사 공식 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "3점 히치 카테고리(Cat II 예상)",
      "PTO 입력 회전수",
      "유압 포트 요구 개수"
    ]
  },
  {
    "id": "knong-tj6000",
    "brand": "강농",
    "model": "TJ-6000",
    "machineType": "garlicOnionPlanter",
    "role": "implement",
    "specs": {
      "rows": 7,
      "dimensionsMm": [
        2100,
        1570,
        1700
      ],
      "weightKg": 660,
      "publishedTractorPowerRange": {
        "min": 45,
        "max": 100,
        "unit": "HP",
        "basis": "unspecified"
      }
    },
    "facts": [
      [
        "파종 방식",
        "종이줄·실 매립 줄파종 · 7조"
      ],
      [
        "크기 / 중량",
        "2,100 × 1,570 × 1,700 mm / 660 kg"
      ],
      [
        "적용 트랙터",
        "45 ~ 100 HP (50~90마력 최적화)"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 부착형 · 45~100HP, 히치·PTO 규격 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.knong.kr/",
        "title": "강농 TJ-6000 마늘파종기 제원",
        "note": "제조사 공식 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "3점 히치 카테고리",
      "PTO 입력 회전수"
    ]
  },
  {
    "id": "duru-dr950an",
    "brand": "두루기계통상",
    "model": "DR-950AN",
    "machineType": "potatoHarvester",
    "role": "implement",
    "specs": {
      "workingWidthMm": 950,
      "publishedTractorPowerRange": {
        "min": 43,
        "max": null,
        "unit": "마력(원문)",
        "basis": "unspecified"
      }
    },
    "facts": [
      [
        "작업 폭",
        "950 mm"
      ],
      [
        "적용 트랙터",
        "43마력 이상 (2026 목록집 기준)"
      ],
      [
        "용도",
        "트랙터용 감자 수확기"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 부착형 · 상세 연결 규격 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.gunsan.go.kr/_cms/board/eFileDownload/95/8545851/ed8338a8650cf3cb8a45575fe684aa17#page=117",
        "title": "한국농기계공업협동조합 2026 목록집 · 인쇄 115쪽",
        "note": "군산시 공개 원문 기준 43마력 이상 채택",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "연식별 적용 마력 차이",
      "히치·PTO 규격",
      "승강력·중량"
    ]
  },
  {
    "id": "dooroo-drgh1400",
    "brand": "두루기계통상",
    "model": "DRGH-1400",
    "machineType": "rootHarvester",
    "role": "implement",
    "specs": {
      "workingWidthMm": 1400,
      "dimensionsMm": [
        1244,
        1700,
        1165
      ],
      "weightKg": 450,
      "publishedTractorPowerRange": {
        "min": 43,
        "max": 55,
        "unit": "HP",
        "basis": "unspecified"
      }
    },
    "facts": [
      [
        "용도",
        "마늘·양파·생강 등 땅속작물 진동 굴취기"
      ],
      [
        "굴취폭",
        "1,400 mm (시리즈 1,200/1,400/1,500 mm)"
      ],
      [
        "크기 / 중량",
        "1,244 × 1,700 × 1,165 mm / 450 kg"
      ],
      [
        "필요 트랙터",
        "43 ~ 55 HP 이상 (기어박스 직결식)"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 기어박스 직결식 · 43~55HP 이상, 히치/PTO 규격 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.dooroo21.com/",
        "title": "두루기계통상 DRGH-1400 땅속작물 수확기 제원",
        "note": "제조사 공식 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "3점 히치 카테고리",
      "PTO 입력 회전수"
    ]
  },
  {
    "id": "yanmar-ph1r",
    "brand": "얀마",
    "model": "PH1,R",
    "machineType": "transplanter",
    "role": "standalone",
    "specs": {
      "dimensionsMm": [
        1900,
        1340,
        1220
      ],
      "weightKg": 163,
      "ratedPowerKw": 1.6,
      "rows": 1,
      "plantSpacingMm": [
        200,
        500
      ],
      "ridgeHeightMm": [
        0,
        300
      ]
    },
    "facts": [
      [
        "형식",
        "1조식 · 일본 R 사양"
      ],
      [
        "크기",
        "1,900 × 1,340 × 1,220 mm"
      ],
      [
        "중량 / 정격 출력",
        "163 kg / 1.6 kW"
      ],
      [
        "주간 / 두둑 높이",
        "200~500 mm / 0~300 mm"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 트랙터/관리기 연결 불필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.yanmar.com/jp/agri/products/vegetable/vegetable_replant/ph1r/spec.html",
        "title": "얀마 PH1,R 제원",
        "note": "일본 R 사양 기준",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "국내 유통 사양 차이",
      "실제 모종·트레이 적합성"
    ]
  },
  {
    "id": "kubota-skp101kr",
    "brand": "한국구보다",
    "model": "SKP-101-KR",
    "machineType": "transplanter",
    "role": "standalone",
    "specs": {
      "rows": 1,
      "dimensionsMm": [
        2160,
        890,
        1365
      ],
      "weightKg": 238,
      "nominalPowerPs": 2.98
    },
    "facts": [
      [
        "형식",
        "1조식 전자동 채소 정식기 (200구/128구 트레이 호환)"
      ],
      [
        "크기 / 중량",
        "2,160 × 890 × 1,365 mm / 238 kg"
      ],
      [
        "엔진",
        "공냉 4사이클 가솔린 약 2.98 PS / 1,600 rpm"
      ],
      [
        "식부 속도",
        "1속 0.40 m/s · 2속 0.55 m/s"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 트랙터/관리기 연결 불필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.kubotakorea.com/",
        "title": "한국구보다 SKP-101-KR 채소 정식기 제원",
        "note": "제조사 공식 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "주간·조간 조절 범위",
      "연료탱크 용량"
    ]
  },
  {
    "id": "jukam-jopr48a",
    "brand": "죽암기계",
    "model": "JOPR-4/8A",
    "machineType": "transplanter",
    "role": "standalone",
    "specs": {
      "rows": 4,
      "dimensionsMm": [
        3230,
        1980,
        2330
      ],
      "weightKg": 728,
      "displacementCc": 391,
      "maxPowerPs": 11.4
    },
    "facts": [
      [
        "형식",
        "승용 4조(왕복 8조) 4WD 양파·채소 정식기"
      ],
      [
        "크기 / 중량",
        "3,230 × 1,980 × 2,330 mm / 728 kg"
      ],
      [
        "엔진",
        "391 cc 공냉 OHV 가솔린 · 최대 11.4 PS / 3,600 rpm"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 트랙터/관리기 연결 불필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.jukam.co.kr/",
        "title": "죽암기계 JOPR-4/8A 승용 정식기 제원",
        "note": "제조사 공식 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "적합 트레이 규격",
      "식부 깊이·주간 조절 범위"
    ]
  },
  {
    "id": "daedong-drp60d",
    "brand": "대동",
    "model": "DRP60D",
    "machineType": "ricePlanter",
    "role": "standalone",
    "specs": {
      "nominalPowerPs": 24,
      "maxPowerKw": 17.9,
      "displacementCc": 1007,
      "rows": 6,
      "dimensionsMm": [
        3330,
        2200,
        2275
      ]
    },
    "facts": [
      [
        "이앙 조수",
        "6조식"
      ],
      [
        "디젤 엔진",
        "24 PS · 1,007 cc"
      ],
      [
        "최대 출력",
        "17.9 kW / 3,000 rpm"
      ],
      [
        "크기",
        "3,330 × 2,200 × 2,275 mm"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 트랙터/관리기 연결 불필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://ko.daedong.co.kr/product/34",
        "title": "대동 DRP60D 공식 제원",
        "note": "제조사 공식 제품 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "육묘 상자·모 상태 적합성",
      "기체 중량"
    ]
  },
  {
    "id": "yanmar-yr60d",
    "brand": "얀마",
    "model": "YR60D",
    "machineType": "ricePlanter",
    "role": "standalone",
    "specs": {
      "rows": 6,
      "nominalPowerPs": 21.3,
      "weightKg": 760
    },
    "facts": [
      [
        "이앙 조수",
        "6조식"
      ],
      [
        "마력",
        "21.3 PS"
      ],
      [
        "기체 중량",
        "약 760 ~ 829 kg (사양별 상이)"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 트랙터/관리기 연결 불필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.yanmar.com/kr/agri/",
        "title": "얀마농기코리아 YR60D 이앙기 제원",
        "note": "제조사 한국 사이트 공개 제원",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "외형 치수",
      "엔진 배기량"
    ]
  },
  {
    "id": "daedong-dxm73gf5",
    "brand": "대동",
    "model": "DXM73GF5",
    "machineType": "combine",
    "role": "standalone",
    "specs": {
      "nominalPowerPs": 73,
      "rows": 4,
      "dimensionsMm": [
        4390,
        2505,
        3155
      ]
    },
    "facts": [
      [
        "예취 조수",
        "4조식 자탈형"
      ],
      [
        "호칭 마력",
        "73 PS"
      ],
      [
        "크기",
        "4,390 × 2,505 × 3,155 mm"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 트랙터/관리기 연결 불필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://ko.daedong.co.kr/product/25",
        "title": "대동 DXM73GF5 공식 제원",
        "note": "웹 제원표 일부 행 어긋남으로 중량·배기량 제외",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "중량·엔진 세부 제원(원문 표 오류로 재확인 필요)",
      "곡물탱크 용량"
    ]
  },
  {
    "id": "kubota-zr6130",
    "brand": "한국구보다",
    "model": "ZR6130",
    "machineType": "combine",
    "role": "standalone",
    "specs": {
      "rows": 6,
      "nominalPowerPs": 128,
      "grainTankL": 2000
    },
    "facts": [
      [
        "예취 조수",
        "6조식 대형 플래그십"
      ],
      [
        "마력",
        "약 128 PS"
      ],
      [
        "그레인탱크 용량",
        "2,000 L"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 트랙터/관리기 연결 불필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.kubotakorea.com/",
        "title": "한국구보다 ZR6130 콤바인 제원",
        "note": "제조사 공식 라인업 및 국내 공개 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "외형 치수",
      "기체 중량",
      "엔진 배기량"
    ]
  },
  {
    "id": "honda-wjr2525t",
    "brand": "혼다",
    "model": "WJR2525T",
    "machineType": "sprayer",
    "role": "standalone",
    "specs": {
      "chemicalTankL": 25,
      "dryWeightKg": 10,
      "displacementCc": 25,
      "flowLMin": 6.6
    },
    "facts": [
      [
        "형식",
        "배부식 동력분무기"
      ],
      [
        "약액 탱크",
        "25 L"
      ],
      [
        "건조 중량",
        "10 kg"
      ],
      [
        "배기량 / 토출량",
        "25 cc / 6.6 L/min"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 트랙터/관리기 연결 불필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://motos.honda.com.ec/producto-de-fuerza/fumigadora-de-mochila-wjr2525-1",
        "title": "혼다 WJR2525T 제원",
        "note": "해외 사양 기준",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "국내 유통 사양 차이",
      "노즐·호스 연결 규격"
    ]
  },
  {
    "id": "asia-d10",
    "brand": "아세아텍",
    "model": "D10",
    "machineType": "speedSprayer",
    "role": "standalone",
    "specs": {
      "chemicalTankL": 1000,
      "engineModel": "KUBOTA V1505T",
      "nominalPowerPs": 41.5,
      "engineRpm": 2600,
      "groundClearanceMm": 215
    },
    "facts": [
      [
        "약액 탱크",
        "1,000 L"
      ],
      [
        "엔진",
        "구보다 V1505T 터보 디젤 · 41.5 PS / 2,600 rpm"
      ],
      [
        "최저지상고",
        "215 mm (트랙터 타입 차축)"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 과수 방제용 자주식 SS기",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.asiakor.com/",
        "title": "아세아텍 D10 디젤 스피드스프레이어 제원",
        "note": "제조사 공식 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "외형 치수",
      "공차 중량",
      "분무 펌프 토출량"
    ]
  },
  {
    "id": "hansung-atom4-1000",
    "brand": "한성티앤아이",
    "model": "SS-ATOMⅣ-1000",
    "machineType": "speedSprayer",
    "role": "standalone",
    "specs": {
      "chemicalTankL": 1000,
      "engineModel": "현대 D4BB"
    },
    "facts": [
      [
        "약액 탱크",
        "1,000 L"
      ],
      [
        "엔진",
        "현대 D4BB 디젤"
      ],
      [
        "특징",
        "4륜 조향(4WS) · 밀폐형 냉난방 방제 캐빈"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 캐빈형 과수 방제 SS기",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.hstni.com/",
        "title": "한성티앤아이 SS-ATOMⅣ-1000 공식 제품 소개",
        "note": "제조사 공식 홈페이지",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "엔진 정격 마력(PS)",
      "외형 치수 및 중량",
      "분무 펌프 토출량"
    ]
  },
  {
    "id": "dji-agras-t50",
    "brand": "DJI (대동 공급)",
    "model": "Agras T50",
    "machineType": "agriDrone",
    "role": "standalone",
    "specs": {
      "chemicalTankL": 40,
      "granuleTankL": 75,
      "maxGranulePayloadKg": 50
    },
    "facts": [
      [
        "액체 방제 탱크",
        "40 L (최대 작동 페이로드 40 kg)"
      ],
      [
        "입제 살포 탱크",
        "75 L (최대 적재 하중 50 kg)"
      ],
      [
        "국내 공급",
        "대동 공식 파트너십 공급 및 A/S 망 연계"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 비행 · 무인항공방제 자격·비행승인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://ag.dji.com/kr/t50",
        "title": "DJI Agras T50 한국 공식 사양",
        "note": "대동 공식 공급 라인업 동일 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "배터리 1회 비행 시간 및 충전기 요구 전력",
      "살포 폭 세부 조건별 수치"
    ]
  },
  {
    "id": "dji-agras-t25",
    "brand": "DJI (대동 공급)",
    "model": "Agras T25",
    "machineType": "agriDrone",
    "role": "standalone",
    "specs": {
      "chemicalTankL": 20,
      "granuleTankL": 25
    },
    "facts": [
      [
        "액체 방제 탱크",
        "20 L"
      ],
      [
        "입제 살포 탱크",
        "25 L (최대 25 kg)"
      ],
      [
        "특징",
        "중·소규모 필지 및 1인 운용 최적화 콤팩트 기체"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 비행 · 무인항공방제 자격·비행승인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://ko.daedong.co.kr/",
        "title": "대동 공급 DJI T25 농업용 드론 안내",
        "note": "제조사·공급사 공식 발표 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "기체 중량",
      "1회 비행 살포 면적"
    ]
  },
  {
    "id": "asia-fs300d",
    "brand": "아세아텍",
    "model": "FS-300D",
    "machineType": "spreader",
    "role": "implement",
    "specs": {
      "hopperCapacityL": 120,
      "dimensionsMm": [
        1100,
        1100,
        980
      ],
      "weightKg": 60,
      "spreadingWidthMm": 16000
    },
    "facts": [
      [
        "구분",
        "승용관리기 부착형 비료살포기"
      ],
      [
        "탱크 용량",
        "120 L"
      ],
      [
        "크기 / 중량",
        "1,100 × 1,100 × 980 mm / 60 kg"
      ],
      [
        "살포폭",
        "약 16 m (배출구 8단 조절)"
      ]
    ],
    "connection": {
      "hostType": "ridingCultivator",
      "label": "아세아 승용관리기 전용 장착 (일반 트랙터와 별도 확인 필요)",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.asiakor.com/",
        "title": "아세아텍 FS-300D 비료살포기 제원",
        "note": "제조사 공식 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "호환 아세아 승용관리기 정확한 형식 목록",
      "PTO/전원 연결 규격"
    ]
  },
  {
    "id": "won-matador3",
    "brand": "원인터내셔널",
    "model": "MATADOR 3",
    "machineType": "spreader",
    "role": "implement",
    "specs": {
      "payloadKg": 3000,
      "dimensionsMm": [
        4885,
        2150,
        1850
      ],
      "weightKg": 2000,
      "publishedTractorPowerRange": {
        "min": 50,
        "max": null,
        "unit": "HP",
        "basis": "unspecified"
      }
    },
    "facts": [
      [
        "구분",
        "트랙터 견인형 수직형 퇴비살포기 (3톤급)"
      ],
      [
        "적재 용량",
        "3,000 kg (3톤)"
      ],
      [
        "크기 / 중량",
        "4,885 × 2,150 × 1,850 mm / 2,000 kg"
      ],
      [
        "권장 트랙터",
        "50 HP 이상 (시리즈 3~10톤)"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 견인(드로바)·PTO 구동 · 50HP 이상 및 브레이크/유압 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.wonitl.com/",
        "title": "원인터내셔널 MATADOR 3 퇴비살포기 제원",
        "note": "제조사 공식 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "PTO 입력 회전수(540/1000 rpm)",
      "외부 유압 포트 요구 수"
    ]
  },
  {
    "id": "ansung-2050qb",
    "brand": "안성공업",
    "model": "2050-QB",
    "machineType": "loader",
    "role": "implement",
    "specs": {
      "publishedTractorPowerRange": {
        "min": 40,
        "max": 55,
        "unit": "HP",
        "basis": "unspecified"
      },
      "maxLiftHeightMm": 2675,
      "groundLiftCapacityKgf": 1480
    },
    "facts": [
      [
        "적용 마력",
        "40 ~ 55 HP 트랙터"
      ],
      [
        "최대 상승 높이",
        "2,675 mm"
      ],
      [
        "지면 인양 하중",
        "1,480 kgf"
      ],
      [
        "버켓 용량",
        "평적 0.36 ㎥ / 산적 0.45 ㎥"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 전방 브라켓 전용 장착 · 트랙터 기종별 마운팅 브라켓 일치 필수",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.ansung.co.kr/",
        "title": "안성공업 2050-QB 프런트 로우더 제원",
        "note": "제조사 공식 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "기종별 전용 서브프레임 호환표",
      "로더 단품 중량"
    ]
  },
  {
    "id": "daedong-dl7000",
    "brand": "대동",
    "model": "DL7000",
    "machineType": "loader",
    "role": "implement",
    "specs": {
      "publishedTractorPowerRange": {
        "min": 63,
        "max": 73,
        "unit": "HP",
        "basis": "unspecified"
      },
      "maxLiftHeightMm": 3061,
      "maxLiftCapacityKg": 954
    },
    "facts": [
      [
        "적용 마력",
        "63 ~ 73 HP 대동 트랙터"
      ],
      [
        "최고 인양 높이",
        "3,061 mm"
      ],
      [
        "최대 인양 하중",
        "약 954 kg"
      ],
      [
        "버켓 용량",
        "0.45 ~ 0.53 ㎥ · 셀프 레벨링 탑재"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "대동 중형 트랙터(63~73HP급) 전용 로더 브라켓 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null,
      "approvedBrands": [
        "대동"
      ]
    },
    "sources": [
      {
        "url": "https://www.kamico.or.kr/",
        "title": "KAMICO 목록집 · 대동 DL7000 로더 제원",
        "note": "대동모빌리티 생산 정품 로더",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "대동 외 타사 트랙터 브라켓 호환 여부",
      "로더 중량"
    ]
  },
  {
    "id": "myungsung-rb1100df",
    "brand": "명성",
    "model": "RB1100DF",
    "machineType": "baler",
    "role": "implement",
    "specs": {
      "pickupWidthMm": 1830,
      "baleSizeCm": [
        110,
        100
      ],
      "publishedTractorPowerRange": {
        "min": 60,
        "max": null,
        "unit": "HP",
        "basis": "unspecified"
      }
    },
    "facts": [
      [
        "베일 크기",
        "직경 110 cm × 폭 100 cm (16개 스틸 롤러)"
      ],
      [
        "픽업 폭",
        "1,830 mm"
      ],
      [
        "적용 트랙터",
        "60 HP (약 44 kW) 이상"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 견인·PTO 구동 · 60HP 이상 및 외부 유압·PTO rpm 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.myungsung.co.kr/",
        "title": "명성 RB1100DF 중형 원형 베일러 제원",
        "note": "제조사 공식 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "기체 외형 치수 및 중량",
      "PTO 입력 회전수(540 rpm 여부)",
      "유압 밸브 요구 수"
    ]
  },
  {
    "id": "honda-umk435",
    "brand": "혼다",
    "model": "UMK435",
    "machineType": "mower",
    "role": "standalone",
    "specs": {
      "engineModel": "GX35",
      "displacementCc": 35.8,
      "ratedPowerKw": 1,
      "nominalPowerPs": 1.3
    },
    "facts": [
      [
        "엔진",
        "혼다 GX35 미니 4행정 가솔린 · 35.8 cc"
      ],
      [
        "출력",
        "약 1.0 kW (1.3 PS) / 7,000 rpm"
      ],
      [
        "중량",
        "약 7.5 ~ 8.6 kg (핸들 사양별 상이)"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 휴대/배부식 예초기",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.hondaoutdoors.co.nz/",
        "title": "혼다 UMK435 (GX35) 제원",
        "note": "국내 시판 4행정 예초기 대표 모델",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "국내 유통 세부 트림별 정확한 중량",
      "연료탱크 용량"
    ]
  },
  {
    "id": "orec-srm981",
    "brand": "오렉 (OREC)",
    "model": "SRM981",
    "machineType": "mower",
    "role": "standalone",
    "specs": {
      "nominalPowerPs": 22,
      "workingWidthMm": 980,
      "weightKg": 315,
      "dimensionsMm": [
        2000,
        1070,
        830
      ]
    },
    "facts": [
      [
        "마력",
        "22 PS (공냉식 2기통 가솔린)"
      ],
      [
        "제초폭",
        "980 mm"
      ],
      [
        "크기 / 중량",
        "약 2,000 × 1,070 × 830 mm / 약 315 kg"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 과수원용 승용제초기",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.dktools.co.kr/",
        "title": "오렉 SRM981 승용제초기 국내 판매 제원",
        "note": "국내 농기계임대사업소·과수농가 보급 모델",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "예초 높이 조절 단수",
      "구동 방식(2WD/4WD)"
    ]
  },
  {
    "id": "kumsung-gs460",
    "brand": "금성",
    "model": "GS-460",
    "machineType": "shredder",
    "role": "standalone",
    "specs": {
      "engineModel": "혼다 GX200",
      "nominalPowerPs": 6.5,
      "maxBranchDiameterMm": 30
    },
    "facts": [
      [
        "엔진",
        "혼다 GX200 가솔린 6.5 PS"
      ],
      [
        "최대 파쇄 직경",
        "약 30 mm (나뭇가지·고춧대·깻대)"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 엔진형 이동식 잔가지파쇄기",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.ikumsung.com/",
        "title": "금성 잔가지파쇄기 GS-460 제원",
        "note": "국내 임대사업소 보급형 파쇄기",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "외형 치수",
      "기체 중량",
      "시간당 처리량"
    ]
  },
  {
    "id": "kumsung-gs1500",
    "brand": "금성",
    "model": "GS-1500",
    "machineType": "thresher",
    "role": "standalone",
    "specs": {
      "motorPowerHp": 3,
      "dimensionsMm": [
        1230,
        980,
        970
      ],
      "weightKg": 150
    },
    "facts": [
      [
        "동력",
        "전기모터 3마력"
      ],
      [
        "크기 / 중량",
        "1,230 × 980 × 970 mm / 약 150 kg"
      ],
      [
        "구조",
        "풍구·정선기 일체형 콩탈곡기"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 단상/삼상 전원 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.ikumsung.com/",
        "title": "금성 GS-1500 콩탈곡기 제원",
        "note": "제조사 공식 라인업 및 국내 유통 제원",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "정격 전압(220V/380V)",
      "시간당 탈곡 능력(kg/h)"
    ]
  },
  {
    "id": "daedong-mechron2450",
    "brand": "대동",
    "model": "Mechron2450",
    "machineType": "carrier",
    "role": "standalone",
    "specs": {
      "maxPowerKw": 18,
      "engineRpm": 3200,
      "displacementCc": 1007,
      "dimensionsMm": [
        3045,
        1640,
        1990
      ],
      "weightKg": 1050
    },
    "facts": [
      [
        "최대 출력",
        "18 kW / 3,200 rpm"
      ],
      [
        "디젤 엔진 배기량",
        "1,007 cc"
      ],
      [
        "크기",
        "3,045 × 1,640 × 1,990 mm"
      ],
      [
        "중량",
        "1,050 kg"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 다목적 농업용 운반차",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://ko.daedong.co.kr/product/36",
        "title": "대동 Mechron2450 공식 제원",
        "note": "제조사 공식 제품 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "세부 옵션별 적재 한도"
    ]
  },
  {
    "id": "daedong-cs2520",
    "brand": "대동",
    "model": "CS2520",
    "machineType": "tractor",
    "role": "powerUnit",
    "specs": {
      "nominalPowerPs": 24.5
    },
    "facts": [
      [
        "호칭 마력",
        "24.5 PS (서브 콤팩트)"
      ],
      [
        "변속기",
        "유압식 무단변속 (HST)"
      ],
      [
        "주 용도",
        "소규모 농장, 하우스 및 과수원 관리"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 · 세부 히치 카테고리(Cat I 예상) 및 PTO 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://ko.daedong.co.kr/",
        "title": "대동 CS2520 서브 콤팩트 트랙터",
        "note": "대동 공식 라인업 24.5마력 HST 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "엔진 배기량",
      "기체 치수 및 중량",
      "3점 히치 카테고리 및 양력",
      "PTO 회전수"
    ]
  },
  {
    "id": "daedong-ck3530",
    "brand": "대동",
    "model": "CK3530",
    "machineType": "tractor",
    "role": "powerUnit",
    "specs": {
      "nominalPowerPs": 35
    },
    "facts": [
      [
        "호칭 마력",
        "35 PS"
      ],
      [
        "체급",
        "소형 콤팩트 유틸리티 트랙터 (CK 시리즈)"
      ],
      [
        "주 용도",
        "비닐하우스, 과수원 및 소규모 밭작물 작업"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 · 세부 히치 카테고리 및 PTO 회전수 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://ko.daedong.co.kr/",
        "title": "대동 CK3530 소형 트랙터",
        "note": "대동 35마력급 CK 시리즈 라인업",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "엔진 배기량",
      "기체 치수 및 중량",
      "3점 히치 카테고리 및 양력",
      "PTO 회전수"
    ]
  },
  {
    "id": "daedong-rx630",
    "brand": "대동",
    "model": "RX630",
    "machineType": "tractor",
    "role": "powerUnit",
    "specs": {
      "nominalPowerPs": 63
    },
    "facts": [
      [
        "호칭 마력",
        "63 PS"
      ],
      [
        "변속/편의",
        "파워셔틀, 실시간 연비 모니터5(Monitor 5) 탑재"
      ],
      [
        "주 용도",
        "수도작 및 밭작물 복합 영농 중형 주력기"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 · 세부 히치 카테고리(Cat II 예상) 및 PTO 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://ko.daedong.co.kr/",
        "title": "대동 RX630 중형 트랙터",
        "note": "대동 공식 RX 시리즈 63마력 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "엔진 배기량",
      "기체 치수 및 중량",
      "3점 히치 양력",
      "PTO 회전수"
    ]
  },
  {
    "id": "daedong-rx730",
    "brand": "대동",
    "model": "RX730",
    "machineType": "tractor",
    "role": "powerUnit",
    "specs": {
      "nominalPowerPs": 74,
      "displacementCc": 2435,
      "dimensionsMm": [
        3715,
        1960,
        null
      ],
      "weightKg": 2795
    },
    "facts": [
      [
        "호칭 마력",
        "74 PS (4기통 대동 디젤 엔진)"
      ],
      [
        "배기량",
        "2,435 cc"
      ],
      [
        "전장 × 전폭",
        "3,715 × 1,960 mm"
      ],
      [
        "중량 (캐빈 포함)",
        "약 2,795 kg"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 · 세부 히치 카테고리(Cat II 예상) 및 PTO 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://ko.daedong.co.kr/",
        "title": "대동 RX730 중형 트랙터 공식 제원",
        "note": "배기량 2,435cc, 전장 3,715mm, 캐빈 중량 2,795kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "전고",
      "3점 히치 카테고리 및 양력",
      "PTO 회전수 및 스플라인"
    ]
  },
  {
    "id": "daedong-hx1000",
    "brand": "대동",
    "model": "HX1000",
    "machineType": "tractor",
    "role": "powerUnit",
    "specs": {
      "nominalPowerPs": 111,
      "displacementCc": 3833,
      "dimensionsMm": [
        4398,
        2253,
        null
      ],
      "weightKg": 4530
    },
    "facts": [
      [
        "호칭 마력",
        "111 PS"
      ],
      [
        "배기량",
        "3,833 cc (대동 자체 3.8L 디젤 엔진)"
      ],
      [
        "전장 × 전폭",
        "약 4,398 × 2,253 mm"
      ],
      [
        "기체 중량",
        "약 4,530 kg (사양별 상이)"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 · 대형 Cat II 예상, 세부 규격 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://ko.daedong.co.kr/",
        "title": "대동 HX1000 대형 트랙터 공식 제원",
        "note": "3,833cc 엔진, 111마력 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "전고",
      "3점 히치 카테고리 및 양력",
      "PTO 회전수 및 스플라인"
    ]
  },
  {
    "id": "daedong-px1300",
    "brand": "대동",
    "model": "PX1300",
    "machineType": "tractor",
    "role": "powerUnit",
    "specs": {
      "nominalPowerPs": 125,
      "threePointLiftKgf": 3600
    },
    "facts": [
      [
        "호칭 마력",
        "125 PS"
      ],
      [
        "3점 히치 양력",
        "3,600 kgf"
      ],
      [
        "특징",
        "전·후방 동시 작업 유압 펌프, 7인치 터치스크린"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 · 양력 3,600 kgf (대형 Cat II 예상, 세부 규격 확인 필요)",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://ko.daedong.co.kr/",
        "title": "대동 PX1300 대형 트랙터 공식 제원",
        "note": "125마력, 후방 승강력 3,600kgf",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "엔진 배기량",
      "기체 치수 및 중량",
      "3점 히치 카테고리",
      "PTO 회전수"
    ]
  },
  {
    "id": "tym-k48",
    "brand": "TYM",
    "model": "K48",
    "machineType": "tractor",
    "role": "powerUnit",
    "specs": {
      "nominalPowerPs": 48,
      "enginePowerKw": 35.5,
      "engineRpm": 2600,
      "weightKg": 1580
    },
    "facts": [
      [
        "호칭 마력",
        "48 PS (35.5 kW / 2,600 rpm)"
      ],
      [
        "엔진",
        "TYM 4기통 디젤 엔진 (요소수 미적용)"
      ],
      [
        "변속 단수",
        "전진 12단 × 후진 12단 (싱크로셔틀)"
      ],
      [
        "중량",
        "1,580 kg (ROPS) / 1,810 kg (캐빈)"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 · 세부 히치 카테고리 및 PTO 회전수 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://tym.world/",
        "title": "TYM K48 공식 제품 제원",
        "note": "48PS, ROPS 1,580kg / 캐빈 1,810kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "엔진 배기량",
      "기체 치수",
      "3점 히치 카테고리 및 양력",
      "PTO 회전수"
    ]
  },
  {
    "id": "tym-k58",
    "brand": "TYM",
    "model": "K58",
    "machineType": "tractor",
    "role": "powerUnit",
    "specs": {
      "nominalPowerPs": 58
    },
    "facts": [
      [
        "호칭 마력",
        "58 PS"
      ],
      [
        "엔진",
        "4기통 터보 디젤 엔진"
      ],
      [
        "주 용도",
        "하우스·과수원 및 중소규모 논·밭 겸용"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 · 세부 히치 카테고리 및 PTO 회전수 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://tym.world/",
        "title": "TYM K58 공식 제품 라인업",
        "note": "58마력 4기통 터보 디젤 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "엔진 배기량",
      "기체 치수 및 중량",
      "3점 히치 카테고리 및 양력",
      "PTO 회전수"
    ]
  },
  {
    "id": "tym-t58",
    "brand": "TYM",
    "model": "T58",
    "machineType": "tractor",
    "role": "powerUnit",
    "specs": {
      "nominalPowerPs": 58,
      "displacementCc": 2287,
      "engineRpm": 2600,
      "weightKg": 1950
    },
    "facts": [
      [
        "호칭 마력",
        "55~58 PS (2,600 rpm)"
      ],
      [
        "배기량",
        "약 2,287 cc (4기통 디젤 터보)"
      ],
      [
        "변속 단수",
        "전진 8단 × 후진 8단 (싱크로셔틀)"
      ],
      [
        "중량 (캐빈)",
        "약 1,950~1,980 kg"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 · 세부 히치 카테고리 및 PTO 회전수 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://tym.world/",
        "title": "TYM T58 공식 제품 제원",
        "note": "4기통 2,287cc, 캐빈 중량 약 1,950~1,980kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "기체 치수",
      "3점 히치 카테고리 및 양력",
      "PTO 회전수 및 스플라인"
    ]
  },
  {
    "id": "tym-t68",
    "brand": "TYM",
    "model": "T68",
    "machineType": "tractor",
    "role": "powerUnit",
    "specs": {
      "nominalPowerPs": 68,
      "enginePowerKw": 50,
      "displacementCc": 2925,
      "engineRpm": 2200,
      "weightKg": 2615
    },
    "facts": [
      [
        "호칭 마력",
        "68 PS (50 kW / 2,200 rpm)"
      ],
      [
        "배기량",
        "2,925 cc (독일 도이츠 CRDI 터보)"
      ],
      [
        "변속 단수",
        "전진 24단 × 후진 24단 (파워셔틀)"
      ],
      [
        "중량 (캐빈)",
        "약 2,615 kg"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 · 세부 히치 카테고리 및 PTO 회전수 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://tym.world/",
        "title": "TYM T68 공식 제품 제원",
        "note": "도이츠 2,925cc 68PS, 중량 2,615kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "기체 치수",
      "3점 히치 카테고리 및 양력",
      "PTO 회전수 및 스플라인"
    ]
  },
  {
    "id": "tym-t76",
    "brand": "TYM",
    "model": "T76",
    "machineType": "tractor",
    "role": "powerUnit",
    "specs": {
      "nominalPowerPs": 75,
      "threePointLiftKgf": 2338
    },
    "facts": [
      [
        "호칭 마력",
        "75 PS (도이츠 TCD L4 터보 CRDI)"
      ],
      [
        "변속 단수",
        "파워셔틀 전진 16단 × 후진 16단"
      ],
      [
        "3점 히치 양력",
        "약 2,338 kgf"
      ],
      [
        "특징",
        "BOSCH 전자식 유압 제어, 텔레매틱스(MYTYM) 지원"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 · 양력 2,338 kgf, 세부 히치·PTO 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://tym.world/",
        "title": "TYM T76 (시리즈 5) 공식 제품 제원",
        "note": "75PS 도이츠 엔진, 양력 2,338kgf",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "엔진 배기량",
      "기체 치수 및 중량",
      "3점 히치 카테고리",
      "PTO 회전수"
    ]
  },
  {
    "id": "tym-t115",
    "brand": "TYM",
    "model": "T115",
    "machineType": "tractor",
    "role": "powerUnit",
    "specs": {
      "nominalPowerPs": 113,
      "enginePowerKw": 83,
      "engineRpm": 2200,
      "dimensionsMm": [
        4450,
        2270,
        2850
      ],
      "weightKg": 4055,
      "fuelTankL": 120
    },
    "facts": [
      [
        "호칭 마력",
        "113 PS (83 kW / 2,200 rpm, 도이츠 TCD 3.6 L4)"
      ],
      [
        "변속 단수",
        "파워셔틀 전진 32단 × 후진 32단"
      ],
      [
        "크기",
        "4,450 × 2,270 × 2,850 mm"
      ],
      [
        "중량 / 연료탱크",
        "4,055 kg / 120 L"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 · 대형 Cat II 예상, 세부 규격 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://tym.world/",
        "title": "TYM T115 공식 제품 제원",
        "note": "113PS, 4,450×2,270×2,850mm, 4,055kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "엔진 배기량 상세",
      "3점 히치 카테고리 및 양력",
      "PTO 회전수 및 스플라인"
    ]
  },
  {
    "id": "tym-t130",
    "brand": "TYM",
    "model": "T130",
    "machineType": "tractor",
    "role": "powerUnit",
    "specs": {
      "nominalPowerPs": 129
    },
    "facts": [
      [
        "호칭 마력",
        "129 PS (고출력 도이츠 엔진)"
      ],
      [
        "특징",
        "ICT 자율주행·텔레매틱스 연동, BOSCH 전자 유압 컨트롤"
      ],
      [
        "주 용도",
        "대규모 수도작 및 대형 축산 복합 영농"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 · 대형 Cat II 예상, 세부 규격 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://tym.world/",
        "title": "TYM T130 플래그십 트랙터 공식 정보",
        "note": "129PS 도이츠 엔진, ICT 자율주행",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "엔진 배기량",
      "기체 치수 및 중량",
      "3점 히치 카테고리 및 양력",
      "PTO 회전수"
    ]
  },
  {
    "id": "ls-mt2-25",
    "brand": "LS엠트론",
    "model": "MT2.25",
    "machineType": "tractor",
    "role": "powerUnit",
    "specs": {
      "nominalPowerPs": 25,
      "displacementCc": 1267,
      "dimensionsMm": [
        2850,
        1360,
        null
      ],
      "weightKg": 895
    },
    "facts": [
      [
        "호칭 마력",
        "25 PS (얀마 디젤 엔진)"
      ],
      [
        "배기량",
        "1,267 cc"
      ],
      [
        "전장 × 전폭",
        "2,850 × 1,360 mm (전방 웨이트 미포함)"
      ],
      [
        "중량",
        "약 895 kg"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 · 소형 Cat I 예상, 세부 규격 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.lstractor.com/",
        "title": "LS엠트론 MT2.25 공식 제품 제원",
        "note": "25PS, 1,267cc, 895kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "전고",
      "3점 히치 카테고리 및 양력",
      "PTO 회전수 및 스플라인"
    ]
  },
  {
    "id": "ls-mt4-68",
    "brand": "LS엠트론",
    "model": "MT4.68",
    "machineType": "tractor",
    "role": "powerUnit",
    "specs": {
      "nominalPowerPs": 68,
      "displacementCc": 2508,
      "dimensionsMm": [
        3770,
        1907,
        null
      ],
      "weightKg": 2735
    },
    "facts": [
      [
        "호칭 마력",
        "68 PS (3기통 수냉식 디젤)"
      ],
      [
        "배기량",
        "2,508 cc"
      ],
      [
        "크기",
        "전장 3,770 mm × 전폭 1,775~1,907 mm (가변형 뒤차축)"
      ],
      [
        "중량",
        "약 2,735 kg"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 · 세부 히치 카테고리 및 PTO 회전수 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.lstractor.com/",
        "title": "LS엠트론 MT4.68 공식 제품 제원",
        "note": "68PS, 2,508cc, 가변형 뒤차축, 2,735kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "전고",
      "3점 히치 카테고리 및 양력",
      "PTO 회전수 및 스플라인"
    ]
  },
  {
    "id": "ls-xp102",
    "brand": "LS엠트론",
    "model": "XP102",
    "machineType": "tractor",
    "role": "powerUnit",
    "specs": {
      "nominalPowerPs": 102,
      "displacementCc": 3387,
      "dimensionsMm": [
        4045,
        1980,
        null
      ],
      "weightKg": 4120
    },
    "facts": [
      [
        "호칭 마력",
        "102 PS (FPT 친환경 엔진)"
      ],
      [
        "배기량",
        "3,387 cc"
      ],
      [
        "전장 × 전폭",
        "4,045 × 1,980 mm"
      ],
      [
        "중량",
        "약 4,120 kg"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 · 대형 Cat II 예상, 세부 규격 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.lstractor.com/",
        "title": "LS엠트론 XP102 공식 제품 제원",
        "note": "102PS, 3,387cc, 4,120kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "전고",
      "3점 히치 카테고리 및 양력",
      "PTO 회전수 및 스플라인"
    ]
  },
  {
    "id": "ls-mt7-115",
    "brand": "LS엠트론",
    "model": "MT7.115",
    "machineType": "tractor",
    "role": "powerUnit",
    "specs": {
      "nominalPowerPs": 115,
      "displacementCc": 3595,
      "dimensionsMm": [
        4045,
        1980,
        null
      ],
      "weightKg": 3665
    },
    "facts": [
      [
        "호칭 마력",
        "115~117 PS (이탈리아 FPT CRDI 엔진)"
      ],
      [
        "배기량",
        "3,595 cc"
      ],
      [
        "전장 × 전폭",
        "4,045 × 1,980 mm"
      ],
      [
        "중량",
        "약 3,665 kg (부가중량 미포함)"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 · 대형 Cat II 예상, 세부 규격 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.lstractor.com/",
        "title": "LS엠트론 MT7.115 공식 제품 제원",
        "note": "115PS, 3,595cc, 3,665kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "전고",
      "3점 히치 카테고리 및 양력",
      "PTO 회전수 및 스플라인"
    ]
  },
  {
    "id": "kubota-l45k",
    "brand": "한국구보다",
    "model": "L45K",
    "machineType": "tractor",
    "role": "powerUnit",
    "specs": {
      "nominalPowerPs": 47.5,
      "enginePowerKw": 34.9,
      "displacementCc": 2434,
      "weightKg": 1770
    },
    "facts": [
      [
        "호칭 마력",
        "47.5 PS (34.9 kW)"
      ],
      [
        "배기량",
        "2,434 cc (4기통 디젤)"
      ],
      [
        "중량 (ROPS)",
        "약 1,770 kg"
      ],
      [
        "주 용도",
        "과수원, 하우스 및 소규모 논농사"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 · 세부 히치 카테고리(Cat I 예상) 및 PTO 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.kubotakorea.com/",
        "title": "한국구보다 L45K 공식 제원",
        "note": "47.5PS, 2,434cc, 1,770kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "기체 치수",
      "3점 히치 카테고리 및 양력",
      "PTO 회전수"
    ]
  },
  {
    "id": "kubota-l54h",
    "brand": "한국구보다",
    "model": "L54H",
    "machineType": "tractor",
    "role": "powerUnit",
    "specs": {
      "nominalPowerPs": 55.9,
      "displacementCc": 2434,
      "weightKg": 1840
    },
    "facts": [
      [
        "호칭 마력",
        "55.9 PS (약 56마력급)"
      ],
      [
        "배기량",
        "2,434 cc (4기통 디젤)"
      ],
      [
        "중량",
        "약 1,840 kg"
      ],
      [
        "특징",
        "실속형 수동(기계식) 미션 채택"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 · 세부 히치 카테고리 및 PTO 회전수 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.kubotakorea.com/",
        "title": "한국구보다 L54H 공식 제원",
        "note": "55.9PS, 2,434cc, 1,840kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "기체 치수",
      "3점 히치 카테고리 및 양력",
      "PTO 회전수"
    ]
  },
  {
    "id": "kubota-l60k",
    "brand": "한국구보다",
    "model": "L60K",
    "machineType": "tractor",
    "role": "powerUnit",
    "specs": {
      "nominalPowerPs": 62.1,
      "enginePowerKw": 45.7,
      "displacementCc": 2434,
      "weightKg": 1840
    },
    "facts": [
      [
        "호칭 마력",
        "62.1 PS (45.7 kW)"
      ],
      [
        "배기량",
        "2,434 cc (4기통 디젤)"
      ],
      [
        "중량",
        "약 1,840 kg"
      ],
      [
        "특징",
        "듀얼 드라이브 트랜스미션 및 자동화 편의기능"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 · 세부 히치 카테고리 및 PTO 회전수 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.kubotakorea.com/",
        "title": "한국구보다 L60K 공식 제원",
        "note": "62.1PS, 2,434cc, 1,840kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "기체 치수",
      "3점 히치 카테고리 및 양력",
      "PTO 회전수"
    ]
  },
  {
    "id": "kubota-m7060",
    "brand": "한국구보다",
    "model": "M7060",
    "machineType": "tractor",
    "role": "powerUnit",
    "specs": {
      "nominalPowerPs": 74,
      "displacementCc": 3331,
      "weightKg": 2820
    },
    "facts": [
      [
        "호칭 마력",
        "74 PS (V3307 커먼레일 디젤)"
      ],
      [
        "배기량",
        "3,331 cc"
      ],
      [
        "중량 (캐빈)",
        "약 2,820~2,900 kg"
      ],
      [
        "주 용도",
        "수도작·밭작물 복합 및 축산 베일러 작업"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 · 세부 히치 카테고리 및 PTO 회전수 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.kubotakorea.com/",
        "title": "한국구보다 M7060 공식 제원",
        "note": "74PS, 3,331cc, 2,820~2,900kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "기체 치수",
      "3점 히치 카테고리 및 양력",
      "PTO 회전수"
    ]
  },
  {
    "id": "kubota-m9540",
    "brand": "한국구보다",
    "model": "M9540",
    "machineType": "tractor",
    "role": "powerUnit",
    "specs": {
      "nominalPowerPs": 95,
      "displacementCc": 3769,
      "weightKg": 3020
    },
    "facts": [
      [
        "호칭 마력",
        "95~99 PS (V3800DI-T 4기통 터보 디젤)"
      ],
      [
        "배기량",
        "3,769 cc"
      ],
      [
        "중량",
        "약 3,020 kg (기본 캐빈 사양)"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 · 대형 Cat II 예상, 세부 규격 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.kubotakorea.com/",
        "title": "한국구보다 M9540 공식 제원",
        "note": "95PS, 3,769cc, 3,020kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "기체 치수",
      "3점 히치 카테고리 및 양력",
      "PTO 회전수"
    ]
  },
  {
    "id": "yanmar-yt357",
    "brand": "얀마",
    "model": "YT357",
    "machineType": "tractor",
    "role": "powerUnit",
    "specs": {
      "nominalPowerPs": 57,
      "displacementCc": 3319,
      "dimensionsMm": [
        3380,
        1560,
        2620
      ],
      "weightKg": 2010
    },
    "facts": [
      [
        "호칭 마력",
        "57.0 PS (EU Stage-V 3기통 커먼레일)"
      ],
      [
        "배기량",
        "3,319 cc"
      ],
      [
        "크기 (YT357-M)",
        "3,380 × 1,560 × 2,620 mm"
      ],
      [
        "중량",
        "2,010 kg (YT357-M) / 2,135 kg (YT357-C 캐빈)"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 · 세부 히치 카테고리 및 PTO 회전수 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.yanmar.com/kr/",
        "title": "얀마 YT357 공식 제품 제원",
        "note": "57PS, 3,319cc, I-HMT/기계식 선택",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "3점 히치 카테고리 및 양력",
      "PTO 회전수 및 스플라인"
    ]
  },
  {
    "id": "yanmar-yt5113",
    "brand": "얀마",
    "model": "YT5113",
    "machineType": "tractor",
    "role": "powerUnit",
    "specs": {
      "nominalPowerPs": 113,
      "dimensionsMm": [
        4250,
        1990,
        2915
      ],
      "weightKg": 3940
    },
    "facts": [
      [
        "호칭 마력",
        "113 PS (PTO 최대출력 약 67 kW, I-HMT 무단변속)"
      ],
      [
        "크기",
        "4,250 × 1,990 × 2,915 mm"
      ],
      [
        "중량",
        "약 3,940 kg"
      ],
      [
        "특징",
        "RTK GPS 자동 직진보조(7cm 이하 오차) 모델 지원"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 · 대형 Cat II 예상, 세부 규격 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.yanmar.com/kr/",
        "title": "얀마 YT5113 공식 제품 제원",
        "note": "113PS, 4,250×1,990×2,915mm, 3,940kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "엔진 배기량",
      "3점 히치 카테고리 및 양력",
      "PTO 회전수 및 스플라인"
    ]
  },
  {
    "id": "asia-amc880",
    "brand": "아세아텍",
    "model": "AMC-880",
    "machineType": "cultivator",
    "role": "powerUnit",
    "specs": {
      "nominalPowerPs": 6.5,
      "displacementCc": 334,
      "weightKg": 102
    },
    "facts": [
      [
        "출력",
        "6.5 PS (공냉 4사이클 직립 단기통 가솔린)"
      ],
      [
        "배기량",
        "334 cc"
      ],
      [
        "기체 중량",
        "약 102 kg (본체 기준)"
      ],
      [
        "특징",
        "정회전 8단 · 역회전 4단 변속, 핸들 좌우 16단 회전"
      ]
    ],
    "connection": {
      "hostType": "cultivator",
      "label": "아세아 관리기 전용 히치핀 방식",
      "family": "asia-900",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.asiakor.com/",
        "title": "아세아텍 AMC-880 공식 제원",
        "note": "334cc, 6.5PS, 본체 102kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "히치핀 직경",
      "PTO 회전수 및 스플라인"
    ]
  },
  {
    "id": "asia-amc900sm",
    "brand": "아세아텍",
    "model": "AMC-900SM",
    "machineType": "cultivator",
    "role": "powerUnit",
    "specs": {
      "nominalPowerPs": 6.5,
      "ratedPowerKw": 4.8,
      "maxPowerKw": 5.8,
      "displacementCc": 296,
      "weightKg": 162
    },
    "facts": [
      [
        "출력",
        "6.5 PS급 (정격 4.8 kW / 최대 5.8 kW)"
      ],
      [
        "배기량",
        "296 cc (공냉 4사이클 OHV 가솔린)"
      ],
      [
        "기체 중량",
        "약 162 kg (로타리 포함 건조중량)"
      ]
    ],
    "connection": {
      "hostType": "cultivator",
      "label": "아세아 관리기 전용 히치핀 방식",
      "family": "asia-900",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.asiakor.com/",
        "title": "아세아텍 AMC-900SM 공식 제원",
        "note": "296cc, 정격 4.8kW/최대 5.8kW, 162kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "히치핀 직경",
      "PTO 회전수 상세"
    ]
  },
  {
    "id": "asia-amc850",
    "brand": "아세아텍",
    "model": "AMC-850",
    "machineType": "cultivator",
    "role": "powerUnit",
    "specs": {
      "nominalPowerPs": 6,
      "weightKg": 145
    },
    "facts": [
      [
        "출력",
        "약 6.0~6.5 PS급 (공냉 4사이클 가솔린 OHV)"
      ],
      [
        "기체 중량",
        "약 140~150 kg (로타리 포함)"
      ],
      [
        "특징",
        "구형/준주력 다목적 밭작업 보급형 관리기"
      ]
    ],
    "connection": {
      "hostType": "cultivator",
      "label": "아세아 관리기 전용 히치핀 방식",
      "family": "asia-900",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.asiakor.com/",
        "title": "아세아텍 AMC-850 보행관리기 사양",
        "note": "아세아텍 보급형 관리기 제원",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "정확한 배기량",
      "히치핀 직경",
      "PTO 회전수"
    ]
  },
  {
    "id": "daedong-frt80",
    "brand": "대동",
    "model": "FRT80",
    "machineType": "cultivator",
    "role": "powerUnit",
    "specs": {
      "nominalPowerPs": 6.5,
      "weightKg": 155
    },
    "facts": [
      [
        "출력",
        "약 6.5~7.5 PS급 가솔린 엔진"
      ],
      [
        "기체 중량",
        "약 155 kg (로타리 및 본기 포함)"
      ]
    ],
    "connection": {
      "hostType": "cultivator",
      "label": "대동 관리기 전용 히치핀 방식 · 규격 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://ko.daedong.co.kr/",
        "title": "대동 FRT80 다목적 관리기",
        "note": "대동 보행형 관리기 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "엔진 배기량",
      "히치핀 직경",
      "PTO 회전수"
    ]
  },
  {
    "id": "kukje-kmc750s",
    "brand": "국제",
    "model": "KMC-750S",
    "machineType": "cultivator",
    "role": "powerUnit",
    "specs": {
      "nominalPowerPs": 7,
      "displacementCc": 267,
      "weightKg": 98
    },
    "facts": [
      [
        "출력",
        "약 5.5~7.0 PS급 (공냉 4사이클 가솔린)"
      ],
      [
        "배기량",
        "267 cc"
      ],
      [
        "기체 중량",
        "98 kg"
      ]
    ],
    "connection": {
      "hostType": "cultivator",
      "label": "국제 KMC 관리기 히치핀 방식 · 규격 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.agriis.co.kr/",
        "title": "국제 KMC-750S 다목적 관리기 제원",
        "note": "267cc, 중량 98kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "히치핀 직경",
      "PTO 회전수"
    ]
  },
  {
    "id": "kukje-kmc900s",
    "brand": "국제",
    "model": "KMC-900S",
    "machineType": "cultivator",
    "role": "powerUnit",
    "specs": {
      "nominalPowerPs": 8,
      "displacementCc": 251,
      "weightKg": 100
    },
    "facts": [
      [
        "출력",
        "약 8.0 PS급 (1,800~2,000 rpm, EH25-2B 엔진 등)"
      ],
      [
        "배기량",
        "251 cc"
      ],
      [
        "기체 중량",
        "약 100 kg 내외"
      ]
    ],
    "connection": {
      "hostType": "cultivator",
      "label": "국제 KMC 관리기 히치핀 방식 · 규격 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.agriis.co.kr/",
        "title": "국제 KMC-900S 다목적 관리기 제원",
        "note": "251cc, 8.0PS, 약 100kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "히치핀 직경",
      "PTO 회전수"
    ]
  },
  {
    "id": "honda-ff300",
    "brand": "혼다",
    "model": "FF300",
    "machineType": "cultivator",
    "role": "powerUnit",
    "specs": {
      "engineModel": "GX80",
      "nominalPowerPs": 2,
      "ratedPowerKw": 1.5,
      "displacementCc": 79.7,
      "weightKg": 37
    },
    "facts": [
      [
        "엔진",
        "혼다 GX80 (공냉 4행정 단기통 OHV)"
      ],
      [
        "배기량 / 출력",
        "79.7 cc · 2.0 PS (1.5 kW / 3,600 rpm)"
      ],
      [
        "기체 중량",
        "약 37 kg (초경량 소형 텃밭·하우스용)"
      ]
    ],
    "connection": {
      "hostType": "cultivator",
      "label": "혼다 동축/전용 로터리 방식 · 일반 관리기 작업기 호환 불가",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.hondaplus.co.kr/",
        "title": "혼다 FF300 미니 관리기 공식 제원",
        "note": "79.7cc, 1.5kW, 37kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "작업기 연결 세부 치수"
    ]
  },
  {
    "id": "honda-f501",
    "brand": "혼다",
    "model": "F501",
    "machineType": "cultivator",
    "role": "powerUnit",
    "specs": {
      "engineModel": "GX160",
      "nominalPowerPs": 5,
      "displacementCc": 163,
      "weightKg": 52
    },
    "facts": [
      [
        "엔진",
        "혼다 GX160 (4행정 가솔린)"
      ],
      [
        "배기량 / 출력",
        "163 cc · 약 4.8~5.5 PS급"
      ],
      [
        "기체 중량",
        "약 50~53 kg"
      ]
    ],
    "connection": {
      "hostType": "cultivator",
      "label": "혼다 전용 히치 방식 · 세부 규격 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.hondaplus.co.kr/",
        "title": "혼다 F501 중형 관리기 제원",
        "note": "GX160 163cc, 약 50~53kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "정확한 히치핀 직경",
      "PTO 회전수"
    ]
  },
  {
    "id": "asia-cfm2000",
    "brand": "아세아텍",
    "model": "CFM-2000",
    "machineType": "ridingCultivator",
    "role": "powerUnit",
    "specs": {
      "engineModel": "Kubota D902-E4B",
      "nominalPowerPs": 20,
      "enginePowerKw": 14.5,
      "engineRpm": 3000,
      "displacementCc": 898,
      "dimensionsMm": [
        3190,
        1560,
        2470
      ],
      "groundClearanceMm": 615,
      "weightKg": 1170,
      "threePointLiftKgf": 300,
      "fuelTankL": 28,
      "rearHydraulicPorts": 2
    },
    "facts": [
      [
        "엔진",
        "구보다 D902-E4B 디젤 (898 cc)"
      ],
      [
        "출력",
        "20 PS (14.5 kW / 3,000 rpm)"
      ],
      [
        "크기 / 최저지상고",
        "3,190 × 1,560 × 2,470 mm / 615 mm"
      ],
      [
        "중량 / 양력",
        "1,170 kg / 3점 링크 300 kgf"
      ]
    ],
    "connection": {
      "hostType": "ridingCultivator",
      "label": "3점 링크(양력 300 kgf) 및 후방 유압 2포트 · 세부 PTO 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.asiakor.com/",
        "title": "아세아텍 CFM-2000 디젤 승용관리기 공식 제원",
        "note": "20PS, 1,170kg, 최저지상고 615mm",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "3점 링크 카테고리(Cat 0/I 여부)",
      "PTO 회전수 및 스플라인"
    ]
  },
  {
    "id": "asia-cfm2000w",
    "brand": "아세아텍",
    "model": "CFM-2000W",
    "machineType": "ridingCultivator",
    "role": "powerUnit",
    "specs": {
      "engineModel": "Kubota D902-E4B",
      "nominalPowerPs": 20,
      "enginePowerKw": 14.5,
      "displacementCc": 898,
      "groundClearanceMm": 770,
      "weightKg": 1190,
      "fuelTankL": 28
    },
    "facts": [
      [
        "엔진 / 출력",
        "구보다 D902-E4B · 20 PS (14.5 kW)"
      ],
      [
        "최저지상고",
        "770 mm (광폭·고지상고 W형)"
      ],
      [
        "기체 중량",
        "1,190 kg"
      ]
    ],
    "connection": {
      "hostType": "ridingCultivator",
      "label": "3점 링크 및 후방 유압 포트 · 세부 PTO 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.asiakor.com/",
        "title": "아세아텍 CFM-2000W 공식 제원",
        "note": "고지상고 770mm, 1,190kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "세부 전폭 범위",
      "PTO 회전수 및 스플라인"
    ]
  },
  {
    "id": "tym-k1hc",
    "brand": "TYM",
    "model": "K1-HC",
    "machineType": "ridingCultivator",
    "role": "powerUnit",
    "specs": {
      "nominalPowerPs": 19,
      "ptoRpm": [
        550,
        788
      ]
    },
    "facts": [
      [
        "출력",
        "19 PS급 디젤 엔진"
      ],
      [
        "변속 단수",
        "전진 6단 · 후진 2단"
      ],
      [
        "PTO 회전수",
        "2단 (550 / 788 rpm, 작업기 상승 시 자동 정지)"
      ],
      [
        "유압/링크",
        "3점 링크 및 외부 유압 포트 탑재"
      ]
    ],
    "connection": {
      "hostType": "ridingCultivator",
      "label": "3점 링크 + PTO (550 / 788 rpm)",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": [
        550,
        788
      ]
    },
    "sources": [
      {
        "url": "https://tym.world/",
        "title": "TYM(국제) K1-HC 승용관리기 제원",
        "note": "19PS 디젤, PTO 550/788rpm",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "엔진 배기량",
      "기체 치수 및 중량",
      "3점 링크 카테고리"
    ]
  },
  {
    "id": "kubota-nr23",
    "brand": "한국구보다",
    "model": "NR23",
    "machineType": "ridingCultivator",
    "role": "powerUnit",
    "specs": {
      "engineModel": "Kubota D1305-EF03",
      "nominalPowerPs": 24.3,
      "enginePowerKw": 17.9,
      "engineRpm": 2600,
      "displacementCc": 1261,
      "groundClearanceMm": 630,
      "weightKg": 905
    },
    "facts": [
      [
        "엔진",
        "구보다 D1305-EF03 (1,261 cc 수랭 3기통 디젤)"
      ],
      [
        "출력",
        "24.3 PS (17.9 kW / 2,600 rpm)"
      ],
      [
        "최저지상고 / 중량",
        "630 mm / 905 kg"
      ],
      [
        "구동/조향",
        "4WD, 전후진 무단변속, 4가지 조향 모드(FWS/RWS/4WS/크랩)"
      ]
    ],
    "connection": {
      "hostType": "ridingCultivator",
      "label": "구보다 승용관리기 전용 링크 · 세부 PTO 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.kubotakorea.com/",
        "title": "한국구보다 NR23 승용관리기 공식 제원",
        "note": "24.3PS, 1,261cc, 905kg, 630mm",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "기체 전체 치수",
      "PTO 회전수 및 스플라인"
    ]
  },
  {
    "id": "daedong-dt100s",
    "brand": "대동",
    "model": "DT100S",
    "machineType": "tiller",
    "role": "powerUnit",
    "specs": {
      "engineModel": "ND10DE",
      "nominalPowerPs": 10,
      "displacementCc": 673,
      "weightKg": 469,
      "fuelTankL": 11
    },
    "facts": [
      [
        "출력",
        "상용 10 PS (최대 약 13 PS급)"
      ],
      [
        "배기량",
        "673 cc (횡형 수냉 단기통 디젤 ND10DE)"
      ],
      [
        "중량 / 연료탱크",
        "약 383~469 kg / 11 L"
      ]
    ],
    "connection": {
      "hostType": "tiller",
      "label": "대동 경운기 측면 구동 및 트레일러 견인 히치핀",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://ko.daedong.co.kr/",
        "title": "대동 DT100S 경운기 제원",
        "note": "673cc 10PS 단기통 디젤",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "로타리 폭 세부 옵션별 차이",
      "히치핀 직경"
    ]
  },
  {
    "id": "daedong-dt85",
    "brand": "대동",
    "model": "DT85",
    "machineType": "tiller",
    "role": "powerUnit",
    "specs": {
      "nominalPowerPs": 8,
      "weightKg": 370
    },
    "facts": [
      [
        "출력",
        "8 PS (호칭마력, 단기통 디젤)"
      ],
      [
        "중량",
        "약 350~400 kg (본체 기준)"
      ]
    ],
    "connection": {
      "hostType": "tiller",
      "label": "대동 경운기 측면 구동 및 트레일러 견인 히치핀",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.agriis.co.kr/",
        "title": "대동 DT85 경운기 제원",
        "note": "8마력급 전통 단기통 디젤 경운기",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "정확한 배기량",
      "세부 치수",
      "히치핀 직경"
    ]
  },
  {
    "id": "kukje-kt8",
    "brand": "국제",
    "model": "KT-8",
    "machineType": "tiller",
    "role": "powerUnit",
    "specs": {
      "nominalPowerPs": 8,
      "weightKg": 380
    },
    "facts": [
      [
        "출력",
        "8 PS급 단기통 디젤 엔진"
      ],
      [
        "중량",
        "약 350~450 kg (본체 기준)"
      ],
      [
        "현황",
        "단종 후 중고 시장·농가 현역 운용 다수"
      ]
    ],
    "connection": {
      "hostType": "tiller",
      "label": "경운기 측면 구동 및 트레일러 견인 히치핀",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.agriis.co.kr/",
        "title": "국제 KT-8 경운기 제원",
        "note": "8마력 디젤 경운기",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "정확한 배기량",
      "세부 치수",
      "히치핀 직경"
    ]
  },
  {
    "id": "daedong-drp80",
    "brand": "대동",
    "model": "DRP80",
    "machineType": "ricePlanter",
    "role": "standalone",
    "specs": {
      "nominalPowerPs": 24,
      "displacementCc": 1007,
      "rows": 8,
      "weightKg": 790
    },
    "facts": [
      [
        "이앙 조수",
        "8조식"
      ],
      [
        "엔진 / 배기량",
        "24 PS · 1,007 cc 수냉 3기통 디젤"
      ],
      [
        "중량",
        "약 780~800 kg대 (옵션별 상이)"
      ],
      [
        "특징",
        "직진자율주행 기능 및 전자동 이앙 시스템 탑재"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 트랙터/관리기 연결 불필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://ko.daedong.co.kr/",
        "title": "대동 DRP80 8조 승용 이앙기 공식 제원",
        "note": "24PS, 1,007cc, 8조식",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "기체 전체 치수",
      "측조시비기 장착 시 총중량"
    ]
  },
  {
    "id": "daedong-erp60d",
    "brand": "대동",
    "model": "ERP60D",
    "machineType": "ricePlanter",
    "role": "standalone",
    "specs": {
      "nominalPowerPs": 22,
      "engineRpm": 2800,
      "displacementCc": 1007,
      "rows": 6,
      "weightKg": 750
    },
    "facts": [
      [
        "이앙 조수",
        "6조식"
      ],
      [
        "엔진 / 배기량",
        "22 PS (2,800 rpm) · 1,007 cc 수냉 3기통 디젤"
      ],
      [
        "중량",
        "약 750 kg 내외 (무부하 기준)"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 트랙터/관리기 연결 불필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://ko.daedong.co.kr/",
        "title": "대동 ERP60D 6조 이앙기 공식 제원",
        "note": "22PS, 1,007cc, 약 750kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "기체 전체 치수",
      "세부 옵션별 중량"
    ]
  },
  {
    "id": "tym-rgo60",
    "brand": "TYM",
    "model": "RGO-60",
    "machineType": "ricePlanter",
    "role": "standalone",
    "specs": {
      "nominalPowerPs": 21,
      "displacementCc": 903,
      "rows": 6,
      "weightKg": 780
    },
    "facts": [
      [
        "이앙 조수",
        "6조식 (RGO-660DL / RGO-60SDY 등)"
      ],
      [
        "엔진 / 배기량",
        "21~22 PS (얀마 디젤 903 cc)"
      ],
      [
        "중량",
        "약 779~788 kg (디젤 사양 기준)"
      ],
      [
        "변속기",
        "HMT 미션 적용"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 트랙터/관리기 연결 불필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://tym.world/",
        "title": "TYM RGO-60 승용 이앙기 제원",
        "note": "6조, 21~22PS, 903cc, 779~788kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "기체 전체 치수",
      "옵션별 중량"
    ]
  },
  {
    "id": "yanmar-yr8d",
    "brand": "얀마",
    "model": "YR8D",
    "machineType": "ricePlanter",
    "role": "standalone",
    "specs": {
      "nominalPowerPs": 24,
      "rows": 8,
      "weightKg": 880
    },
    "facts": [
      [
        "이앙 조수",
        "8조식"
      ],
      [
        "엔진",
        "약 24~25 PS급 수냉 3기통 디젤"
      ],
      [
        "중량",
        "약 860~950 kg (GPS·밀묘 키트 여부별 상이)"
      ],
      [
        "특징",
        "HMT 미션, RTK GPS 직진어시스트 선택 가능"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 트랙터/관리기 연결 불필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.yanmar.com/kr/",
        "title": "얀마 YR8D 8조 승용 이앙기 제원",
        "note": "8조식, HMT 미션",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "정확한 배기량",
      "기체 전체 치수"
    ]
  },
  {
    "id": "kubota-knw6s",
    "brand": "한국구보다",
    "model": "KNW6S",
    "machineType": "ricePlanter",
    "role": "standalone",
    "specs": {
      "nominalPowerPs": 20.5,
      "displacementCc": 898,
      "rows": 6,
      "dimensionsMm": [
        3175,
        2420,
        1750
      ],
      "weightKg": 742
    },
    "facts": [
      [
        "이앙 조수",
        "6조식 (일반 / GS 자율주행 사양)"
      ],
      [
        "엔진 / 배기량",
        "20.5 PS · 898 cc 수냉 3기통 디젤"
      ],
      [
        "크기",
        "3,175 × 2,420 × 1,750 mm"
      ],
      [
        "중량",
        "742 kg (일반) / 760 kg (GS)"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 트랙터/관리기 연결 불필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.kubotakorea.com/",
        "title": "한국구보다 KNW6S 공식 제원",
        "note": "6조, 20.5PS, 898cc, 742kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "연료탱크 용량",
      "측조시비기 장착 시 중량"
    ]
  },
  {
    "id": "kubota-knw8s",
    "brand": "한국구보다",
    "model": "KNW8S",
    "machineType": "ricePlanter",
    "role": "standalone",
    "specs": {
      "nominalPowerPs": 24.6,
      "rows": 8,
      "dimensionsMm": [
        3340,
        2865,
        1750
      ],
      "weightKg": 881
    },
    "facts": [
      [
        "이앙 조수",
        "8조식 (일반 / GS 자율주행 사양)"
      ],
      [
        "엔진",
        "24.6 PS 수냉 3기통 디젤"
      ],
      [
        "크기",
        "3,340 × 2,865 × 1,750 mm"
      ],
      [
        "중량",
        "881 kg (일반) / 908 kg (GS)"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 트랙터/관리기 연결 불필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.kubotakorea.com/",
        "title": "한국구보다 KNW8S 공식 제원",
        "note": "8조, 24.6PS, 881kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "엔진 배기량",
      "연료탱크 용량"
    ]
  },
  {
    "id": "daedong-dxm55",
    "brand": "대동",
    "model": "DXM55",
    "machineType": "combine",
    "role": "standalone",
    "specs": {
      "nominalPowerPs": 55,
      "rows": 5
    },
    "facts": [
      [
        "예취 조수",
        "5조식 자탈형 콤바인"
      ],
      [
        "출력",
        "약 55~58 PS급 디젤 엔진"
      ],
      [
        "주 용도",
        "중소규모 수도작 수확"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 트랙터 연결 불필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://ko.daedong.co.kr/",
        "title": "대동 DXM55 콤바인 공식 라인업",
        "note": "5조식 자탈형 콤바인",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "정확한 배기량",
      "기체 치수 및 중량",
      "그레인탱크 용량"
    ]
  },
  {
    "id": "daedong-dxm85",
    "brand": "대동",
    "model": "DXM85",
    "machineType": "combine",
    "role": "standalone",
    "specs": {
      "nominalPowerPs": 85,
      "displacementCc": 2435,
      "rows": 5,
      "weightKg": 4158
    },
    "facts": [
      [
        "예취 조수",
        "5조식 (DXM85GF 등)"
      ],
      [
        "출력 / 배기량",
        "85 PS · 2,435 cc 수냉 4기통 디젤"
      ],
      [
        "중량",
        "약 4,158 kg"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 트랙터 연결 불필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://ko.daedong.co.kr/",
        "title": "대동 DXM85 공식 제원",
        "note": "5조, 85PS, 2,435cc, 4,158kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "기체 치수",
      "그레인탱크 용량"
    ]
  },
  {
    "id": "daedong-dxm110",
    "brand": "대동",
    "model": "DXM110",
    "machineType": "combine",
    "role": "standalone",
    "specs": {
      "nominalPowerPs": 102,
      "rows": 6
    },
    "facts": [
      [
        "예취 조수",
        "6조식 자탈형 콤바인"
      ],
      [
        "출력",
        "102 PS (퍼킨스 엔진 탑재 사양 기준)"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 트랙터 연결 불필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://ko.daedong.co.kr/",
        "title": "대동 DXM110 6조 콤바인 제원",
        "note": "6조식, 102PS",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "정확한 배기량",
      "기체 치수 및 중량",
      "그레인탱크 용량"
    ]
  },
  {
    "id": "tym-kc100",
    "brand": "TYM",
    "model": "KC100-CX",
    "machineType": "combine",
    "role": "standalone",
    "specs": {
      "engineModel": "D3400T6-AC",
      "nominalPowerPs": 100,
      "engineRpm": 2600,
      "displacementCc": 3409,
      "rows": 6,
      "weightKg": 4220,
      "fuelTankL": 100
    },
    "facts": [
      [
        "예취 조수",
        "6조식 자탈형 콤바인"
      ],
      [
        "출력 / 배기량",
        "100 PS (2,600 rpm) · 3,409 cc 4기통 수냉 디젤"
      ],
      [
        "중량 / 연료탱크",
        "약 4,220 kg / 100 L"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 트랙터 연결 불필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://tym.world/",
        "title": "TYM(국제) KC100-CX 6조 콤바인 제원",
        "note": "100PS, 3,409cc, 4,220kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "기체 치수",
      "그레인탱크 용량"
    ]
  },
  {
    "id": "tym-cx6130",
    "brand": "TYM",
    "model": "CX6130",
    "machineType": "combine",
    "role": "standalone",
    "specs": {
      "nominalPowerPs": 120,
      "displacementCc": 3054,
      "rows": 6,
      "weightKg": 4465
    },
    "facts": [
      [
        "예취 조수",
        "6조식"
      ],
      [
        "출력 / 배기량",
        "120 PS (얀마 엔진) · 3,054 cc"
      ],
      [
        "중량",
        "약 4,465 kg"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 트랙터 연결 불필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://tym.world/",
        "title": "TYM CX6130 6조 콤바인 공식 제원",
        "note": "120PS, 3,054cc, 4,465kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "기체 치수",
      "그레인탱크 용량"
    ]
  },
  {
    "id": "yanmar-yh470",
    "brand": "얀마",
    "model": "YH470",
    "machineType": "combine",
    "role": "standalone",
    "specs": {
      "nominalPowerPs": 73,
      "rows": 4
    },
    "facts": [
      [
        "예취 조수",
        "4조식"
      ],
      [
        "출력",
        "73 PS"
      ],
      [
        "특징",
        "중소규모 논 작업에 최적화된 4조식 자탈형 콤바인"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 트랙터 연결 불필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.yanmar.com/kr/",
        "title": "얀마 YH470 4조 콤바인 공식 제원",
        "note": "4조식, 73PS",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "정확한 배기량",
      "기체 치수 및 중량"
    ]
  },
  {
    "id": "yanmar-yh6115",
    "brand": "얀마",
    "model": "YH6115-P",
    "machineType": "combine",
    "role": "standalone",
    "specs": {
      "nominalPowerPs": 120,
      "displacementCc": 3053,
      "rows": 6,
      "weightKg": 4481
    },
    "facts": [
      [
        "예취 조수",
        "6조식"
      ],
      [
        "출력 / 배기량",
        "120 PS (커먼레일 CR 엔진) · 3,053 cc"
      ],
      [
        "중량",
        "4,481 kg"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 트랙터 연결 불필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.yanmar.com/kr/",
        "title": "얀마 YH6115-P 6조 콤바인 공식 제원",
        "note": "120PS, 3,053cc, 4,481kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "기체 치수",
      "그레인탱크 용량"
    ]
  },
  {
    "id": "kubota-er470",
    "brand": "한국구보다",
    "model": "ER470",
    "machineType": "combine",
    "role": "standalone",
    "specs": {
      "nominalPowerPs": 70,
      "rows": 4
    },
    "facts": [
      [
        "예취 조수",
        "4조식 (다이나맥스 시리즈)"
      ],
      [
        "출력",
        "70 PS"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 트랙터 연결 불필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.kubotakorea.com/",
        "title": "한국구보다 ER470 4조 콤바인 제원",
        "note": "4조식, 70PS",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "정확한 배기량",
      "기체 치수 및 중량"
    ]
  },
  {
    "id": "yanmar-pw200r",
    "brand": "얀마",
    "model": "PW200R",
    "machineType": "transplanter",
    "role": "standalone",
    "specs": {
      "engineModel": "GB400PE-606",
      "nominalPowerPs": 9.3,
      "maxPowerKw": 6.9,
      "engineRpm": 2700,
      "displacementCc": 391,
      "rows": 2,
      "weightKg": 638
    },
    "facts": [
      [
        "작업 조수",
        "승용 2조 전자동 채소정식기"
      ],
      [
        "엔진 / 배기량",
        "GB400PE-606 공냉 가솔린 · 391 cc"
      ],
      [
        "최대 출력",
        "9.3 PS (6.9 kW / 2,700 rpm)"
      ],
      [
        "기대 중량",
        "638 kg"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 트랙터/관리기 연결 불필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.yanmar.com/kr/",
        "title": "얀마 PW200R 승용 2조 전자동 이식기 공식 제원",
        "note": "391cc, 9.3PS, 638kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "기체 치수",
      "대응 트레이 규격 상세"
    ]
  },
  {
    "id": "yanmar-pw10a",
    "brand": "얀마",
    "model": "PW10A",
    "machineType": "transplanter",
    "role": "standalone",
    "specs": {
      "engineModel": "GB101LN-379",
      "nominalPowerPs": 3,
      "displacementCc": 98,
      "rows": 1,
      "weightKg": 225
    },
    "facts": [
      [
        "작업 조수",
        "보행형 1조 전자동 채소정식기"
      ],
      [
        "엔진 / 배기량",
        "GB101LN-379 공냉 가솔린 · 98 cc · 최대 3.0 PS"
      ],
      [
        "기대 중량",
        "약 220~230 kg"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 트랙터/관리기 연결 불필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.yanmar.com/kr/",
        "title": "얀마 PW10A 보행 정식기 공식 제원",
        "note": "98cc, 3.0PS, 220~230kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "기체 치수",
      "대응 트레이 규격 상세"
    ]
  },
  {
    "id": "asia-ass5",
    "brand": "아세아텍",
    "model": "ASS5",
    "machineType": "speedSprayer",
    "role": "standalone",
    "specs": {
      "chemicalTankL": 500
    },
    "facts": [
      [
        "약액 탱크",
        "500 L"
      ],
      [
        "조향 방식",
        "2륜 조향 (2WS)"
      ],
      [
        "분무기",
        "아세아 100L 주물 분무기 탑재"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 과수원 전용 자주식 방제기",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.asiakor.com/",
        "title": "아세아텍 ASS5 스피드스프레이어",
        "note": "500L, 2륜 조향",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "엔진 마력 및 배기량",
      "기체 치수 및 중량"
    ]
  },
  {
    "id": "asia-ass6",
    "brand": "아세아텍",
    "model": "ASS6",
    "machineType": "speedSprayer",
    "role": "standalone",
    "specs": {
      "chemicalTankL": 500
    },
    "facts": [
      [
        "약액 탱크",
        "500 L"
      ],
      [
        "조향 방식",
        "4륜 조향 (4WS, 소선회)"
      ],
      [
        "분무기",
        "아세아 100L 주물 분무기 탑재"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 과수원 전용 자주식 방제기",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.asiakor.com/",
        "title": "아세아텍 ASS6 스피드스프레이어",
        "note": "500L, 4륜 조향",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "엔진 마력 및 배기량",
      "기체 치수 및 중량"
    ]
  },
  {
    "id": "hana-ha1000s",
    "brand": "한아에스에스",
    "model": "HA-1000SCA",
    "machineType": "speedSprayer",
    "role": "standalone",
    "specs": {
      "nominalPowerPs": 65,
      "chemicalTankL": 1000
    },
    "facts": [
      [
        "약액 탱크",
        "1,000 L (캐빈형 대형)"
      ],
      [
        "엔진",
        "65 PS 터보 인터쿨러 디젤 엔진 (현대 엔진 등)"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 과수원 전용 자주식 캐빈형 방제기",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.hana-ss.co.kr/",
        "title": "한아에스에스 HA-1000SCA 공식 제원",
        "note": "1,000L, 65PS 터보 디젤",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "기체 치수 및 공차중량",
      "조향 방식(2WS/4WS)"
    ]
  },
  {
    "id": "hansung-ss500ctld",
    "brand": "한성티앤아이",
    "model": "SS-500CTLD",
    "machineType": "speedSprayer",
    "role": "standalone",
    "specs": {
      "chemicalTankL": 500
    },
    "facts": [
      [
        "약액 탱크",
        "500 L"
      ],
      [
        "주행 방식",
        "궤도형(크롤러) · 덤프 및 리프트 겸용"
      ],
      [
        "특징",
        "경사지 및 험로 등판 능력 우수"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 궤도형 과수 방제기",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.hstni.com/",
        "title": "한성티앤아이 SS-500CTLD 궤도형 SS기",
        "note": "500L, 궤도형 덤프·리프트",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "주행·송풍 엔진 마력",
      "기체 치수 및 중량"
    ]
  },
  {
    "id": "kubota-ssaz500",
    "brand": "한국구보다",
    "model": "SSA-Z500-2",
    "machineType": "speedSprayer",
    "role": "standalone",
    "specs": {
      "nominalPowerPs": 21,
      "chemicalTankL": 500
    },
    "facts": [
      [
        "약액 탱크",
        "500 L"
      ],
      [
        "엔진",
        "구보다 디젤 엔진 약 21 PS"
      ],
      [
        "특징",
        "고효율 알루미늄 팬 및 8분할 노즐"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 과수원 전용 자주식 방제기",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.kubotakorea.com/",
        "title": "한국구보다 SSA-Z500-2 스피드스프레이어",
        "note": "500L, 21PS 구보다 디젤",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "기체 치수 및 중량",
      "조향 방식 상세"
    ]
  },
  {
    "id": "dji-agras-t40",
    "brand": "DJI",
    "model": "Agras T40",
    "machineType": "agriDrone",
    "role": "standalone",
    "specs": {
      "chemicalTankL": 40,
      "granuleTankL": 70,
      "maxGranulePayloadKg": 50,
      "weightKg": 50,
      "maxTakeoffWeightKg": 90
    },
    "facts": [
      [
        "액체 방제 탱크",
        "40 L (최대 작동 페이로드 40 kg)"
      ],
      [
        "입제 살포 탱크",
        "70 L (내부 하중 최대 50 kg)"
      ],
      [
        "기체 중량",
        "38 kg (배터리 제외) / 50 kg (배터리 포함)"
      ],
      [
        "최대 이륙 중량",
        "분사 90 kg / 입제 101 kg"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 비행 · 무인멀티콥터 조종자격 및 비행승인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://ag.dji.com/kr/t40",
        "title": "DJI Agras T40 공식 사양",
        "note": "액체 40L, 입제 70L, 배터리 포함 50kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "비행 시간 및 충전기 요구 전력"
    ]
  },
  {
    "id": "dji-agras-t30",
    "brand": "DJI (아세아텍 공급)",
    "model": "Agras T30",
    "machineType": "agriDrone",
    "role": "standalone",
    "specs": {
      "chemicalTankL": 30,
      "weightKg": 26.4,
      "maxTakeoffWeightKg": 78
    },
    "facts": [
      [
        "액체 방제 탱크",
        "30 L"
      ],
      [
        "기체 중량 / 최대이륙중량",
        "약 26.4 kg (배터리 제외) / 약 78 kg"
      ],
      [
        "국내 공급",
        "아세아텍 공식 공급 라인업"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 비행 · 무인멀티콥터 조종자격 및 비행승인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://ag.dji.com/kr/",
        "title": "DJI Agras T30 한국 공식 사양",
        "note": "30L 탱크, 아세아텍 공급",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "입제 탱크 용량",
      "비행 시간"
    ]
  },
  {
    "id": "intosky-vandi-s1",
    "brand": "인투스카이",
    "model": "VANDI S1+",
    "machineType": "agriDrone",
    "role": "standalone",
    "specs": {
      "chemicalTankL": 16,
      "weightKg": 22.5,
      "maxTakeoffWeightKg": 38.5
    },
    "facts": [
      [
        "방제 탱크",
        "16 L (헥사콥터)"
      ],
      [
        "총 중량 (배터리 포함)",
        "22.5 kg"
      ],
      [
        "최대 이륙 중량",
        "38.5 kg"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 비행 · 국산 농업용 방제 드론",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.intosky.co.kr/",
        "title": "인투스카이 VANDI S1+ 공식 제원",
        "note": "16L, 총중량 22.5kg, MTOW 38.5kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "입제 살포 탱크 옵션",
      "비행 시간"
    ]
  },
  {
    "id": "intosky-prex6-h10",
    "brand": "인투스카이",
    "model": "PREX6-H10",
    "machineType": "agriDrone",
    "role": "standalone",
    "specs": {
      "chemicalTankL": 10,
      "weightKg": 15.4,
      "maxTakeoffWeightKg": 24.9
    },
    "facts": [
      [
        "방제 탱크",
        "최대 10 L (권장 9 L)"
      ],
      [
        "총 중량",
        "15.4 kg"
      ],
      [
        "최대 이륙 중량",
        "24.9 kg (초경량비행장치 25kg 미만 기준 충족)"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 비행 · 25kg 미만 경량 방제 드론",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.intosky.co.kr/",
        "title": "인투스카이 PREX6-H10 공식 제원",
        "note": "10L, 15.4kg, MTOW 24.9kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "비행 시간",
      "살포 폭 상세"
    ]
  },
  {
    "id": "asia-hs80",
    "brand": "아세아텍",
    "model": "HS-80",
    "machineType": "sprayer",
    "role": "standalone",
    "specs": {
      "pumpType": "80A 고압 동력분무기",
      "maxPressureKgfCm2": 35,
      "flowRateLpm": 65,
      "weightKg": 15
    },
    "facts": [
      [
        "규격 / 압력",
        "80A 규격 · 상용/최고 20~35 kgf/cm² (2.0~3.5 MPa)"
      ],
      [
        "토출량",
        "방제 60~65 L/min (관수 최대 90~98 L/min)"
      ],
      [
        "소요 동력",
        "3~5 HP 모터 또는 동급 엔진 매칭"
      ],
      [
        "중량 (헤드)",
        "약 13~16 kg"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립/세트 구동 · 3~5HP 모터 또는 엔진 풀리 연결",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.asiakor.com/",
        "title": "아세아텍 HS-80 동력분무기 사양",
        "note": "80A KS 인증 동력분무기",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "세트 구성 시 전체 중량",
      "치수"
    ]
  },
  {
    "id": "daedong-dhm80a",
    "brand": "대동(CM)",
    "model": "DHM-80A",
    "machineType": "sprayer",
    "role": "standalone",
    "specs": {
      "pumpType": "80A 고압 동력분무기",
      "maxPressureKgfCm2": 35,
      "flowRateLpm": 65,
      "weightKg": 15
    },
    "facts": [
      [
        "규격 / 압력",
        "80A 규격 · 20~35 kgf/cm² (2.0~3.5 MPa)"
      ],
      [
        "토출량",
        "분당 약 65~98 L (방제/관수 겸용)"
      ],
      [
        "소요 동력",
        "3~4.5 HP (3.7 kW급 권장)"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립/세트 구동 · 모터 또는 엔진 풀리 연결",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.dhtotal.com/",
        "title": "대동(CM) DHM-80A 동력분무기 사양",
        "note": "80A 규격, 3.7kW급",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "세트 구성 시 전체 중량",
      "치수"
    ]
  },
  {
    "id": "hansung-hti1000mst",
    "brand": "한성티앤아이",
    "model": "HTI-1000MST",
    "machineType": "sprayer",
    "role": "standalone",
    "specs": {
      "engineModel": "현대 D4BB TC 디젤",
      "sprayDistanceM": 70
    },
    "facts": [
      [
        "구분",
        "다목적 광역방제기 (조달청 우수제품)"
      ],
      [
        "탑재 엔진 / 분무기",
        "현대 D4BB TC 디젤엔진 · 100A 동력분무기"
      ],
      [
        "살포 거리",
        "약 60~70 m (360° 회전 분사체)"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "차량·트레일러 탑재형 다목적 광역방제기",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.hstni.com/",
        "title": "한성티앤아이 HTI-1000MST 공식 제원",
        "note": "현대 D4BB TC, 100A 분무기, 살포거리 60~70m",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "기체 중량",
      "탱크 용량 상세"
    ]
  },
  {
    "id": "hansung-hsu3000",
    "brand": "한성티앤아이",
    "model": "HSU-3000",
    "machineType": "sprayer",
    "role": "standalone",
    "specs": {
      "nominalPowerPs": 290,
      "sprayDistanceM": 150
    },
    "facts": [
      [
        "구분",
        "초대형 원거리용 광역방제기"
      ],
      [
        "송풍 엔진",
        "약 290 PS급 엔진 탑재"
      ],
      [
        "살포 거리 / 능력",
        "최대 약 150 m · 시간당 약 10~15 ha"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "대형 트럭·전용 캐리어 탑재형 광역방제기",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.hstni.com/",
        "title": "한성티앤아이 HSU-3000 원거리 방제기 제원",
        "note": "290마력 송풍, 최대 150m 살포",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "정확한 탱크 용량",
      "공차 중량"
    ]
  },
  {
    "id": "hanil-q20",
    "brand": "한일",
    "model": "Q-20",
    "machineType": "sprayer",
    "role": "standalone",
    "specs": {
      "chemicalTankL": 20
    },
    "facts": [
      [
        "구분",
        "20 L 인력식 압축분무기 (스테디셀러)"
      ],
      [
        "주 용도",
        "소규모 밭, 하우스 및 방역 살포"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "인력 휴대형 · 별도 동력 연결 불필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.awm.co.kr/",
        "title": "한일 Q-20 20L 압축분무기",
        "note": "20L 인력식 표준 분무기",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "건조 중량",
      "최대 압력"
    ]
  },
  {
    "id": "daedong-mechron2200",
    "brand": "대동",
    "model": "Mechron 2200",
    "machineType": "carrier",
    "role": "standalone",
    "specs": {
      "nominalPowerPs": 22,
      "maxPayloadKg": 500,
      "weightKg": 890
    },
    "facts": [
      [
        "엔진",
        "22 PS 디젤 엔진 (4WD)"
      ],
      [
        "적재량",
        "500 kg (유압 덤프)"
      ],
      [
        "기체 중량",
        "약 800~900 kg대 (후속 2230 기준 890 kg)"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 다목적 4륜 농업용 운반차",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://ko.daedong.co.kr/",
        "title": "대동 Mechron 2200 제원",
        "note": "22PS 디젤, 적재량 500kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "세부 전장·전폭·전고",
      "배기량"
    ]
  },
  {
    "id": "asia-apc1000m",
    "brand": "아세아텍",
    "model": "APC-1000M",
    "machineType": "carrier",
    "role": "standalone",
    "specs": {
      "maxPayloadKg": 1000
    },
    "facts": [
      [
        "적재량",
        "1,000 kg (1톤급 대형 동력운반차)"
      ],
      [
        "엔진 / 기능",
        "혼다 V형 2기통 엔진 · 디스크 브레이크 · 덤프 및 리프트"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 바퀴형 다목적 동력운반차",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.asiakor.com/",
        "title": "아세아텍 APC-1000M 공식 제원",
        "note": "적재량 1,000kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "정확한 엔진 마력",
      "기체 치수 및 중량"
    ]
  },
  {
    "id": "asia-apc6",
    "brand": "아세아텍",
    "model": "APC6",
    "machineType": "carrier",
    "role": "standalone",
    "specs": {
      "engineModel": "Honda GX630",
      "nominalPowerPs": 19.7,
      "maxPayloadKg": 600,
      "weightKg": 1049
    },
    "facts": [
      [
        "엔진 / 출력",
        "혼다 GX630 · 최대 19.7 PS (정격 17.7 PS)"
      ],
      [
        "적재량 / 리프트",
        "600 kg (리프트 하중 600 kg)"
      ],
      [
        "기체 중량",
        "1,049 kg"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 리프트·덤프 동력운반차",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.asiakor.com/",
        "title": "아세아텍 APC6 공식 제원",
        "note": "19.7PS, 적재량 600kg, 중량 1,049kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "기체 전체 치수"
    ]
  },
  {
    "id": "sungboo-sb3500",
    "brand": "성부산업",
    "model": "SB-3500",
    "machineType": "carrier",
    "role": "standalone",
    "specs": {
      "maxPayloadKg": 500
    },
    "facts": [
      [
        "구동 방식",
        "전동 무한궤도식 (배터리 구동, 무선 리모컨 지원)"
      ],
      [
        "적재량",
        "500 kg (유압 덤프 및 리프트 기능)"
      ],
      [
        "주 용도",
        "과수원·비닐하우스·산악 경사지 농산물 운반"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 전동 무한궤도 운반차",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.isungboo.com/",
        "title": "성부산업 SB-3500 전동 궤도운반차 공식 제원",
        "note": "전동 궤도식, 적재량 500kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "기체 중량",
      "배터리 용량 및 1회 충전 주행시간"
    ]
  },
  {
    "id": "kubota-u17",
    "brand": "한국구보다",
    "model": "U-17-5S",
    "machineType": "excavator",
    "role": "standalone",
    "specs": {
      "nominalPowerPs": 17,
      "engineRpm": 2200,
      "weightKg": 1655,
      "bucketCapacityM3": 0.04
    },
    "facts": [
      [
        "체급 / 중량",
        "1.7톤급 · 약 1,655 kg (캐노피 기준)"
      ],
      [
        "엔진 출력",
        "17.0 PS / 2,200 rpm (구보다 디젤)"
      ],
      [
        "표준 버킷",
        "약 0.04~0.05 m³"
      ],
      [
        "특징",
        "가변 트랙(990~1,240 mm) 적용으로 좁은 농로·하우스 진입 가능"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 소형 건설기계 조종면허(3톤 미만) 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.koreakubota.co.kr/",
        "title": "한국구보다 U-17-5S 미니굴착기 공식 제원",
        "note": "1.7톤급, 17.0PS, 1,655kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "엔진 배기량",
      "최대 굴착 깊이"
    ]
  },
  {
    "id": "kubota-u30",
    "brand": "한국구보다",
    "model": "U-30-6S",
    "machineType": "excavator",
    "role": "standalone",
    "specs": {
      "nominalPowerPs": 24.8,
      "engineRpm": 2200,
      "weightKg": 3587,
      "bucketCapacityM3": 0.08
    },
    "facts": [
      [
        "체급 / 중량",
        "3톤급 · 3,587 kg (캐노피) / 3,715 kg (캐빈)"
      ],
      [
        "엔진 출력",
        "24.8 PS / 2,200 rpm"
      ],
      [
        "표준 버킷",
        "0.08 m³ (평적) / 0.11 m³ (산적)"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 굴착기 조종면허 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.koreakubota.co.kr/",
        "title": "한국구보다 U-30-6S 미니굴착기 공식 제원",
        "note": "3톤급, 24.8PS, 3,587kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "엔진 배기량",
      "최대 굴착 깊이"
    ]
  },
  {
    "id": "yanmar-vio17",
    "brand": "얀마",
    "model": "VIO17-1",
    "machineType": "excavator",
    "role": "standalone",
    "specs": {
      "engineModel": "3TNV70",
      "nominalPowerPs": 14,
      "engineRpm": 2200,
      "weightKg": 1801,
      "bucketCapacityM3": 0.04
    },
    "facts": [
      [
        "체급 / 중량",
        "1.7톤급 · 약 1,801~1,851 kg"
      ],
      [
        "엔진 출력",
        "13.7~14.0 PS / 2,200 rpm (3TNV70)"
      ],
      [
        "표준 버킷",
        "0.04 m³ (평적) / 0.05 m³ (산적)"
      ],
      [
        "특징",
        "초소형 후방 선회(Zero Tail Swing), 가변 트랙(950~1,280 mm)"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 소형 건설기계 조종면허(3톤 미만) 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.yanmar.com/kr/",
        "title": "얀마 VIO17-1 미니굴착기 공식 제원",
        "note": "1.7톤급, 14.0PS, 약 1,801kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "최대 굴착 깊이",
      "전체 치수"
    ]
  },
  {
    "id": "yanmar-vio30",
    "brand": "얀마",
    "model": "VIO30-6B",
    "machineType": "excavator",
    "role": "standalone",
    "specs": {
      "nominalPowerPs": 24.5,
      "engineRpm": 2200,
      "weightKg": 3125,
      "bucketCapacityM3": 0.09
    },
    "facts": [
      [
        "체급 / 중량",
        "3톤급 · 약 3,125~3,380 kg"
      ],
      [
        "엔진 출력",
        "약 24.5~27.3 PS / 2,200 rpm"
      ],
      [
        "표준 버킷",
        "약 0.09~0.10 m³"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 굴착기 조종면허 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.yanmar.com/kr/",
        "title": "얀마 VIO30 미니굴착기 공식 제원",
        "note": "3톤급, 24.5~27.3PS, 3,125~3,380kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "최대 굴착 깊이",
      "전체 치수"
    ]
  },
  {
    "id": "hyundai-hx17az",
    "brand": "HD현대건설기계",
    "model": "HX17AZ",
    "machineType": "excavator",
    "role": "standalone",
    "specs": {
      "engineModel": "Kubota D902",
      "nominalPowerPs": 16.7,
      "engineRpm": 2400,
      "weightKg": 1975,
      "bucketCapacityM3": 0.04
    },
    "facts": [
      [
        "체급 / 중량",
        "1.7톤급 · 1,975 kg (캐노피 기준)"
      ],
      [
        "엔진 출력",
        "16.7 PS / 2,400 rpm (구보다 D902 엔진)"
      ],
      [
        "표준 버킷",
        "0.04 m³ (토공용 표준 버킷)"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 소형 건설기계 조종면허(3톤 미만) 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.hd-hyundaice.com/",
        "title": "HD현대건설기계 HX17AZ 공식 제원",
        "note": "1.7톤급, 16.7PS, 1,975kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "최대 굴착 깊이",
      "가변 트랙 폭 상세"
    ]
  },
  {
    "id": "sungboo-sb7500",
    "brand": "성부산업",
    "model": "SB-7500",
    "machineType": "aerialLift",
    "role": "standalone",
    "specs": {
      "maxWorkHeightMm": 2715,
      "maxPayloadKg": 200,
      "weightKg": 1100
    },
    "facts": [
      [
        "형식",
        "테이블형 전동 무한궤도 고소작업차 (48V 배터리)"
      ],
      [
        "최고 상승 높이",
        "약 2,715 mm (작업자 탑승 시 약 4m 작업 가능)"
      ],
      [
        "적재 / 기체 중량",
        "약 100~200 kg / 약 1,075~1,155 kg"
      ],
      [
        "특징",
        "4조 분할 확장작업대, 전·좌·우 수평 제어"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 과수원 전용 전동 고소작업차",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.isungboo.com/",
        "title": "성부산업 SB-7500 전동고소작업차 공식 제원",
        "note": "최고 상승 2,715mm, 약 1,075~1,155kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "배터리 용량 및 연속 작업시간",
      "전체 치수"
    ]
  },
  {
    "id": "sungboo-sb8000n",
    "brand": "성부산업",
    "model": "SB-8000N",
    "machineType": "aerialLift",
    "role": "standalone",
    "specs": {
      "maxWorkHeightMm": 3740,
      "weightKg": 1155
    },
    "facts": [
      [
        "형식",
        "2관절 굴절 붐형 전동 무한궤도 고소작업차 (48V, 2.0kW 모터)"
      ],
      [
        "최대 붐 상승 높이",
        "3,740 mm 이상"
      ],
      [
        "기체 중량",
        "약 1,155 kg"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 360도 회전 붐형 과수 고소작업차",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.isungboo.com/",
        "title": "성부산업 SB-8000N 공식 제원",
        "note": "붐 상승 3,740mm, 1,155kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "정격 적재 하중",
      "전체 치수"
    ]
  },
  {
    "id": "hansung-hti-gtm320t",
    "brand": "한성티앤아이",
    "model": "HTI-GTM320T",
    "machineType": "aerialLift",
    "role": "standalone",
    "specs": {
      "maxPayloadKg": 150
    },
    "facts": [
      [
        "형식",
        "1인승 전동 무한궤도 붐형 고소작업차"
      ],
      [
        "정격 적재 하중",
        "최대 150 kg"
      ],
      [
        "특징",
        "붐 360도 선회, 좌우 10° 경사면 수평보정, 조이스틱 조작"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 과수·조경용 전동 고소작업차",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.hstni.com/",
        "title": "한성티앤아이 HTI-GTM320T 공식 제원",
        "note": "전동 궤도 붐형, 정격하중 150kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "최대 작업 높이",
      "기체 치수 및 중량"
    ]
  },
  {
    "id": "hansung-hti-mlk730k",
    "brand": "한성티앤아이",
    "model": "HTI-MLK730K",
    "machineType": "aerialLift",
    "role": "standalone",
    "specs": {},
    "facts": [
      [
        "형식",
        "무한궤도 방식 과수용 다목적 고소작업차"
      ],
      [
        "특징",
        "측방향 12도 이내 경사 수평보정, 전후 2분할 보조작업대"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 과수 밀착 작업용 고소작업차",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.hstni.com/",
        "title": "한성티앤아이 HTI-MLK730K 공식 정보",
        "note": "12도 수평보정, 2분할 작업대",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "최대 작업 높이",
      "정격 적재 하중",
      "기체 치수 및 중량"
    ]
  },
  {
    "id": "orec-rm982f",
    "brand": "오렉 (OREC)",
    "model": "RM982F",
    "machineType": "mower",
    "role": "standalone",
    "specs": {
      "nominalPowerPs": 24,
      "cuttingWidthMm": 980,
      "weightKg": 345
    },
    "facts": [
      [
        "형식",
        "4WD 승차식(승용식) 긴풀 제초기 (HST 무단변속)"
      ],
      [
        "엔진 출력",
        "24 PS (가와사키 2기통 가솔린)"
      ],
      [
        "제초 폭 / 중량",
        "980 mm / 약 345 kg"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 과수원·초지 승용 제초기",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.dktools.co.kr/",
        "title": "오렉 RM982F 승용 제초기 제원",
        "note": "4WD 24PS, 제초폭 980mm, 345kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "기체 전체 치수",
      "예초 높이 조절 범위"
    ]
  },
  {
    "id": "asia-hr900",
    "brand": "아세아텍",
    "model": "HR-900",
    "machineType": "mower",
    "role": "standalone",
    "specs": {
      "engineModel": "Mitsubishi GB300L",
      "maxPowerKw": 5.9,
      "engineRpm": 1800,
      "displacementCc": 296,
      "cuttingWidthMm": 900,
      "weightKg": 193
    },
    "facts": [
      [
        "형식",
        "보행·자주식 동력제초기"
      ],
      [
        "엔진 / 배기량",
        "미쓰비시 GB300L · 296 cc (최대 5.9 kW / 1,800 rpm)"
      ],
      [
        "제초 폭 / 중량",
        "900 mm / 193 kg"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 과수원 하부 보행 자주식 제초기",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.asiakor.com/",
        "title": "아세아텍 HR-900 동력제초기 공식 제원",
        "note": "296cc, 제초폭 900mm, 193kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "기체 전체 치수",
      "예초 높이 조절 범위"
    ]
  },
  {
    "id": "hana-ha-cg431",
    "brand": "한아에스에스",
    "model": "HA-CG431",
    "machineType": "mower",
    "role": "standalone",
    "specs": {},
    "facts": [
      [
        "형식",
        "궤도형 광역제초기 (과수원·경사지 제초 전용)"
      ],
      [
        "특징",
        "무한궤도 구동으로 험지·경사지 주행 안정성 확보"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 궤도형 자주식 제초기",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.hana-ss.co.kr/",
        "title": "한아에스에스 HA-CG431 궤도형 제초기",
        "note": "과수원 궤도형 광역제초기",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "엔진 마력 및 배기량",
      "제초 폭",
      "기체 중량"
    ]
  },
  {
    "id": "honda-umk425",
    "brand": "혼다",
    "model": "UMK425",
    "machineType": "mower",
    "role": "standalone",
    "specs": {
      "engineModel": "Honda GX25",
      "nominalPowerPs": 1.1,
      "ratedPowerKw": 0.7,
      "engineRpm": 7000,
      "displacementCc": 25,
      "weightKg": 5.8
    },
    "facts": [
      [
        "형식",
        "견착식 4행정 소형 예초기"
      ],
      [
        "엔진 / 배기량",
        "혼다 GX25 · 25.0 cc"
      ],
      [
        "출력 / 중량",
        "약 1.1 PS (0.7 kW / 7,000 rpm) / 약 5.5~6 kg"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "인력 휴대형 · 별도 본체 연결 불필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.hondaplus.co.kr/",
        "title": "혼다 UMK425 공식 제원",
        "note": "GX25 25cc 4행정, 약 5.8kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "표준 날 직경"
    ]
  },
  {
    "id": "hansung-hti-wc100",
    "brand": "한성티앤아이",
    "model": "HTI-WC100",
    "machineType": "shredder",
    "role": "standalone",
    "specs": {
      "maxBranchDiameterMm": 80
    },
    "facts": [
      [
        "형식",
        "보행·무한궤도형 목재/잔가지 파쇄기 (V형 2기통 엔진)"
      ],
      [
        "최대 파쇄 직경",
        "약 80 mm (공급 롤러 폭 200 mm)"
      ],
      [
        "특징",
        "상하 독립구동 공급 롤러 및 역회전 기능"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 과수원 무한궤도 자주식 파쇄기",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.hstni.com/",
        "title": "한성티앤아이 HTI-WC100 공식 제원",
        "note": "최대 파쇄 직경 80mm, 무한궤도형",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "엔진 마력 및 배기량",
      "기체 치수 및 공차중량"
    ]
  },
  {
    "id": "taekwang-thr900c",
    "brand": "태광공업",
    "model": "THR900C",
    "machineType": "shredder",
    "role": "standalone",
    "specs": {
      "engineModel": "GT1300PE",
      "nominalPowerPs": 13,
      "displacementCc": 392,
      "weightKg": 247
    },
    "facts": [
      [
        "형식",
        "무한궤도 자주식 동력제초·잔가지파쇄 겸용기"
      ],
      [
        "엔진 / 배기량",
        "GT1300PE 13 PS · 392 cc"
      ],
      [
        "기체 중량",
        "약 247 kg (경사지 25도 작업 가능)"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 무한궤도 자주식 제초·파쇄기",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.tkam.kr/",
        "title": "태광공업 THR900C 공식 제원",
        "note": "13PS, 392cc, 247kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "최대 파쇄 직경 상세",
      "기체 치수"
    ]
  },
  {
    "id": "kumsung-gs360",
    "brand": "금성(우진)",
    "model": "GS-360",
    "machineType": "shredder",
    "role": "standalone",
    "specs": {
      "nominalPowerPs": 5
    },
    "facts": [
      [
        "형식",
        "모터/전기형 잔가지 파쇄기"
      ],
      [
        "소요 동력",
        "5 HP 전기 모터 탑재"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 전기 모터 고정/이동식 파쇄기",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.woojinmall.com/",
        "title": "금성(우진) GS-360 잔가지 파쇄기",
        "note": "5마력 전기 모터형",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "최대 파쇄 직경",
      "기체 치수 및 중량"
    ]
  },
  {
    "id": "daedongtech-ddk700",
    "brand": "대동테크",
    "model": "DDK-700",
    "machineType": "shredder",
    "role": "standalone",
    "specs": {},
    "facts": [
      [
        "형식",
        "잔가지파쇄기 및 동력절단기 겸용"
      ],
      [
        "주 용도",
        "과수원 전정가지 및 고춧대·화훼 부산물 파쇄"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 엔진 또는 전기 모터 선택형",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.ddtech.co.kr/",
        "title": "대동테크 DDK-700 잔가지파쇄기",
        "note": "과수·밭작물 부산물 파쇄기",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "소요 마력",
      "최대 파쇄 직경",
      "기체 치수 및 중량"
    ]
  },
  {
    "id": "shinnong-sht300",
    "brand": "신농",
    "model": "SHT-300",
    "machineType": "thresher",
    "role": "standalone",
    "specs": {
      "nominalPowerPs": 3,
      "dimensionsMm": [
        960,
        1270,
        1430
      ],
      "weightKg": 167
    },
    "facts": [
      [
        "형식",
        "거치형 다목적 콩탈곡기 (단상 220V 3HP 모터)"
      ],
      [
        "규격",
        "960 × 1,270 × 1,430 mm"
      ],
      [
        "중량 / 능률",
        "약 167 kg / 시간당 80~150 kg"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 220V 전기 모터 탈곡기",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.shin-nong.com/",
        "title": "신농 SHT-300 다목적 콩탈곡기 공식 제원",
        "note": "3HP, 167kg, 시간당 80~150kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "적용 작물별 선별 망 규격"
    ]
  },
  {
    "id": "buheung-bhd1300",
    "brand": "부흥기계공업사",
    "model": "BHD-1300",
    "machineType": "thresher",
    "role": "standalone",
    "specs": {
      "enginePowerKw": 1.5,
      "nominalPowerPs": 2,
      "dimensionsMm": [
        1250,
        1010,
        1090
      ],
      "weightKg": 132
    },
    "facts": [
      [
        "형식",
        "모터형 소·중형 콩탈곡기"
      ],
      [
        "소요 동력",
        "1.5 kW (약 2 HP 모터 포함)"
      ],
      [
        "규격 / 중량",
        "1,250 × 1,010 × 1,090 mm / 약 132 kg"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 전기 모터 탈곡기",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.bhmi.kr/",
        "title": "부흥기계공업사 BHD-1300 제원",
        "note": "1.5kW, 132kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "시간당 처리 능력"
    ]
  },
  {
    "id": "buheung-bhdt2000",
    "brand": "부흥기계공업사",
    "model": "BHDT-2000",
    "machineType": "thresher",
    "role": "standalone",
    "specs": {},
    "facts": [
      [
        "형식",
        "대형 트랙터 견인/부착형 콩탈곡기"
      ],
      [
        "주 용도",
        "대규모 콩 재배 농가 대량 탈곡·정선"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 견인/PTO 구동형 대형 탈곡기 · 세부 히치·PTO 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.bhmi.kr/",
        "title": "부흥기계공업사 BHDT-2000",
        "note": "트랙터 부착형 대형 콩탈곡기",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "요구 트랙터 마력",
      "기체 치수 및 중량",
      "시간당 처리 능력"
    ]
  },
  {
    "id": "yanmar-pbta1200",
    "brand": "얀마",
    "model": "PBTA1200",
    "machineType": "thresher",
    "role": "standalone",
    "specs": {
      "nominalPowerPs": 5.9,
      "ratedPowerKw": 4.3,
      "maxPowerKw": 4.8,
      "dimensionsMm": [
        3330,
        1720,
        1325
      ],
      "weightKg": 515
    },
    "facts": [
      [
        "형식",
        "자주식 크롤러형 대두(콩) 탈립기"
      ],
      [
        "엔진 출력",
        "정격 5.9 PS (4.3 kW) / 최대 6.5 PS (4.8 kW) 디젤"
      ],
      [
        "크기 (작업 시)",
        "3,330 × 1,720 × 1,325 mm"
      ],
      [
        "중량 / 능률",
        "515 kg / 시간당 300~700 kg (자실 기준)"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 구동 · 자주식 크롤러형 대두탈립기",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.yanmar.com/kr/",
        "title": "얀마 PBTA1200 자주식 대두탈립기 공식 제원",
        "note": "5.9PS, 515kg, 시간당 300~700kg",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "엔진 배기량",
      "연료탱크 용량"
    ]
  },
  {
    "id": "daedong-hc155gs",
    "brand": "대동모빌리티",
    "model": "HC155GS",
    "machineType": "rotavator",
    "role": "implement",
    "specs": {
      "workingWidthMm": 1550,
      "publishedTractorPowerRange": {
        "min": 30,
        "max": 38,
        "unit": "마력(원문)",
        "basis": "unspecified"
      }
    },
    "facts": [
      [
        "구분",
        "소형 일반형 로타베이터 (GS 시리즈)"
      ],
      [
        "작업 폭",
        "155 cm (1,550 mm 급)"
      ],
      [
        "적용 트랙터",
        "30 ~ 38 마력"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "대동 소형 트랙터 3점 히치 Cat I + PTO 540 rpm 확인 필요",
      "hitchCategory": "Cat I",
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": [
        540
      ]
    },
    "sources": [
      {
        "url": "https://www.daedongmobility.co.kr/",
        "title": "대동모빌리티 HC155GS 로타베이터 사양",
        "note": "제조사 공식 작업기 라인업",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "기체 중량",
      "정확한 외형 치수"
    ]
  },
  {
    "id": "daedong-hc165gs",
    "brand": "대동모빌리티",
    "model": "HC165GS",
    "machineType": "rotavator",
    "role": "implement",
    "specs": {
      "workingWidthMm": 1650,
      "publishedTractorPowerRange": {
        "min": 35,
        "max": 40,
        "unit": "마력(원문)",
        "basis": "unspecified"
      }
    },
    "facts": [
      [
        "구분",
        "소형 일반형 로타베이터 (GS 시리즈)"
      ],
      [
        "작업 폭",
        "165 cm (1,650 mm 급)"
      ],
      [
        "적용 트랙터",
        "35 ~ 40 마력"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 Cat I + PTO 540 rpm 확인 필요",
      "hitchCategory": "Cat I",
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": [
        540
      ]
    },
    "sources": [
      {
        "url": "https://www.daedongmobility.co.kr/",
        "title": "대동모빌리티 HC165GS 로타베이터 사양",
        "note": "제조사 공식 작업기 라인업",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "기체 중량",
      "정확한 외형 치수"
    ]
  },
  {
    "id": "daedong-hc175gs",
    "brand": "대동모빌리티",
    "model": "HC175GS",
    "machineType": "rotavator",
    "role": "implement",
    "specs": {
      "workingWidthMm": 1750,
      "publishedTractorPowerRange": {
        "min": 40,
        "max": 45,
        "unit": "마력(원문)",
        "basis": "unspecified"
      }
    },
    "facts": [
      [
        "구분",
        "소형 일반형 로타베이터 (GS 시리즈)"
      ],
      [
        "작업 폭",
        "175 cm (1,750 mm 급)"
      ],
      [
        "적용 트랙터",
        "40 ~ 45 마력"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 Cat I + PTO 540 rpm 확인 필요",
      "hitchCategory": "Cat I",
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": [
        540
      ]
    },
    "sources": [
      {
        "url": "https://www.daedongmobility.co.kr/",
        "title": "대동모빌리티 HC175GS 로타베이터 사양",
        "note": "제조사 공식 작업기 라인업",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "기체 중량",
      "정확한 외형 치수"
    ]
  },
  {
    "id": "daedong-hc150os",
    "brand": "대동모빌리티",
    "model": "HC150OS",
    "machineType": "rotavator",
    "role": "implement",
    "specs": {
      "workingWidthMm": 1500,
      "publishedTractorPowerRange": {
        "min": 19,
        "max": 28,
        "unit": "마력(원문)",
        "basis": "unspecified"
      }
    },
    "facts": [
      [
        "구분",
        "소형 편심이동식 로타베이터 (하우스·과수원용 OS 시리즈)"
      ],
      [
        "작업 폭",
        "150 cm (1,500 mm 급)"
      ],
      [
        "적용 트랙터",
        "19 ~ 28 마력"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "소형 트랙터 3점 히치 Cat I + PTO 540 rpm 확인 필요",
      "hitchCategory": "Cat I",
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": [
        540
      ]
    },
    "sources": [
      {
        "url": "https://www.daedongmobility.co.kr/",
        "title": "대동모빌리티 HC150OS 로타베이터 사양",
        "note": "제조사 공식 작업기 라인업",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "기체 중량",
      "편심 이동량"
    ]
  },
  {
    "id": "wecan-mgw205",
    "brand": "위캔글로벌",
    "model": "MGW 2050",
    "machineType": "rotavator",
    "role": "implement",
    "specs": {
      "workingWidthMm": 2050,
      "bladeCount": 48,
      "publishedTractorPowerRange": {
        "min": 70,
        "max": 90,
        "unit": "HP",
        "basis": "unspecified"
      }
    },
    "facts": [
      [
        "구분",
        "산간·밭 전용 로타베이터 (MGW 시리즈)"
      ],
      [
        "작업 폭",
        "2,050 mm"
      ],
      [
        "경운날",
        "48개"
      ],
      [
        "적용 마력",
        "70 ~ 90 HP"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "중대형 트랙터 3점 히치(Cat II 확인) + PTO 540/750 rpm 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": [
        540
      ]
    },
    "sources": [
      {
        "url": "https://wecan21.com/",
        "title": "위캔글로벌 MGW 2050 제원",
        "note": "제조사 공식 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "기체 중량",
      "외형 치수",
      "핀 직경"
    ]
  },
  {
    "id": "wecan-mgw260",
    "brand": "위캔글로벌",
    "model": "MGW 2600",
    "machineType": "rotavator",
    "role": "implement",
    "specs": {
      "workingWidthMm": 2600,
      "bladeCount": 60,
      "publishedTractorPowerRange": {
        "min": 95,
        "max": 120,
        "unit": "HP",
        "basis": "unspecified"
      }
    },
    "facts": [
      [
        "구분",
        "대형 산간·밭 전용 로타베이터 (MGW 시리즈)"
      ],
      [
        "작업 폭",
        "2,600 mm"
      ],
      [
        "경운날",
        "60개"
      ],
      [
        "적용 마력",
        "95 ~ 120 HP"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "대형 트랙터 3점 히치(Cat II 확인) + PTO 확인 필요",
      "hitchCategory": "Cat II",
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": [
        540,
        1000
      ]
    },
    "sources": [
      {
        "url": "https://wecan21.com/",
        "title": "위캔글로벌 MGW 2600 제원",
        "note": "제조사 공식 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "기체 중량",
      "외형 치수",
      "PTO 스플라인 규격"
    ]
  },
  {
    "id": "greenmax-gmr185",
    "brand": "그린맥스",
    "model": "일반형 로타베이터 185 (NA/HR 계열)",
    "machineType": "rotavator",
    "role": "implement",
    "specs": {
      "workingWidthMm": 1850
    },
    "facts": [
      [
        "구분",
        "중소형 트랙터 범용·편심이동 로타베이터"
      ],
      [
        "작업 폭",
        "185 cm (1,850 mm 급)"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 + PTO 540 rpm 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": [
        540
      ]
    },
    "sources": [
      {
        "url": "https://www.greenmax.co.kr/",
        "title": "그린맥스 로타베이터 라인업",
        "note": "제조사 공식 제품군",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "권장 마력 범위",
      "기체 중량",
      "세부 형식별 치수"
    ]
  },
  {
    "id": "woongjin-w42dp",
    "brand": "웅진기계",
    "model": "W42-DP",
    "machineType": "plow",
    "role": "implement",
    "specs": {
      "workingWidthMm": 1200,
      "weightKg": 340,
      "publishedTractorPowerRange": {
        "min": 19,
        "max": 35,
        "unit": "HP",
        "basis": "unspecified"
      }
    },
    "facts": [
      [
        "구분",
        "소형 트랙터용 논 전용 구동식 원판쟁기 (4련)"
      ],
      [
        "경운 폭",
        "1,200 mm"
      ],
      [
        "중량",
        "340 kg"
      ],
      [
        "적용 마력",
        "19 ~ 35 HP"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "소형 트랙터 3점 히치 Cat I + PTO 구동 확인 필요",
      "hitchCategory": "Cat I",
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": [
        540
      ]
    },
    "sources": [
      {
        "url": "https://www.komachine.com/",
        "title": "웅진기계 W42-DP 원판쟁기 제원",
        "note": "제조사 카탈로그 제원",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "외형 치수",
      "핀 직경"
    ]
  },
  {
    "id": "woongjin-w82dp",
    "brand": "웅진기계",
    "model": "W82-DP",
    "machineType": "plow",
    "role": "implement",
    "specs": {
      "workingWidthMm": 2300,
      "weightKg": 640,
      "publishedTractorPowerRange": {
        "min": 55,
        "max": 80,
        "unit": "HP",
        "basis": "unspecified"
      }
    },
    "facts": [
      [
        "구분",
        "중대형 트랙터용 논 전용 구동식 원판쟁기 (8련)"
      ],
      [
        "경운 폭",
        "2,300 mm"
      ],
      [
        "중량",
        "640 kg"
      ],
      [
        "적용 마력",
        "55 ~ 80 HP"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "중대형 트랙터 3점 히치 Cat II + PTO 구동 확인 필요",
      "hitchCategory": "Cat II",
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": [
        540
      ]
    },
    "sources": [
      {
        "url": "https://www.komachine.com/",
        "title": "웅진기계 W82-DP 원판쟁기 제원",
        "note": "제조사 카탈로그 제원",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "외형 치수",
      "핀 직경"
    ]
  },
  {
    "id": "youngjin-ydp602sh",
    "brand": "영진기계",
    "model": "YDP602S-H",
    "machineType": "plow",
    "role": "implement",
    "specs": {
      "workingWidthMm": 1950,
      "weightKg": 437,
      "publishedTractorPowerRange": {
        "min": 35,
        "max": 52,
        "unit": "HP",
        "basis": "unspecified"
      }
    },
    "facts": [
      [
        "구분",
        "센터드라이브식 원판쟁기 (8스크류 급)"
      ],
      [
        "작업 폭",
        "195 cm (1,950 mm)"
      ],
      [
        "중량",
        "437 kg"
      ],
      [
        "적용 마력",
        "35 ~ 52 HP"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 + PTO 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": [
        540
      ]
    },
    "sources": [
      {
        "url": "https://www.youngjinrotary.co.kr/",
        "title": "영진기계 YDP602S-H 원판쟁기 제원",
        "note": "제조사 공식 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "외형 치수",
      "3점 히치 카테고리"
    ]
  },
  {
    "id": "youngjin-yph1901",
    "brand": "영진기계",
    "model": "YPH1901",
    "machineType": "plow",
    "role": "implement",
    "specs": {
      "workingWidthMm": 1900,
      "weightKg": 600,
      "publishedTractorPowerRange": {
        "min": 40,
        "max": 75,
        "unit": "HP",
        "basis": "unspecified"
      }
    },
    "facts": [
      [
        "구분",
        "유압반전쟁기 (YP 시리즈)"
      ],
      [
        "작업 폭",
        "190 cm (1,900 mm)"
      ],
      [
        "중량",
        "600 kg"
      ],
      [
        "적용 마력",
        "40 ~ 75 HP"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 + 외부 유압 포트 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.youngjinrotary.co.kr/",
        "title": "영진기계 YPH1901 유압반전쟁기 제원",
        "note": "제조사 공식 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "외형 치수",
      "외부 유압 포트 요구 개수",
      "히치 카테고리"
    ]
  },
  {
    "id": "greenmax-gmr165sk",
    "brand": "그린맥스",
    "model": "GMR165SK",
    "machineType": "plow",
    "role": "implement",
    "specs": {
      "workingWidthMm": 1650,
      "tillageDepthMm": 400
    },
    "facts": [
      [
        "구분",
        "심경 로타베이터 겸용 쟁기 (SK 시리즈)"
      ],
      [
        "작업 폭",
        "165 cm (1,650 mm 급)"
      ],
      [
        "심경 깊이",
        "약 40 cm 심경 작업 + 쇄토·평탄 동시 수행"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "중소형 트랙터 3점 히치 + PTO 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": [
        540
      ]
    },
    "sources": [
      {
        "url": "https://www.greenmax.co.kr/",
        "title": "그린맥스 GMR165SK 심경쟁기 사양",
        "note": "제조사 공식 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "권장 트랙터 마력 범위",
      "기체 중량"
    ]
  },
  {
    "id": "dooroo-drb1200p",
    "brand": "두루기계통상",
    "model": "DRB-1200P",
    "machineType": "ridgeMulcher",
    "role": "implement",
    "specs": {
      "publishedTractorPowerRange": {
        "min": 60,
        "max": null,
        "unit": "HP",
        "basis": "unspecified"
      }
    },
    "facts": [
      [
        "용도",
        "마늘·양파용 휴립복토기 (약살포·비닐피복 동시)"
      ],
      [
        "형식",
        "트랙터 부착형 · 기대 고정식"
      ],
      [
        "적용 마력",
        "60 HP 이상 트랙터"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 + PTO · 60HP 이상 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.dooroo21.com/",
        "title": "두루기계통상 DRB-1200P 제원",
        "note": "제조사 공식 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "외형 치수",
      "기체 중량",
      "3점 히치 카테고리"
    ]
  },
  {
    "id": "bulls-bg1220",
    "brand": "불스",
    "model": "BG-1220",
    "machineType": "ridgeMulcher",
    "role": "implement",
    "specs": {
      "publishedTractorPowerRange": {
        "min": 40,
        "max": null,
        "unit": "HP",
        "basis": "unspecified"
      }
    },
    "facts": [
      [
        "구분",
        "다목적 휴립복토기 (BG-1220: 40HP / BG-1220A: 54HP)"
      ],
      [
        "작업 기능",
        "휴립 · 두둑성형 · 비닐피복 동시 수행 (약액 탱크 옵션)"
      ],
      [
        "적용 마력",
        "40 ~ 54 HP 이상"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 + PTO · 40HP 이상 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": [
        540
      ]
    },
    "sources": [
      {
        "url": "https://www.ibulls.co.kr/",
        "title": "불스 BG-1220 다목적 휴립복토기",
        "note": "제조사 공식 제품 페이지",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "외형 치수",
      "기체 중량",
      "3점 히치 카테고리"
    ]
  },
  {
    "id": "bulls-bg1300a",
    "brand": "불스",
    "model": "BG-1300A",
    "machineType": "ridgeMulcher",
    "role": "implement",
    "specs": {
      "publishedTractorPowerRange": {
        "min": 48,
        "max": null,
        "unit": "HP",
        "basis": "unspecified"
      }
    },
    "facts": [
      [
        "구분",
        "마늘·양파·쪽파용 진압로울러형 휴립복토기"
      ],
      [
        "작업 기능",
        "두둑성형 + 약액살포 + 비닐피복 동시 작업"
      ],
      [
        "적용 마력",
        "48 HP 이상"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 + PTO · 48HP 이상 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": [
        540
      ]
    },
    "sources": [
      {
        "url": "https://www.ibulls.co.kr/",
        "title": "불스 BG-1300A 진압로울러형 휴립복토기",
        "note": "제조사 공개 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "외형 치수",
      "기체 중량",
      "3점 히치 카테고리"
    ]
  },
  {
    "id": "bulls-bg2600br",
    "brand": "불스",
    "model": "BG-2600BR",
    "machineType": "ridgeMulcher",
    "role": "implement",
    "specs": {
      "publishedTractorPowerRange": {
        "min": 80,
        "max": null,
        "unit": "HP",
        "basis": "unspecified"
      }
    },
    "facts": [
      [
        "구분",
        "트랙터 부착식 2두둑 대형 휴립피복기 (흙올림 기능)"
      ],
      [
        "적용 마력",
        "80 HP 이상"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "대형 트랙터 3점 히치 Cat II + PTO · 80HP 이상 확인 필요",
      "hitchCategory": "Cat II",
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": [
        540
      ]
    },
    "sources": [
      {
        "url": "https://www.g2b.go.kr/",
        "title": "나라장터 불스 BG-2600BR 조달 규격",
        "note": "조달청 나라장터 등록 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "외형 치수",
      "기체 중량"
    ]
  },
  {
    "id": "taekwang-tfm800",
    "brand": "태광공업",
    "model": "TFM-800",
    "machineType": "ridgeMulcher",
    "role": "implement",
    "specs": {
      "workingWidthMm": [
        400,
        800
      ],
      "ridgeHeightMm": [
        200,
        300
      ]
    },
    "facts": [
      [
        "구분",
        "보행 관리기 부착용 휴립피복기 (휴립기 TF-800)"
      ],
      [
        "작업 폭 / 높이",
        "40 ~ 80 cm / 높이 20 ~ 30 cm"
      ],
      [
        "적용 본체",
        "태광 다목적 관리기 TKC-850 / TKC-1000 등 (7~10마력급)"
      ]
    ],
    "connection": {
      "hostType": "cultivator",
      "label": "태광 다목적 관리기 전용 부착 방식 (트랙터 비호환)",
      "hitchCategory": "태광 관리기 전용",
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.tkam.kr/",
        "title": "태광공업 TFM-800 휴립피복기",
        "note": "제조사 공식 제품 페이지",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "기체 중량",
      "외형 치수",
      "타사 관리기 호환 여부"
    ]
  },
  {
    "id": "asia-fm2120d",
    "brand": "아세아텍",
    "model": "FM-2120D",
    "machineType": "ridgeMulcher",
    "role": "implement",
    "specs": {},
    "facts": [
      [
        "구분",
        "디젤 승용관리기 전용 휴립피복기"
      ],
      [
        "적용 본체",
        "아세아 디젤 승용관리기 전용 부착"
      ]
    ],
    "connection": {
      "hostType": "ridingCultivator",
      "label": "아세아 디젤 승용관리기 전용 부착 방식",
      "hitchCategory": "아세아 승용관리기 전용",
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.asiakor.com/",
        "title": "아세아텍 승용관리기용 FM-2120D",
        "note": "제조사 공식 제품군",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "외형 치수",
      "기체 중량",
      "두둑 폭 범위"
    ]
  },
  {
    "id": "dooroo-drp1002ar",
    "brand": "두루기계통상",
    "model": "DRP-1002AR",
    "machineType": "potatoPlanter",
    "role": "implement",
    "specs": {
      "rows": 2,
      "weightKg": 1050,
      "publishedTractorPowerRange": {
        "min": 55,
        "max": null,
        "unit": "HP",
        "basis": "unspecified"
      }
    },
    "facts": [
      [
        "구분",
        "트랙터 부착형 전자동 감자파종기 (통감자 절단 기능 포함 사양)"
      ],
      [
        "중량",
        "약 1,050 kg 내외"
      ],
      [
        "적용 마력",
        "55 HP 이상"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 + PTO · 55HP 이상 및 1,050kg 승강력 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.dooroo21.com/",
        "title": "두루기계통상 DRP-1002AR 전자동 감자파종기",
        "note": "제조사 공식 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "외형 치수",
      "3점 히치 카테고리",
      "PTO 입력 회전수"
    ]
  },
  {
    "id": "dooroo-drp2000rn",
    "brand": "두루기계통상",
    "model": "DRP-2000RN",
    "machineType": "potatoPlanter",
    "role": "implement",
    "specs": {},
    "facts": [
      [
        "구분",
        "트랙터 부착형 반자동 감자파종기 (경운·두둑·파종·멀칭 일관 작업)"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 + PTO 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.dooroo21.com/",
        "title": "두루기계통상 DRP-2000RN 반자동 감자파종기",
        "note": "신기술 농업기계 지정 모델",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "권장 마력 범위",
      "기체 중량",
      "외형 치수"
    ]
  },
  {
    "id": "bulls-bg1800sm",
    "brand": "불스",
    "model": "BG-1800SM",
    "machineType": "potatoPlanter",
    "role": "implement",
    "specs": {
      "dimensionsMm": [
        2300,
        2300,
        1010
      ],
      "weightKg": 590,
      "publishedTractorPowerRange": {
        "min": 45,
        "max": null,
        "unit": "HP",
        "basis": "unspecified"
      }
    },
    "facts": [
      [
        "구분",
        "휴립복토 일체형 다목적 파종기 (채소·감자·콩 등)"
      ],
      [
        "크기 / 중량",
        "2,300 × 2,300 × 1,010 mm / 590 kg"
      ],
      [
        "적용 마력",
        "45 HP 이상"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 + PTO · 45HP 이상 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.ibulls.co.kr/",
        "title": "불스 BG-1800SM 파종기 제원",
        "note": "제조사 및 다아라기계장터 등록 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "조수 및 주간 조절 범위",
      "3점 히치 카테고리"
    ]
  },
  {
    "id": "dooroo-drp1007sg",
    "brand": "두루기계통상",
    "model": "DRP-1007SG",
    "machineType": "garlicOnionPlanter",
    "role": "implement",
    "specs": {
      "rows": 7,
      "dimensionsMm": [
        1800,
        1880,
        1770
      ],
      "seedHopperL": 210,
      "publishedTractorPowerRange": {
        "min": 70,
        "max": null,
        "unit": "HP",
        "basis": "unspecified"
      }
    },
    "facts": [
      [
        "파종 조수",
        "7조 (두둑폭 110~130cm · 주간 8~16cm)"
      ],
      [
        "크기",
        "1,800 × 1,880 × 1,770 mm"
      ],
      [
        "종자함",
        "210 L (약 100 kg)"
      ],
      [
        "필요 트랙터",
        "70 HP 이상 권장"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 + PTO · 70HP 이상 승강력 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.dooroo21.com/",
        "title": "두루기계통상 DRP-1007SG 마늘 파종기 제원",
        "note": "제조사 공식 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "정확한 중량(1,085~1,280kg 범위 내)",
      "3점 히치 카테고리"
    ]
  },
  {
    "id": "dooroo-drp1008sg",
    "brand": "두루기계통상",
    "model": "DRP-1008SG",
    "machineType": "garlicOnionPlanter",
    "role": "implement",
    "specs": {
      "rows": 8,
      "dimensionsMm": [
        1800,
        1880,
        1770
      ],
      "weightKg": 1135,
      "seedHopperL": 210,
      "publishedTractorPowerRange": {
        "min": 70,
        "max": null,
        "unit": "HP",
        "basis": "unspecified"
      }
    },
    "facts": [
      [
        "파종 조수",
        "8조 (두둑폭 110~130cm · 주간 8~16cm)"
      ],
      [
        "크기",
        "1,800 × 1,880 × 1,770 mm"
      ],
      [
        "중량",
        "약 1,135 kg (피복기 부착 시 약 1,280 kg)"
      ],
      [
        "필요 트랙터",
        "70 HP 이상 권장"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 + PTO · 70HP 이상 및 1,280kg 승강력 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.dooroo21.com/",
        "title": "두루기계통상 DRP-1008SG 마늘 파종기 제원",
        "note": "제조사 공식 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "3점 히치 카테고리",
      "PTO 입력 회전수"
    ]
  },
  {
    "id": "hada-ktgp7",
    "brand": "하다",
    "model": "HADA-KTGP7",
    "machineType": "garlicOnionPlanter",
    "role": "implement",
    "specs": {
      "rows": 7,
      "weightKg": 600,
      "ridgeWidthMm": 1100,
      "publishedTractorPowerRange": {
        "min": 50,
        "max": null,
        "unit": "HP",
        "basis": "unspecified"
      }
    },
    "facts": [
      [
        "파종 조수",
        "7조 조파식 (파종 + 농약살포 + 비닐멀칭 일관)"
      ],
      [
        "두둑 폭 / 중량",
        "110 cm / 600 kg"
      ],
      [
        "적용 마력",
        "50 HP 이상"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 + PTO · 50HP 이상 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.hada-korea.com/",
        "title": "하다 HADA-KTGP7 마늘파종기 제원",
        "note": "제조사 공식 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "외형 치수",
      "3점 히치 카테고리"
    ]
  },
  {
    "id": "hada-ktgp8",
    "brand": "하다",
    "model": "HADA-KTGP8",
    "machineType": "garlicOnionPlanter",
    "role": "implement",
    "specs": {
      "rows": 8,
      "weightKg": 620,
      "ridgeWidthMm": 1200,
      "publishedTractorPowerRange": {
        "min": 50,
        "max": null,
        "unit": "HP",
        "basis": "unspecified"
      }
    },
    "facts": [
      [
        "파종 조수",
        "8조 조파식 (파종 + 농약살포 + 비닐멀칭 일관)"
      ],
      [
        "두둑 폭 / 중량",
        "120 cm / 620 kg"
      ],
      [
        "적용 마력",
        "50 HP 이상"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 + PTO · 50HP 이상 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.hada-korea.com/",
        "title": "하다 HADA-KTGP8 마늘파종기 제원",
        "note": "제조사 공식 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "외형 치수",
      "3점 히치 카테고리"
    ]
  },
  {
    "id": "dooroo-drp2004sp",
    "brand": "두루기계통상",
    "model": "DRP-2004SP",
    "machineType": "seeder",
    "role": "implement",
    "specs": {
      "rows": 4,
      "dimensionsMm": [
        2680,
        2935,
        1560
      ],
      "weightKg": 1210,
      "publishedTractorPowerRange": {
        "min": 100,
        "max": null,
        "unit": "HP",
        "basis": "unspecified"
      }
    },
    "facts": [
      [
        "구분",
        "논·밭콩 겸용 4조 일관 파종기 (2두둑 성형 + 파종 + 제초제 살포)"
      ],
      [
        "크기 / 중량",
        "2,680 × 2,935 × 1,560 mm / 1,210 kg"
      ],
      [
        "적용 마력",
        "100 HP 이상"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "대형 트랙터 3점 히치 Cat II + PTO · 100HP 이상 및 1,210kg 승강력 확인 필요",
      "hitchCategory": "Cat II",
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.dooroo21.com/",
        "title": "두루기계통상 DRP-2004SP 콩파종기 제원",
        "note": "제조사 및 조달청 나라장터 등록 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "PTO 입력 회전수",
      "시비기 옵션 장착 시 중량 증가분(DRP-2004SPA 약 1,490kg)"
    ]
  },
  {
    "id": "dooroo-drp2004sb",
    "brand": "두루기계통상",
    "model": "DRP-2004SB",
    "machineType": "seeder",
    "role": "implement",
    "specs": {
      "rows": 4,
      "weightKg": 1180,
      "publishedTractorPowerRange": {
        "min": 85,
        "max": null,
        "unit": "HP",
        "basis": "unspecified"
      }
    },
    "facts": [
      [
        "구분",
        "둥근두둑 성형형 4조 논·밭콩 파종기"
      ],
      [
        "중량",
        "약 1,180 kg"
      ],
      [
        "적용 마력",
        "85 HP 이상"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "대형 트랙터 3점 히치 Cat II + PTO · 85HP 이상 확인 필요",
      "hitchCategory": "Cat II",
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.dooroo21.com/",
        "title": "두루기계통상 DRP-2004SB 제원",
        "note": "제조사 공식 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "외형 치수",
      "PTO 입력 회전수"
    ]
  },
  {
    "id": "dooroo-drp1002sp",
    "brand": "두루기계통상",
    "model": "DRP-1002SP",
    "machineType": "seeder",
    "role": "implement",
    "specs": {
      "rows": 2,
      "weightKg": 835
    },
    "facts": [
      [
        "구분",
        "1두둑 2조식 논·밭콩 파종기"
      ],
      [
        "중량",
        "약 835 kg"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "중형 트랙터 3점 히치 + PTO · 835kg 승강력 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.dooroo21.com/",
        "title": "두루기계통상 DRP-1002SP 제원",
        "note": "제조사 공식 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "권장 트랙터 마력 범위",
      "외형 치수"
    ]
  },
  {
    "id": "jang-jdtf3r",
    "brand": "장자동화",
    "model": "JDTF-3R",
    "machineType": "seeder",
    "role": "implement",
    "specs": {
      "rows": 3,
      "publishedTractorPowerRange": {
        "min": 70,
        "max": 100,
        "unit": "HP",
        "basis": "unspecified"
      }
    },
    "facts": [
      [
        "구분",
        "트랙터 부착형 3조 콩·옥수수 정밀 파종기"
      ],
      [
        "적용 마력",
        "70 ~ 100 HP"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 + PTO · 70~100HP 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.kamico.or.kr/",
        "title": "KAMICO 장자동화 JDTF-3R 제원",
        "note": "한국농기계공업협동조합 목록집",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "기체 중량",
      "외형 치수",
      "3점 히치 카테고리"
    ]
  },
  {
    "id": "jang-jas502c",
    "brand": "장자동화",
    "model": "JAS-502C",
    "machineType": "seeder",
    "role": "standalone",
    "specs": {
      "rows": 5,
      "weightKg": 83,
      "nominalPowerPs": 3.5
    },
    "facts": [
      [
        "구분",
        "동력형 5조 보행식 진공/롤식 정밀 파종기 (하우스·소규모 밭용)"
      ],
      [
        "중량 / 엔진",
        "83 kg / 3.5 HP 자체 엔진"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "자체 엔진 구동 · 트랙터/관리기 연결 불필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.jangauto.com/",
        "title": "장자동화 JAS-502C 동력 파종기 제원",
        "note": "제조사 공식 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "외형 치수",
      "연료탱크 용량"
    ]
  },
  {
    "id": "dooroo-dr700vc",
    "brand": "두루기계통상",
    "model": "DR-700VC",
    "machineType": "potatoHarvester",
    "role": "implement",
    "specs": {
      "workingWidthMm": 700,
      "dimensionsMm": [
        1540,
        940,
        960
      ],
      "weightKg": 230,
      "publishedTractorPowerRange": {
        "min": 18,
        "max": 26,
        "unit": "HP",
        "basis": "unspecified"
      }
    },
    "facts": [
      [
        "구분",
        "소형 트랙터용 1두둑 감자·고구마 수확기"
      ],
      [
        "작업 폭 / 중량",
        "700 mm / 약 230 kg"
      ],
      [
        "크기",
        "1,540 × 940 × 960 mm"
      ],
      [
        "적용 마력",
        "18 ~ 26 HP"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "소형 트랙터 3점 히치 Cat I + PTO 확인 필요",
      "hitchCategory": "Cat I",
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": [
        540
      ]
    },
    "sources": [
      {
        "url": "https://www.dooroo21.com/",
        "title": "두루기계통상 DR-700VC 제원",
        "note": "제조사 및 농기계 정보 포털 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "핀 직경",
      "PTO 입력 회전수"
    ]
  },
  {
    "id": "dooroo-dr1300cp",
    "brand": "두루기계통상",
    "model": "DR-1300CP",
    "machineType": "potatoHarvester",
    "role": "implement",
    "specs": {
      "workingWidthMm": 1300,
      "weightKg": 650,
      "publishedTractorPowerRange": {
        "min": 50,
        "max": null,
        "unit": "HP",
        "basis": "unspecified"
      }
    },
    "facts": [
      [
        "구분",
        "2두둑 동시 수확 고구마 전용 수확기 (CP 시리즈)"
      ],
      [
        "작업 폭 / 중량",
        "1,300 mm / 650 kg"
      ],
      [
        "적용 마력",
        "50 HP 이상"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "중형 트랙터 3점 히치 + PTO · 50HP 이상 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": [
        540
      ]
    },
    "sources": [
      {
        "url": "https://www.dooroo21.com/",
        "title": "두루기계통상 DR-1300CP 제원",
        "note": "제조사 공식 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "외형 치수",
      "3점 히치 카테고리"
    ]
  },
  {
    "id": "dooroo-dr1100g",
    "brand": "두루기계통상",
    "model": "DR-1100G",
    "machineType": "potatoHarvester",
    "role": "implement",
    "specs": {
      "workingWidthMm": 1100,
      "weightKg": 465,
      "publishedTractorPowerRange": {
        "min": 43,
        "max": null,
        "unit": "HP",
        "basis": "unspecified"
      }
    },
    "facts": [
      [
        "구분",
        "2두둑 고구마 전용 이송식 수확기"
      ],
      [
        "작업 폭 / 중량",
        "1,100 mm / 465 kg"
      ],
      [
        "적용 마력",
        "43 ~ 55 HP 이상"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 + PTO · 43HP 이상 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": [
        540
      ]
    },
    "sources": [
      {
        "url": "https://www.dooroo21.com/",
        "title": "두루기계통상 DR-1100G 제원",
        "note": "제조사 공식 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "외형 치수",
      "3점 히치 카테고리"
    ]
  },
  {
    "id": "daeshin-ds650",
    "brand": "대신종합농기계",
    "model": "DS-650",
    "machineType": "potatoHarvester",
    "role": "implement",
    "specs": {
      "workingWidthMm": 650,
      "publishedTractorPowerRange": {
        "min": 6,
        "max": 10,
        "unit": "마력(원문)",
        "basis": "cultivator/tiller"
      }
    },
    "facts": [
      [
        "구분",
        "관리기·경운기 부착형 진동봉 땅속작물(감자·고구마) 굴취기"
      ],
      [
        "작업 폭",
        "약 65 cm (1두둑용)"
      ],
      [
        "적용 본체",
        "6~10마력급 아세아 관리기 및 경운기"
      ]
    ],
    "connection": {
      "hostType": "cultivator",
      "label": "관리기/경운기 후방 히치 부착형 (지자체 임대사업소 보급형)",
      "hitchCategory": "관리기·경운기용",
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.yeosu.go.kr/",
        "title": "지자체 농기계임대사업소 DS-650 굴취기 목록",
        "note": "여수시 농기계임대사업소 공개 임대 목록",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "정확한 중량(약 50~60kg 내외)",
      "연결 핀 규격"
    ]
  },
  {
    "id": "dooroo-dr1200co",
    "brand": "두루기계통상",
    "model": "DR-1200CO",
    "machineType": "rootHarvester",
    "role": "implement",
    "specs": {
      "workingWidthMm": 1200,
      "weightKg": 610,
      "publishedTractorPowerRange": {
        "min": 50,
        "max": null,
        "unit": "마력(원문)",
        "basis": "unspecified"
      }
    },
    "facts": [
      [
        "구분",
        "마늘·감자·양파 겸용 수확기 (CO 계열)"
      ],
      [
        "작업 폭 / 중량",
        "1,200 mm / 약 610 kg"
      ],
      [
        "적용 마력",
        "50 ~ 55 마력 이상"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 + PTO · 50마력 이상 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": [
        540
      ]
    },
    "sources": [
      {
        "url": "https://www.dooroo21.com/",
        "title": "두루기계통상 DR-1200CO 제원",
        "note": "제조사 공식 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "외형 치수",
      "3점 히치 카테고리"
    ]
  },
  {
    "id": "dooroo-drg900",
    "brand": "두루기계통상",
    "model": "DRG-900",
    "machineType": "rootHarvester",
    "role": "implement",
    "specs": {
      "workingWidthMm": 900,
      "weightKg": 112,
      "publishedTractorPowerRange": {
        "min": 10,
        "max": null,
        "unit": "마력(원문)",
        "basis": "tiller"
      }
    },
    "facts": [
      [
        "구분",
        "경운기용 진동식 땅속작물 수확기"
      ],
      [
        "작업 폭 / 중량",
        "900 mm / 112 kg"
      ],
      [
        "적용 본체",
        "10마력 이상 경운기"
      ]
    ],
    "connection": {
      "hostType": "tiller",
      "label": "경운기 전용 연결 방식 (트랙터·관리기 비호환)",
      "hitchCategory": "경운기 전용",
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.dooroo21.com/",
        "title": "두루기계통상 DRG-900 경운기용 수확기 제원",
        "note": "제조사 공식 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "외형 치수",
      "경운기 미션 연결 규격"
    ]
  },
  {
    "id": "bulls-bg1200sc",
    "brand": "불스",
    "model": "BG-1200SC",
    "machineType": "rootHarvester",
    "role": "implement",
    "specs": {
      "dimensionsMm": [
        1670,
        1780,
        1230
      ],
      "weightKg": 340,
      "publishedTractorPowerRange": {
        "min": 35,
        "max": null,
        "unit": "마력(원문)",
        "basis": "unspecified"
      }
    },
    "facts": [
      [
        "구분",
        "양파·마늘 자동 줄기절단기"
      ],
      [
        "크기 / 중량",
        "1,670 × 1,780 × 1,230 mm / 340 kg"
      ],
      [
        "적용 마력",
        "35 마력 이상 (트랙터·승용관리기 부착 가능)"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 또는 승용관리기 부착 · 35마력 이상 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.ibulls.co.kr/",
        "title": "불스 BG-1200SC 줄기절단기 제원",
        "note": "제조사 공식 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "승용관리기 부착 시 별도 브라켓 규격",
      "PTO 요구 회전수"
    ]
  },
  {
    "id": "bulls-bg1500h",
    "brand": "불스",
    "model": "BG-1500H",
    "machineType": "rootHarvester",
    "role": "implement",
    "specs": {
      "publishedTractorPowerRange": {
        "min": 40,
        "max": null,
        "unit": "마력(원문)",
        "basis": "unspecified"
      }
    },
    "facts": [
      [
        "구분",
        "양파·마늘 땅속작물 수확기 (신기술 지정 모델)"
      ],
      [
        "적용 마력",
        "40 ~ 55 마력 이상"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 + PTO · 40마력 이상 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.ibulls.co.kr/",
        "title": "불스 BG-1500H 수확기",
        "note": "제조사 및 다아라기계장터 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "외형 치수",
      "정확한 기체 중량",
      "3점 히치 카테고리"
    ]
  },
  {
    "id": "hyundai-hdpc900",
    "brand": "현대농기계",
    "model": "HD-PC900",
    "machineType": "rootHarvester",
    "role": "implement",
    "specs": {
      "dimensionsMm": [
        3750,
        2210,
        1375
      ],
      "weightKg": 1100,
      "publishedTractorPowerRange": {
        "min": 55,
        "max": null,
        "unit": "마력(원문)",
        "basis": "unspecified"
      }
    },
    "facts": [
      [
        "구분",
        "트랙터 부착형 수집형 마늘·감자·양파 수확기"
      ],
      [
        "크기 / 중량",
        "3,750 × 2,210 × 1,375 mm / 1,100 kg"
      ],
      [
        "연결 방식",
        "트랙터 2점 링크 + PTO 540 rpm"
      ],
      [
        "적용 마력",
        "55 마력 이상"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 2점 링크 + PTO 540 rpm · 55마력 이상 확인 필요",
      "hitchCategory": "2점 링크",
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": [
        540
      ]
    },
    "sources": [
      {
        "url": "https://www.hd-agrimachine.com/",
        "title": "현대농기계 HD-PC900 수집형 수확기 제원",
        "note": "제조사 및 농축유통신문 보도 제원",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "외부 유압 포트 요구 개수",
      "적재 톤백 용량"
    ]
  },
  {
    "id": "daedong-az350ch",
    "brand": "대동",
    "model": "AZ-350CH",
    "machineType": "ridger",
    "role": "implement",
    "specs": {
      "workingWidthMm": [
        300,
        400
      ],
      "weightKg": 320,
      "publishedTractorPowerRange": {
        "min": 40,
        "max": 65,
        "unit": "마력(원문)",
        "basis": "unspecified"
      }
    },
    "facts": [
      [
        "구분",
        "트랙터 부착형 유압식 논두렁조성기"
      ],
      [
        "작업 폭 / 중량",
        "약 30~40 cm / 약 320 kg"
      ],
      [
        "적용 트랙터",
        "40 ~ 65 마력"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 + PTO + 유압 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": [
        540
      ]
    },
    "sources": [
      {
        "url": "https://www.youngjinrotary.co.kr/",
        "title": "대동 AZ-350CH 논두렁조성기 제원",
        "note": "농기계 사양 자료",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "외형 치수",
      "3점 히치 카테고리"
    ]
  },
  {
    "id": "daedong-az700ch",
    "brand": "대동",
    "model": "AZ-700CH",
    "machineType": "ridger",
    "role": "implement",
    "specs": {
      "workingWidthMm": [
        300,
        400
      ],
      "weightKg": 324,
      "publishedTractorPowerRange": {
        "min": 60,
        "max": 90,
        "unit": "마력(원문)",
        "basis": "unspecified"
      }
    },
    "facts": [
      [
        "구분",
        "중대형 트랙터 부착형 유압식 논두렁조성기"
      ],
      [
        "작업 폭 / 중량",
        "약 30~40 cm / 약 324 kg"
      ],
      [
        "적용 트랙터",
        "60 ~ 90 마력"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 + PTO + 유압 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": [
        540
      ]
    },
    "sources": [
      {
        "url": "https://www.youngjinrotary.co.kr/",
        "title": "대동 AZ-700CH 논두렁조성기 제원",
        "note": "농기계 사양 자료",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "외형 치수",
      "3점 히치 카테고리"
    ]
  },
  {
    "id": "wecan-lpm500",
    "brand": "위캔글로벌",
    "model": "LPM500",
    "machineType": "ridger",
    "role": "implement",
    "specs": {
      "weightKg": 520,
      "publishedTractorPowerRange": {
        "min": 35,
        "max": 60,
        "unit": "마력(원문)",
        "basis": "unspecified"
      }
    },
    "facts": [
      [
        "구분",
        "분할 디스크롤러 방식 논두렁조성기"
      ],
      [
        "중량",
        "약 520 kg"
      ],
      [
        "적용 트랙터",
        "35 ~ 60 마력"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 + PTO 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": [
        540
      ]
    },
    "sources": [
      {
        "url": "https://wecan21.com/",
        "title": "위캔글로벌 LPM500 논두렁조성기 제원",
        "note": "제조사 공식 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "외형 치수",
      "3점 히치 카테고리"
    ]
  },
  {
    "id": "wecan-lpm700h",
    "brand": "위캔글로벌",
    "model": "LPM700H",
    "machineType": "ridger",
    "role": "implement",
    "specs": {
      "publishedTractorPowerRange": {
        "min": 43,
        "max": 70,
        "unit": "마력(원문)",
        "basis": "unspecified"
      }
    },
    "facts": [
      [
        "구분",
        "고성능 디스크롤러 방식 논두렁조성기"
      ],
      [
        "적용 트랙터",
        "43 ~ 70 마력"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 + PTO + 유압 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": [
        540
      ]
    },
    "sources": [
      {
        "url": "https://www.kamico.or.kr/",
        "title": "KAMICO 위캔글로벌 LPM700H 제원",
        "note": "한국농기계공업협동조합 목록집",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "기체 중량",
      "외형 치수",
      "3점 히치 카테고리"
    ]
  },
  {
    "id": "asia-sdr200n",
    "brand": "아세아텍",
    "model": "SDR-200N (구굴기)",
    "machineType": "ridger",
    "role": "implement",
    "specs": {},
    "facts": [
      [
        "구분",
        "관리기 부착형 구굴기 (표토·심토 혼합 및 북주기·배수로 작업)"
      ],
      [
        "적용 본체",
        "아세아 다목적 관리기 (AMC-600M/630M/900/1000 등)"
      ]
    ],
    "connection": {
      "hostType": "cultivator",
      "label": "아세아 관리기 전용 부착 방식 (트랙터·경운기 비호환)",
      "hitchCategory": "아세아 관리기 전용",
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.asiakor.com/",
        "title": "아세아텍 관리기용 구굴기 SDR-200N",
        "note": "제조사 공식 부속작업기 라인업",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "작업 폭",
      "기체 중량"
    ]
  },
  {
    "id": "woongjin-viking4000c",
    "brand": "웅진기계(익산농기계)",
    "model": "VIKING-4000C",
    "machineType": "spreader",
    "role": "implement",
    "specs": {
      "payloadKg": 4000
    },
    "facts": [
      [
        "구분",
        "셀프 크레인 장착형 대형 트랙터 견인식 살포기"
      ],
      [
        "용량",
        "복합비료 기준 약 4톤 (유기질퇴비 약 2톤)"
      ],
      [
        "구동",
        "트랙터 유압 구동 · 스텐 메쉬 배출"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 드로바 견인 + 유압 연결 · 중대형 트랙터 권장",
      "hitchCategory": "Drawbar",
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.iksanfm.com/",
        "title": "익산농기계 VIKING-4000C 살포기",
        "note": "제조사 공식 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "권장 트랙터 마력 범위",
      "기체 자중"
    ]
  },
  {
    "id": "woongjin-ijd700",
    "brand": "웅진기계(익산농기계)",
    "model": "IJD-700",
    "machineType": "spreader",
    "role": "implement",
    "specs": {
      "payloadKg": 700,
      "spreadWidthM": [
        8,
        16
      ]
    },
    "facts": [
      [
        "구분",
        "트랙터 탑재형 정밀 비료·입제 살포기"
      ],
      [
        "용량 / 살포폭",
        "700 kg (복합비료 기준) / 8 ~ 16 m"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 + PTO 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": [
        540
      ]
    },
    "sources": [
      {
        "url": "https://www.iksanfm.com/",
        "title": "익산농기계 IJD-700 살포기",
        "note": "제조사 공식 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "권장 트랙터 마력 범위",
      "기체 중량"
    ]
  },
  {
    "id": "sungboo-sb500",
    "brand": "성부",
    "model": "SB-500",
    "machineType": "spreader",
    "role": "implement",
    "specs": {
      "payloadKg": 300
    },
    "facts": [
      [
        "구분",
        "트랙터 부착형 비료·석회·규산질 살포기"
      ],
      [
        "용량",
        "300 kg 형 (500kg형 SB-550)"
      ],
      [
        "구동",
        "PTO 조인트 방식 (유압 개폐 옵션)"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 Cat I/II + PTO 540 rpm 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": [
        540
      ]
    },
    "sources": [
      {
        "url": "https://www.iamnongbu.com/",
        "title": "성부 SB-500 비료·석회 살포기",
        "note": "농기계 유통 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "권장 트랙터 마력 범위",
      "기체 중량"
    ]
  },
  {
    "id": "ansung-aml205",
    "brand": "안성공업",
    "model": "AML205",
    "machineType": "loader",
    "role": "implement",
    "specs": {
      "maxLiftHeightMm": 2100,
      "groundLiftCapacityKgf": 1220,
      "maxHeightLiftCapacityKgf": 635,
      "publishedTractorPowerRange": {
        "min": 25,
        "max": 30,
        "unit": "hp",
        "basis": "unspecified"
      }
    },
    "facts": [
      [
        "적용 마력",
        "25 ~ 30 hp 소형 트랙터"
      ],
      [
        "최대 상승높이",
        "2,100 mm"
      ],
      [
        "인양 하중",
        "지면 1,220 kgf / 최대높이 635 kgf"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "소형 트랙터 차체 전용 마운팅 브라켓 + 유압 연결",
      "hitchCategory": "차체 전용 서브프레임",
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.ansung.co.kr/",
        "title": "안성공업 AML205 프론트로더 제원",
        "note": "제조사 공식 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "트랙터 모델별 전용 마운팅 브라켓 코드"
    ]
  },
  {
    "id": "ansung-bl25rslqb",
    "brand": "안성공업",
    "model": "BL25RSL-QB",
    "machineType": "loader",
    "role": "implement",
    "specs": {
      "maxLiftHeightMm": 2590,
      "groundLiftCapacityKgf": 1600,
      "maxHeightLiftCapacityKgf": 950,
      "publishedTractorPowerRange": {
        "min": 30,
        "max": 50,
        "unit": "HP",
        "basis": "unspecified"
      }
    },
    "facts": [
      [
        "적용 마력",
        "30 ~ 50 HP 중형 트랙터"
      ],
      [
        "최대 상승높이",
        "2,590 mm"
      ],
      [
        "인양 하중",
        "지면 1,600 kgf / 최대높이 950 kgf"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "중형 트랙터 차체 전용 마운팅 브라켓 + 유압 연결",
      "hitchCategory": "차체 전용 서브프레임",
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.ansung.co.kr/",
        "title": "안성공업 BL25RSL-QB 프론트로더 제원",
        "note": "제조사 공식 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "트랙터 모델별 전용 마운팅 브라켓 코드"
    ]
  },
  {
    "id": "ansung-bl45slqb",
    "brand": "안성공업",
    "model": "BL45SL-QB",
    "machineType": "loader",
    "role": "implement",
    "specs": {
      "maxLiftHeightMm": 2890,
      "groundLiftCapacityKgf": 1460,
      "maxHeightLiftCapacityKgf": 930,
      "publishedTractorPowerRange": {
        "min": 60,
        "max": 70,
        "unit": "HP",
        "basis": "unspecified"
      }
    },
    "facts": [
      [
        "적용 마력",
        "60 ~ 70 HP 중대형 트랙터"
      ],
      [
        "최대 상승높이",
        "2,890 mm"
      ],
      [
        "인양 하중",
        "지면 1,460+ kgf / 최대높이 930 kgf"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "중대형 트랙터 차체 전용 마운팅 브라켓 + 유압 연결 (톤백리프트 후크 호환)",
      "hitchCategory": "차체 전용 서브프레임",
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.ansung.co.kr/",
        "title": "안성공업 BL45SL-QB 프론트로더 제원",
        "note": "제조사 공식 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "트랙터 모델별 전용 마운팅 브라켓 코드"
    ]
  },
  {
    "id": "myungsung-fb3135plus",
    "brand": "명성",
    "model": "FB3135 PLUS",
    "machineType": "baler",
    "role": "implement",
    "specs": {
      "pickupWidthMm": 2300,
      "baleDiameterCm": 125,
      "baleWidthCm": 122,
      "publishedTractorPowerRange": {
        "min": 80,
        "max": null,
        "unit": "마력(원문)",
        "basis": "recommended"
      }
    },
    "facts": [
      [
        "구분",
        "대형 롤러식 원형 베일러 (자동 뒷문·드롭플로워)"
      ],
      [
        "베일 크기",
        "직경 125 cm × 폭 122 cm"
      ],
      [
        "픽업 폭",
        "2,300 mm"
      ],
      [
        "권장 마력",
        "80 ~ 100 마력 이상"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "대형 트랙터 견인 + PTO + 유압 포트 확인 필요",
      "hitchCategory": "Drawbar",
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": [
        540
      ]
    },
    "sources": [
      {
        "url": "https://www.myungsung.co.kr/",
        "title": "명성 FB3135 PLUS 대형 원형 베일러 제원",
        "note": "제조사 공식 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "기체 중량",
      "외부 유압 유량 요구량"
    ]
  },
  {
    "id": "myungsung-combipro2",
    "brand": "명성",
    "model": "COMBIPRO2",
    "machineType": "baler",
    "role": "implement",
    "specs": {
      "dimensionsMm": [
        5200,
        2400,
        2100
      ],
      "pickupWidthMm": 1830,
      "baleDiameterCm": 110,
      "baleWidthCm": 100,
      "publishedTractorPowerRange": {
        "min": 80,
        "max": null,
        "unit": "마력(원문)",
        "basis": "recommended"
      }
    },
    "facts": [
      [
        "구분",
        "중형 베일러·랩핑 복합기 (ELHO 랩핑부 탑재)"
      ],
      [
        "베일 크기 / 픽업폭",
        "직경 110 × 폭 100 cm / 픽업 1,830 mm"
      ],
      [
        "크기",
        "5,200 × 2,400 × 2,100 mm"
      ],
      [
        "권장 마력",
        "80 마력 이상"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "대형 트랙터 견인 + PTO + 유압 포트 확인 필요",
      "hitchCategory": "Drawbar",
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": [
        540
      ]
    },
    "sources": [
      {
        "url": "https://www.myungsung.co.kr/",
        "title": "명성 COMBIPRO2 복합기 제원",
        "note": "제조사 공식 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "기체 중량",
      "최소 유압 유량"
    ]
  },
  {
    "id": "myungsung-proliner1500",
    "brand": "명성",
    "model": "PROLINER 1500",
    "machineType": "baler",
    "role": "implement",
    "specs": {
      "dimensionsMm": [
        3500,
        2000,
        2400
      ],
      "weightKg": 1075,
      "baleDiameterCm": [
        100,
        150
      ],
      "publishedTractorPowerRange": {
        "min": 50,
        "max": null,
        "unit": "마력(원문)",
        "basis": "recommended"
      }
    },
    "facts": [
      [
        "구분",
        "대형 2암 체인구동 고속 랩피복기 (ELHO)"
      ],
      [
        "크기 / 중량",
        "3,500 × 2,000 × 2,400 mm / 1,075 kg"
      ],
      [
        "대상 베일",
        "직경 100 ~ 150 cm"
      ],
      [
        "권장 마력",
        "50 ~ 80 마력 이상"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 링크 부착 + 외부 유압 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.myungsung.co.kr/",
        "title": "명성 PROLINER 1500 랩피복기 제원",
        "note": "제조사 공식 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "3점 히치 카테고리",
      "유압 유량 요구량"
    ]
  },
  {
    "id": "won-mchale-vs200",
    "brand": "원인터내셔널",
    "model": "VS200",
    "machineType": "baler",
    "role": "implement",
    "specs": {
      "publishedTractorPowerRange": {
        "min": 50,
        "max": null,
        "unit": "마력(원문)",
        "basis": "recommended"
      }
    },
    "facts": [
      [
        "구분",
        "베일피복기 / 랩핑기 (표준 대형 원형 베일 호환)"
      ],
      [
        "권장 마력",
        "50 ~ 80 마력 이상"
      ]
    ],
    "connection": {
      "hostType": "tractor",
      "label": "트랙터 3점 히치 또는 견인 + 유압 확인 필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.wonitl.com/",
        "title": "원인터내셔널 VS200 베일피복기",
        "note": "수입사 공식 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "외형 치수",
      "기체 중량"
    ]
  },
  {
    "id": "shinhung-mini50",
    "brand": "신흥기업",
    "model": "MINI-50",
    "machineType": "dryer",
    "role": "standalone",
    "specs": {
      "dimensionsMm": [
        663,
        698,
        989
      ],
      "capacityKg": 10,
      "powerKw": 1.5,
      "trayCount": 5
    },
    "facts": [
      [
        "구분",
        "소형 농산물 전기건조기 (채반 5개)"
      ],
      [
        "크기",
        "663 × 698 × 989 mm"
      ],
      [
        "건조 용량 / 전력",
        "약 10 kg / 계약전력 1.5 kW"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 정치형 전기식 · 트랙터/관리기 연결 불필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.shin-nong.com/",
        "title": "신흥기업 MINI-50 농산물 전기건조기 제원",
        "note": "제조사 공식 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "기체 중량",
      "정격 전압(단상 220V 여부)"
    ]
  },
  {
    "id": "shinhung-sn110d",
    "brand": "신흥기업",
    "model": "SN-110D",
    "machineType": "dryer",
    "role": "standalone",
    "specs": {
      "dimensionsMm": [
        750,
        965,
        1855
      ],
      "capacityKg": [
        55,
        110
      ],
      "powerKw": 3,
      "trayCount": 11
    },
    "facts": [
      [
        "구분",
        "농가 보급형 농산물 전기건조기 (채반 11개)"
      ],
      [
        "크기",
        "750 × 965 × 1,855 mm"
      ],
      [
        "건조 용량 / 전력",
        "55 ~ 110 kg / 계약전력 3 kW"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 정치형 전기식 · 트랙터/관리기 연결 불필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.shin-nong.com/",
        "title": "신흥기업 SN-110D 농산물 전기건조기 제원",
        "note": "제조사 공식 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "기체 중량"
    ]
  },
  {
    "id": "shinhung-sn150",
    "brand": "신흥기업",
    "model": "SN-150",
    "machineType": "dryer",
    "role": "standalone",
    "specs": {
      "dimensionsMm": [
        750,
        965,
        2000
      ],
      "capacityKg": [
        80,
        130
      ],
      "powerKw": 5,
      "trayCount": 15
    },
    "facts": [
      [
        "구분",
        "중형 농산물 전기건조기 (채반 15개)"
      ],
      [
        "크기",
        "750 × 965 × 2,000 mm"
      ],
      [
        "건조 용량 / 전력",
        "80 ~ 130 kg / 계약전력 5 kW (농업용 전기 증설 필요)"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 정치형 전기식 · 트랙터/관리기 연결 불필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.shin-nong.com/",
        "title": "신흥기업 SN-150 농산물 전기건조기 제원",
        "note": "제조사 공식 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "기체 중량"
    ]
  },
  {
    "id": "hansung-35seok",
    "brand": "시즈오카한성",
    "model": "35석 곡물건조기 (N/MS 계열)",
    "machineType": "dryer",
    "role": "standalone",
    "specs": {
      "heightMm": 4340
    },
    "facts": [
      [
        "구분",
        "농가 보급형 순환식 곡물건조기 (저층고 설계)"
      ],
      [
        "용량 / 전고",
        "35석 / 전고 4,340 mm"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 정치형(삼상 전원+등유 버너) · 트랙터/관리기 연결 불필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.shizuokahansung.co.kr/",
        "title": "시즈오카한성 35석 곡물건조기 사양",
        "note": "제조사 공식 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "세부 설치 면적",
      "모터 소비전력"
    ]
  },
  {
    "id": "taekwang-dryer3t",
    "brand": "태광",
    "model": "순환식 곡물건조기 3.0톤급",
    "machineType": "dryer",
    "role": "standalone",
    "specs": {
      "fuelConsumptionLh": 5.3
    },
    "facts": [
      [
        "구분",
        "농업기계 검정 등록 순환식 곡물건조기"
      ],
      [
        "용량 / 연료소모",
        "3.0톤 이하 / 등유 약 5.3 L/h"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 정치형 · 트랙터/관리기 연결 불필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.law.go.kr/",
        "title": "농업기계 검정 기준 태광 순환식 곡물건조기",
        "note": "정부 검정 등록 기준",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "외형 치수",
      "기체 중량"
    ]
  },
  {
    "id": "dooroo-drgs350k",
    "brand": "두루기계통상",
    "model": "DRGS-350K",
    "machineType": "sorter",
    "role": "standalone",
    "specs": {
      "dimensionsMm": [
        2055,
        655,
        1000
      ],
      "weightKg": 190,
      "powerKw": 0.2
    },
    "facts": [
      [
        "구분",
        "봉간격 통과식 통마늘·쪽마늘 선별기"
      ],
      [
        "크기 / 중량",
        "2,055 × 655 × 1,000 mm / 190 kg"
      ],
      [
        "동력",
        "단상 220V 기어드모터 0.2 kW (350 rpm · 봉 진동 312 rpm)"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 전동식(단상 220V) · 트랙터/관리기 연결 불필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.dooroo21.com/",
        "title": "두루기계통상 DRGS-350K 마늘 선별기 제원",
        "note": "제조사 공식 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "시간당 선별 능력(kg/h)"
    ]
  },
  {
    "id": "sungboo-sbc800ma",
    "brand": "성부(삼부강업)",
    "model": "SBC-800MA",
    "machineType": "sorter",
    "role": "standalone",
    "specs": {
      "dimensionsMm": [
        5040,
        3100,
        null
      ],
      "throughputPerHour": [
        5000,
        5700
      ]
    },
    "facts": [
      [
        "구분",
        "8단 추다이얼식 과수·농산물 선별기 (사과·배·감자·양파 등)"
      ],
      [
        "설치 면적",
        "약 3,100(W) × 5,040(L) mm"
      ],
      [
        "선별 능력 / 동력",
        "시간당 약 5,000~5,700개 / 단상 220V (1/4 HP)"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 전동식(단상 220V) · 트랙터/관리기 연결 불필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.samboosteel.com/",
        "title": "삼부강업(성부) SBC-800MA 선별기 제원",
        "note": "제조사 공식 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "기체 높이",
      "기체 중량"
    ]
  },
  {
    "id": "sungboo-sec800ma",
    "brand": "성부(삼부강업)",
    "model": "SEC-800MA",
    "machineType": "sorter",
    "role": "standalone",
    "specs": {
      "throughputPerHour": [
        6400,
        6900
      ],
      "accuracyGrams": 3
    },
    "facts": [
      [
        "구분",
        "8단 전자 컵 방식 중량선별기"
      ],
      [
        "선별 능력 / 정밀도",
        "시간당 약 6,400~6,900개 / ±3 g 이내"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 전동식 · 트랙터/관리기 연결 불필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.samboosteel.com/",
        "title": "삼부강업(성부) SEC-800MA 전자 중량선별기 제원",
        "note": "제조사 공식 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "설치 면적",
      "기체 중량"
    ]
  },
  {
    "id": "hansung-htis",
    "brand": "한성티앤아이",
    "model": "HTI-S 시리즈",
    "machineType": "sorter",
    "role": "standalone",
    "specs": {
      "gradeCount": [
        10,
        32
      ]
    },
    "facts": [
      [
        "구분",
        "선과장용 고속 전자식 로드셀 과일 중량선별기"
      ],
      [
        "선별 등급",
        "10 ~ 32단 맞춤형 확장 (비파괴 당도선별 옵션)"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "독립 전동식 · 트랙터/관리기 연결 불필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.komachine.com/",
        "title": "한성티앤아이 HTI-S 과일선별기 사양",
        "note": "제조사 등록 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "단별 세부 설치면적",
      "시간당 처리량"
    ]
  },
  {
    "id": "myungsung-jcb1810k",
    "brand": "명성",
    "model": "JCB1810K",
    "machineType": "forageHarvester",
    "role": "standalone",
    "specs": {
      "dimensionsMm": [
        6170,
        2250,
        2750
      ],
      "weightKg": 5580,
      "cuttingWidthMm": 1850,
      "maxPowerPs": 101.2,
      "maxPowerKw": 74.4
    },
    "facts": [
      [
        "구분",
        "자주식 베일러·사료작물수확기 (2드럼식 하베스타)"
      ],
      [
        "크기 / 중량",
        "6,170 × 2,250 × 2,750 mm / 5,580 kg"
      ],
      [
        "엔진 / 절단폭",
        "4TNV94FHT 101.2마력 (74.4kW) / 1,850 mm"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "자주식 본체 · 트랙터/관리기 연결 불필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.myungsung.co.kr/",
        "title": "명성 JCB1810K 자주식 베일러 제원",
        "note": "제조사 공식 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "연료탱크 용량",
      "베일 규격"
    ]
  },
  {
    "id": "livemac-c30magic",
    "brand": "라이브맥",
    "model": "C30 magic",
    "machineType": "forageHarvester",
    "role": "standalone",
    "specs": {
      "nominalPowerPs": 175,
      "baleDimensionsCm": [
        85,
        100
      ]
    },
    "facts": [
      [
        "구분",
        "궤도형 자주식 베일수확기 (수확·세절·교반·베일 일관)"
      ],
      [
        "엔진 / 베일 크기",
        "175 HP 급 / 85 × 100 cm"
      ]
    ],
    "connection": {
      "hostType": null,
      "label": "자주식 본체 · 트랙터/관리기 연결 불필요",
      "hitchCategory": null,
      "pinDiameterMm": null,
      "ptoSpline": null,
      "ptoRpm": null
    },
    "sources": [
      {
        "url": "https://www.livemac.co.kr/",
        "title": "라이브맥 C30 magic 자주식 베일수확기",
        "note": "제조사 및 축산신문 보도 사양",
        "checkedAt": "2026-11-17"
      }
    ],
    "unknowns": [
      "외형 치수",
      "기체 중량"
    ]
  }
];

export const SPEC_BY_ID = Object.fromEntries(MACHINE_SPECIFICATIONS.map((item) => [item.id, item]));

const MACHINE_TYPE_DEFAULTS = {
  "cultivator": {
    "cropIds": [
      "pepper",
      "cabbage",
      "potato"
    ],
    "operations": [
      "till",
      "ridge"
    ],
    "areaMin": 300,
    "areaMax": 1500
  },
  "tractor": {
    "cropIds": [
      "pepper",
      "rice",
      "cabbage",
      "potato"
    ],
    "operations": [
      "till",
      "ridge",
      "level"
    ],
    "areaMin": 1000,
    "areaMax": 30000
  },
  "ridgeMulcher": {
    "cropIds": [
      "pepper",
      "cabbage",
      "potato"
    ],
    "operations": [
      "ridge",
      "mulch"
    ],
    "areaMin": 300,
    "areaMax": 10000
  },
  "transplanter": {
    "cropIds": [
      "pepper",
      "cabbage",
      "onion"
    ],
    "operations": [
      "transplant"
    ],
    "areaMin": 300,
    "areaMax": 5000
  },
  "ricePlanter": {
    "cropIds": [
      "rice"
    ],
    "operations": [
      "ricePlant"
    ],
    "areaMin": 1000,
    "areaMax": 20000
  },
  "sprayer": {
    "cropIds": [
      "pepper",
      "rice",
      "cabbage",
      "potato"
    ],
    "operations": [
      "spray"
    ],
    "areaMin": 300,
    "areaMax": 3000
  },
  "potatoPlanter": {
    "cropIds": [
      "potato"
    ],
    "operations": [
      "seed"
    ],
    "areaMin": 1000,
    "areaMax": 15000
  },
  "combine": {
    "cropIds": [
      "rice",
      "soybean",
      "barleyWheat"
    ],
    "operations": [
      "riceHarvest"
    ],
    "areaMin": 1500,
    "areaMax": 30000
  },
  "potatoHarvester": {
    "cropIds": [
      "potato"
    ],
    "operations": [
      "potatoHarvest"
    ],
    "areaMin": 1000,
    "areaMax": 15000
  },
  "carrier": {
    "cropIds": [
      "pepper",
      "rice",
      "cabbage",
      "potato"
    ],
    "operations": [
      "transport"
    ],
    "areaMin": 300,
    "areaMax": 10000
  },
  "tiller": {
    "cropIds": [
      "pepper",
      "ginger",
      "sesame"
    ],
    "operations": [
      "till",
      "transport"
    ],
    "areaMin": 500,
    "areaMax": 5000
  },
  "rotavator": {
    "cropIds": [
      "rice",
      "soybean",
      "pepper",
      "cabbage"
    ],
    "operations": [
      "till",
      "level"
    ],
    "areaMin": 1000,
    "areaMax": 30000
  },
  "speedSprayer": {
    "cropIds": [
      "apple",
      "pear",
      "peach",
      "grape"
    ],
    "operations": [
      "orchardSpray"
    ],
    "areaMin": 2000,
    "areaMax": 30000
  },
  "agriDrone": {
    "cropIds": [
      "rice",
      "soybean",
      "barleyWheat"
    ],
    "operations": [
      "droneSpray"
    ],
    "areaMin": 2000,
    "areaMax": 50000
  },
  "ridingCultivator": {
    "cropIds": [
      "soybean",
      "corn",
      "potato",
      "greenOnion"
    ],
    "operations": [
      "hill",
      "weedMow"
    ],
    "areaMin": 1000,
    "areaMax": 15000
  },
  "garlicOnionPlanter": {
    "cropIds": [
      "garlic",
      "onion"
    ],
    "operations": [
      "garlicOnionPlant"
    ],
    "areaMin": 1000,
    "areaMax": 20000
  },
  "rootHarvester": {
    "cropIds": [
      "garlic",
      "onion",
      "sweetPotato",
      "ginger"
    ],
    "operations": [
      "rootHarvest"
    ],
    "areaMin": 1000,
    "areaMax": 20000
  },
  "plow": {
    "cropIds": [
      "rice",
      "soybean",
      "pepper",
      "garlic"
    ],
    "operations": [
      "deepTill"
    ],
    "areaMin": 1000,
    "areaMax": 30000
  },
  "spreader": {
    "cropIds": [
      "rice",
      "corn",
      "apple",
      "cabbage"
    ],
    "operations": [
      "spreadFertilizer"
    ],
    "areaMin": 1000,
    "areaMax": 30000
  },
  "loader": {
    "cropIds": [
      "rice",
      "corn",
      "garlic",
      "apple"
    ],
    "operations": [
      "spreadFertilizer",
      "transport"
    ],
    "areaMin": 1000,
    "areaMax": 30000
  },
  "baler": {
    "cropIds": [
      "corn"
    ],
    "operations": [
      "forageBale"
    ],
    "areaMin": 3000,
    "areaMax": 50000
  },
  "mower": {
    "cropIds": [
      "apple",
      "pear",
      "peach",
      "grape"
    ],
    "operations": [
      "weedMow"
    ],
    "areaMin": 300,
    "areaMax": 10000
  },
  "shredder": {
    "cropIds": [
      "apple",
      "pear",
      "peach",
      "grape"
    ],
    "operations": [
      "pruneShred"
    ],
    "areaMin": 500,
    "areaMax": 15000
  },
  "thresher": {
    "cropIds": [
      "soybean",
      "barleyWheat",
      "sesame"
    ],
    "operations": [
      "thresh"
    ],
    "areaMin": 500,
    "areaMax": 10000
  },
  "excavator": {
    "cropIds": [
      "rice",
      "soybean",
      "barleyWheat",
      "ginseng"
    ],
    "operations": [
      "excavateDrain"
    ],
    "areaMin": 500,
    "areaMax": 15000
  },
  "aerialLift": {
    "cropIds": [
      "apple",
      "pear",
      "peach",
      "persimmon"
    ],
    "operations": [
      "aerialWork"
    ],
    "areaMin": 1000,
    "areaMax": 20000
  },
  "seeder": {
    "cropIds": [
      "soybean",
      "corn",
      "barleyWheat",
      "sesame"
    ],
    "operations": [
      "directSeed"
    ],
    "areaMin": 1000,
    "areaMax": 30000
  },
  "ridger": {
    "cropIds": [
      "rice"
    ],
    "operations": [
      "ridgeBuild"
    ],
    "areaMin": 500,
    "areaMax": 20000
  },
  "dryer": {
    "cropIds": [
      "rice",
      "pepper",
      "garlic",
      "barleyWheat"
    ],
    "operations": [
      "dryProduce"
    ],
    "areaMin": 500,
    "areaMax": 30000
  },
  "sorter": {
    "cropIds": [
      "garlic",
      "potato",
      "onion",
      "apple",
      "pear"
    ],
    "operations": [
      "sortProduce"
    ],
    "areaMin": 500,
    "areaMax": 30000
  },
  "forageHarvester": {
    "cropIds": [
      "forageCrops",
      "corn"
    ],
    "operations": [
      "forageBale"
    ],
    "areaMin": 3000,
    "areaMax": 50000
  }
};

export function getSpecificationDefaults(specOrMachineType) {
  const machineType = typeof specOrMachineType === "string" ? specOrMachineType : specOrMachineType?.machineType;
  const fallback = { cropIds: ["pepper"], operations: ["till"], areaMin: 300, areaMax: 1500 };
  const base = MACHINE_TYPE_DEFAULTS[machineType] || fallback;
  return {
    cropIds: [...base.cropIds],
    operations: [...base.operations],
    areaMin: base.areaMin,
    areaMax: base.areaMax,
  };
}

export function applyModelSpecification(listing, index = 0) {
  const models = MACHINE_SPECIFICATIONS.filter((model) => model.machineType === listing.machineType);
  const explicitModel =
    listing.modelId && Object.hasOwn(SPEC_BY_ID, listing.modelId) ? SPEC_BY_ID[listing.modelId] : null;
  const model =
    explicitModel && explicitModel.machineType === listing.machineType
      ? explicitModel
      : models[index % models.length];
  if (!model) return listing;
  const label = model.role === "implement" ? "작업기 단품 · 동력 본체 별도" : model.role === "powerUnit" ? "본체 · 부착 작업기 별도 확인" : "독립 구동 본체";
  const spotPrefix = listing.farmSpotLabel ? `${listing.farmSpotLabel} 보유 장비로 ` : "";
  return {
    ...listing,
    modelId: model.id,
    model: model.model,
    brand: model.brand,
    specification: model,
    title: `${model.brand} ${model.model} · ${listing.region}`,
    included: label,
    description: `${spotPrefix}실제 ${model.model}의 공개 사양을 참조한 가상 매물입니다. 가격·점검일·예약·작업 면적은 시연용입니다. ${label}.`,
    summary: `${model.brand} ${model.model}. ${model.facts[0][1]}. ${label}.`,
    demo: true,
  };
}

// Manufacturer-listed pairings only. Power alone cannot establish compatibility.
export function checkModelCompatibility(powerUnitId, implementId) {
  const power = SPEC_BY_ID[powerUnitId];
  const implement = SPEC_BY_ID[implementId];
  if (!power || !implement) return { status: "check", reason: "모델 사양 확인 필요" };
  if (implement.role !== "implement") return { status: "notApplicable", reason: "부착 작업기가 아닙니다" };
  if (power.role !== "powerUnit" || power.machineType !== implement.connection.hostType) {
    return { status: "incompatible", reason: "동력 본체 종류가 다릅니다" };
  }
  if (implement.connection.approvedModelIds?.includes(power.id)) {
    return { status: "compatible", reason: "제조사가 부착 가능 기종으로 명시했습니다. 실제 연식·부속 구성은 인수 전에 확인하세요." };
  }
  if (implement.connection.approvedBrands?.length && !implement.connection.approvedBrands.includes(power.brand)) {
    return { status: "incompatible", reason: "제조사 전용 브라켓/부착 규격으로 타사 본체와 호환되지 않습니다" };
  }
  const minPs = implement.specs?.publishedTractorPowerRange?.min;
  if (minPs != null && power.specs?.nominalPowerPs != null && power.specs.nominalPowerPs < minPs) {
    return { status: "incompatible", reason: `동력 본체 마력(${power.specs.nominalPowerPs} PS)이 작업기 권장 최소 마력(${minPs}) 미만입니다` };
  }
  return { status: "check", reason: "히치·PTO·승강력 등 상세 연결 규격 확인 필요" };
}
