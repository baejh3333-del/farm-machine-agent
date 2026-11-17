# 대한민국 실제 농기계 유형·모델·제원·호환성 전수 조사 보고서

- **조사 일자:** 2026-11-17
- **연계 데이터:** [`korea-farm-machines.json`](file:///C:/Users/baejh/orca/workspaces/nongnong/db-rebuild-plan/docs/research/korea-farm-machines.json)
- **조사 원칙:**
  1. 국내 주요 농기계 제조사 공식 제품 페이지(대동, TYM, LS엠트론, 한국구보다, 얀마농기코리아, 아세아텍, 두루기계통상, 강농, 한성티앤아이, 안성공업, 명성, 위캔글로벌, 원인터내셔널, 금성, 죽암기계, DJI) 및 한국농기계공업협동조합(KAMICO)·지자체 농기계임대사업소 공개 자료에서 **직접 확인된 수치만 기록**합니다.
  2. 미확인 제원(3점 히치 카테고리 세부 치수, 핀 직경, PTO 스플라인, 연식별 중량 등)은 임의 추정하지 않고 `unknowns`로 분리합니다.
  3. 작업기 호환성은 제조사 공식 명시(`approvedModelIds`) 외에는 마력 범위가 일치하더라도 `requiresHitchVerification`(히치·PTO·승강력 확인 필요)으로 분류합니다.

---

## 1. 조사 요약

| 항목 | 수량 | 비고 |
| :--- | :---: | :--- |
| **농기계 유형 (`machineTypes`)** | **24종** | 기존 10종 유지 + 한국 실사용·임대사업소 주요 14종 추가 |
| **검증된 실제 모델 (`models`)** | **47개** | 24개 유형 전체 커버 (트랙터 20~142 PS 포함) |
| **호환성 규칙 (`compatibilityRules`)** | **16건** | `approvedModelIds` / `requiresHitchVerification` / `incompatible` |
| **출처 링크 (`sources`)** | **47건** | 제조사 공식 URL 및 KAMICO·지자체 공개 목록집 |

---

## 2. 대한민국 농기계 유형 24종 분류 (`machineTypes`)

### 2.1 기존 10종 (Exact IDs 유지)
| ID | 한글명 | 역할 (`role`) | 권장 면적 (㎡) | 주요 작업 | 임대사업소 보급도 |
| :--- | :--- | :--- | :---: | :--- | :--- |
| `cultivator` | 관리기 | `powerUnit` | 300 ~ 1,500 | 경운·배토·두둑·제초 | 매우 높음 |
| `tractor` | 트랙터 | `powerUnit` | 1,000 ~ 30,000 | 경운·쟁기·로터리·파종·수확·적재 | 높음 |
| `ridgeMulcher` | 휴립·멀칭기 | `implement` | 300 ~ 10,000 | 두둑 성형·비닐 피복 | 매우 높음 |
| `transplanter` | 정식기 | `standalone` | 300 ~ 5,000 | 고추·배추·양파 모종 정식 | 높음 |
| `ricePlanter` | 이앙기 | `standalone` | 1,000 ~ 20,000 | 벼 이앙 | 보통 |
| `sprayer` | 방제기 | `standalone` | 300 ~ 3,000 | 소규모 약제 살포 | 높음 |
| `potatoPlanter` | 감자 파종기 | `implement` | 1,000 ~ 15,000 | 씨감자 파종·피복 | 높음 |
| `combine` | 콤바인 | `standalone` | 1,500 ~ 30,000 | 벼·콩·보리 예취·탈곡 | 보통 |
| `potatoHarvester` | 감자 굴취기 | `implement` | 1,000 ~ 15,000 | 감자·고구마 굴취 | 높음 |
| `carrier` | 운반차 | `standalone` | 300 ~ 10,000 | 농산물·자재 운반 | 매우 높음 |

### 2.2 한국 실사용·농기계임대사업소 주요 추가 14종
| ID | 한글명 | 역할 (`role`) | 권장 면적 (㎡) | 주요 작업 | 임대사업소 보급도 |
| :--- | :--- | :--- | :---: | :--- | :--- |
| `tiller` | 경운기 | `powerUnit` | 500 ~ 5,000 | 로터리·쟁기·트레일러 운반 | 보통 |
| `rotavator` | 로타베이터 | `implement` | 1,000 ~ 30,000 | 트랙터 쇄토·정지 | 매우 높음 |
| `speedSprayer` | SS기 (스피드스프레이어) | `standalone` | 2,000 ~ 30,000 | 과수원 고속 광역 방제 | 높음 |
| `agriDrone` | 농업용 방제 드론 | `standalone` | 2,000 ~ 50,000 | 액제 방제·입제 살포 | 보통 |
| `ridingCultivator` | 승용관리기 | `powerUnit` | 1,000 ~ 15,000 | 밭작물 방제·배토·비료살포 | 높음 |
| `garlicOnionPlanter` | 마늘·양파 파종기 | `implement` | 1,000 ~ 20,000 | 마늘·양파 정밀 파종 | 매우 높음 |
| `rootHarvester` | 땅속작물 수확기 | `implement` | 1,000 ~ 20,000 | 마늘·양파·생강 굴취 | 매우 높음 |
| `plow` | 쟁기 (심경쟁기) | `implement` | 1,000 ~ 30,000 | 심경·반전 경운 | 높음 |
| `spreader` | 비료·퇴비 살포기 | `implement` | 1,000 ~ 30,000 | 화학비료·퇴비 살포 | 매우 높음 |
| `loader` | 프론트로더 | `implement` | 1,000 ~ 30,000 | 토사·퇴비 적재·톤백 리프트 | 보통 |
| `baler` | 원형 베일러 | `implement` | 3,000 ~ 50,000 | 볏짚·사료작물 곤포 성형 | 보통 |
| `mower` | 예초기 (승용 제초기) | `standalone` | 300 ~ 10,000 | 논둑·과수원 제초 | 매우 높음 |
| `shredder` | 잔가지·목재 파쇄기 | `standalone` | 500 ~ 15,000 | 전정가지·고춧대 파쇄 | 매우 높음 (무상/저가 임대 1순위) |
| `thresher` | 탈곡기 (콩·잡곡) | `standalone` | 500 ~ 10,000 | 콩·들깨·잡곡 탈곡·정선 | 매우 높음 (가을 수확철 최상위) |

---

## 3. 실제 모델별 상세 제원 (47개 모델)

### 3.1 동력 본체 (`powerUnit`): 트랙터 · 관리기 · 경운기 · 승용관리기

#### 트랙터 (`tractor`, 20~142 PS)
| 모델 ID | 제조사 / 모델명 | 마력 (PS) | 주요 확인 제원 | 출처 |
| :--- | :--- | :---: | :--- | :--- |
| `kubota-b2320` | 한국구보다 B2320 | 20 PS | 소형 콤팩트 B 시리즈 | [한국구보다](https://www.kubotakorea.com/) |
| `tym-t25` | TYM T25 | 24.2 PS | 2,395×1,170×2,500mm, 835kg, 양력 730.1kgf, 20L | [TYM](https://tym.world/) |
| `daedong-dk450` | 대동 DK450HSRQ5 | 45 PS | 33.5kW/2,600rpm, 1,826cc, PTO 540/750/1000, 유압 6포트 | [대동 DK](https://ko.daedong.co.kr/product/12) |
| `daedong-dk550` | 대동 DK550HSRQ5 | 55 PS | 41kW/2,600rpm, 1,826cc, PTO 540/750/1000, 유압 6포트 | [대동 DK](https://ko.daedong.co.kr/product/12) |
| `daedong-dk600` | 대동 DK600HSRQ5 | 58 PS | 43kW/2,600rpm, 1,826cc, PTO 540/750/1000, 유압 6포트 | [대동 DK](https://ko.daedong.co.kr/product/12) |
| `ls-mt3-58` | LS엠트론 MT3.58 | 58.9 PS | 엔진 58.9PS / PTO 48.9PS, 연료탱크 52L | [LS엠트론](https://www.lstractor.com/) |
| `yanmar-yt470a` | 얀마 YT470A | 70.0 PS | 중량 약 2,975kg, YT4 중형 시리즈 | [얀마](https://www.yanmar.com/kr/agri/) |
| `tym-t75` | TYM K75E | 75 PS | 3,685×1,890×2,720mm, 2,935kg, 양력 2,376kgf, 90L | [TYM](https://tym.world/) |
| `tym-t110` | TYM T110 | 111 PS | 양력 약 4,170kgf, 전후방 6포트 유압 밸브 | [TYM](https://tym.world/) |
| `daedong-hx1400` | 대동 HX1400 | 142 PS | 3.8L 디젤 엔진, 로드센싱 유압·LSD 앞차축 | [대동](https://ko.daedong.co.kr/) |

#### 관리기 · 경운기 · 승용관리기
| 모델 ID | 유형 | 제조사 / 모델명 | 주요 확인 제원 | 출처 |
| :--- | :--- | :--- | :--- | :--- |
| `asia-amc900` | `cultivator` | 아세아텍 AMC-900 | GB290L 296cc, 정격 4.8kW/최대 5.8kW, 162kg, PTO 714/1350rpm | [아세아텍 AMC-900](https://www.asiakor.com/mobile/design/subpage/goods.php?catalog=G1619677688&category=) |
| `asia-amc1000` | `cultivator` | 아세아텍 AMC-1000 | GB300L 296cc, 약 163kg, 1,490~1,700×680~850×820~1,140mm | [아세아텍](https://www.asiakor.com/) |
| `daedong-dt100` | `tiller` | 대동 DT100 / DT100N | ND10DE 673cc 단기통 디젤, 상용 10PS, 383~469kg, 11L | [대동](https://ko.daedong.co.kr/) |
| `yanmar-md20` | `ridingCultivator` | 얀마 MD20 | 688cc 가솔린, 13.4kW(18.0PS)/2,800rpm, 3륜 미드마운트, 665kg | [얀마](https://www.yanmar.com/kr/agri/) |

---

### 3.2 부착 작업기 (`implement`)
| 모델 ID | 유형 | 제조사 / 모델명 | 적용 마력·본체 | 주요 확인 제원 | 출처 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `wecan-sgw` | `rotavator` | 위캔글로벌 SGW 시리즈 | 트랙터 35~75마력 | 논 전용, 작업폭 1,650~3,000mm | [위캔글로벌](https://wecan21.com/) |
| `woongjin-wj230se` | `rotavator` | 웅진기계 WJ230SE | 트랙터 85~105마력 | 대형 보강형, 작업폭 2,200~2,250mm | [KAMICO](https://www.kamico.or.kr/) |
| `asia-fm120n` | `ridgeMulcher` | 아세아텍 FM-120N | 아세아 880/900/1000 관리기 | 1,400×1,420×800mm, 둥근두둑 750~1,200mm | [아세아텍 FM-120N](https://www.asiakor.com/mobile/design/subpage/goods.php?catalog=G1619677610&category=) |
| `dooroo-drb1200pc` | `ridgeMulcher` | 두루기계통상 DRB-1200PC | 트랙터 부착형 | 2,500×1,950×1,380mm, 830kg, 로터리 168rpm | [두루기계통상](https://www.dooroo21.com/) |
| `woongjin-uj3ps` | `plow` | 웅진기계 UJ3PS | 트랙터 50~70마력 | 단용 3련 삭쟁기, 경운폭 950mm, 420kg | [코머신/웅진](https://www.komachine.com/) |
| `woongjin-w62dp` | `plow` | 웅진기계 W62-DP | 트랙터 35~55마력 | 원판쟁기(6+2), 경운폭 1,800mm, 425kg | [코머신/웅진](https://www.komachine.com/) |
| `knong-kgph9000` | `potatoPlanter` | 강농 KG-PH9000 | 트랙터 50~200HP (Cat I) | 2조식, 1,910×1,980×1,620mm, 819kg | [강농](https://www.knong.kr/blank-6) |
| `dooroo-drp1006sg` | `garlicOnionPlanter` | 두루기계통상 DRP-1006SG | 트랙터 70HP 이상 | 6조 마늘파종기, 1,085~1,220kg, 종자함 210L | [두루기계통상](https://www.dooroo21.com/) |
| `knong-tj6000` | `garlicOnionPlanter` | 강농 TJ-6000 | 트랙터 45~100HP | 7조 종이줄 마늘파종기, 2,100×1,570×1,700mm, 660kg | [강농](https://www.knong.kr/) |
| `duru-dr950an` | `potatoHarvester` | 두루기계통상 DR-950AN | 트랙터 43마력 이상 | 작업폭 950mm, 감자 수확기 | [KAMICO 2026 목록집](https://www.gunsan.go.kr/_cms/board/eFileDownload/95/8545851/ed8338a8650cf3cb8a45575fe684aa17#page=117) |
| `dooroo-drgh1400` | `rootHarvester` | 두루기계통상 DRGH-1400 | 트랙터 43~55HP 이상 | 굴취폭 1,400mm, 1,244×1,700×1,165mm, 450kg | [두루기계통상](https://www.dooroo21.com/) |
| `asia-fs300d` | `spreader` | 아세아텍 FS-300D | 아세아 승용관리기 | 120L, 60kg, 살포폭 약 16m | [아세아텍](https://www.asiakor.com/) |
| `won-matador3` | `spreader` | 원인터내셔널 MATADOR 3 | 트랙터 50HP 이상 견인 | 3톤 수직형 퇴비살포기, 4,885×2,150×1,850mm, 2,000kg | [원인터내셔널](https://www.wonitl.com/) |
| `ansung-2050qb` | `loader` | 안성공업 2050-QB | 트랙터 40~55HP | 상승높이 2,675mm, 인양하중 1,480kgf, 0.36/0.45㎥ | [안성공업](https://www.ansung.co.kr/) |
| `daedong-dl7000` | `loader` | 대동 DL7000 | 대동 트랙터 63~73HP | 인양높이 3,061mm, 인양하중 약 954kg | [KAMICO](https://www.kamico.or.kr/) |
| `myungsung-rb1100df` | `baler` | 명성 RB1100DF | 트랙터 60HP 이상 | 베일 110×100cm, 픽업폭 1,830mm, 16롤러 | [명성](https://www.myungsung.co.kr/) |

---

### 3.3 독립 구동 본체 (`standalone`)
| 모델 ID | 유형 | 제조사 / 모델명 | 주요 확인 제원 | 출처 |
| :--- | :--- | :--- | :--- | :--- |
| `yanmar-ph1r` | `transplanter` | 얀마 PH1,R | 1조식, 1,900×1,340×1,220mm, 163kg, 1.6kW | [얀마 JP](https://www.yanmar.com/jp/agri/products/vegetable/vegetable_replant/ph1r/spec.html) |
| `kubota-skp101kr` | `transplanter` | 한국구보다 SKP-101-KR | 1조식 전자동, 2,160×890×1,365mm, 238kg, 2.98PS | [한국구보다](https://www.kubotakorea.com/) |
| `jukam-jopr48a` | `transplanter` | 죽암기계 JOPR-4/8A | 승용 4/8조 4WD, 3,230×1,980×2,330mm, 728kg, 11.4PS | [죽암기계](https://www.jukam.co.kr/) |
| `daedong-drp60d` | `ricePlanter` | 대동 DRP60D | 6조식, 24PS·1,007cc, 17.9kW, 3,330×2,200×2,275mm | [대동 DRP60D](https://ko.daedong.co.kr/product/34) |
| `yanmar-yr60d` | `ricePlanter` | 얀마 YR60D | 6조식, 21.3PS, 760~829kg | [얀마](https://www.yanmar.com/kr/agri/) |
| `daedong-dxm73gf5` | `combine` | 대동 DXM73GF5 | 4조식 자탈형, 73PS, 4,390×2,505×3,155mm | [대동 DXM73GF5](https://ko.daedong.co.kr/product/25) |
| `kubota-zr6130` | `combine` | 한국구보다 ZR6130 | 6조식 대형, 약 128PS, 그레인탱크 2,000L | [한국구보다](https://www.kubotakorea.com/) |
| `honda-wjr2525t` | `sprayer` | 혼다 WJR2525T | 배부식 25L, 25cc, 6.6L/min, 건조중량 10kg | [혼다 EC](https://motos.honda.com.ec/producto-de-fuerza/fumigadora-de-mochila-wjr2525-1) |
| `asia-d10` | `speedSprayer` | 아세아텍 D10 | 1,000L, 구보다 V1505T 41.5PS, 최저지상고 215mm | [아세아텍](https://www.asiakor.com/) |
| `hansung-atom4-1000` | `speedSprayer` | 한성티앤아이 SS-ATOMⅣ-1000 | 1,000L, 현대 D4BB 디젤, 4WS·냉난방 캐빈 | [한성티앤아이](https://www.hstni.com/) |
| `dji-agras-t50` | `agriDrone` | DJI Agras T50 (대동 공급) | 액제 40L(40kg) / 입제 75L(50kg) | [DJI T50](https://ag.dji.com/kr/t50) |
| `dji-agras-t25` | `agriDrone` | DJI Agras T25 (대동 공급) | 액제 20L / 입제 25L(25kg) | [대동](https://ko.daedong.co.kr/) |
| `honda-umk435` | `mower` | 혼다 UMK435 | GX35 35.8cc 1.0kW(1.3PS), 약 7.5~8.6kg | [혼다](https://www.hondaoutdoors.co.nz/) |
| `orec-srm981` | `mower` | 오렉 SRM981 | 승용제초기 22PS, 제초폭 980mm, 약 315kg | [DK툴스](https://www.dktools.co.kr/) |
| `kumsung-gs460` | `shredder` | 금성 GS-460 | 혼다 GX200 6.5PS, 최대 파쇄직경 30mm | [금성](https://www.ikumsung.com/) |
| `kumsung-gs1500` | `thresher` | 금성 GS-1500 | 전기모터 3마력, 1,230×980×970mm, 약 150kg | [금성](https://www.ikumsung.com/) |
| `daedong-mechron2450` | `carrier` | 대동 Mechron2450 | 18kW/3,200rpm, 1,007cc 디젤, 1,050kg | [대동 Mechron2450](https://ko.daedong.co.kr/product/36) |

---

## 4. 동력 본체 ↔ 작업기 호환성 매트릭스 및 규격 기준

### 4.1 트랙터 3점 히치 및 PTO 표준 규격
| 트랙터 마력대 | 3점 히치 카테고리 | 상단 핀 직경 | 하부 핀 직경 | 하부 링크 간격 | 표준 PTO 회전수 |
| :--- | :--- | :---: | :---: | :---: | :--- |
| **20 ~ 50 PS** | Category 1 (Cat I) | 19 mm (3/4") | 22 mm (7/8") | 660 mm (26") | 540 rpm (6스플라인) |
| **40 ~ 100+ PS** | Category 2 (Cat II) | 25.4 mm (1") | 28.6 mm (1-1/8") | 810 mm (32") | 540 / 750 / 1,000 rpm |

> **주의:** Cat II 트랙터에 Cat I 작업기(예: `knong-kgph9000`)를 연결할 때는 **히치 변환 부싱(Conversion Bushing)**을 사용해야 유격·파손을 방지할 수 있으며, PTO 조인트 길이와 스플라인 산수(국내 표준 주로 6산) 일치 여부를 반드시 확인해야 합니다.

### 4.2 모델별 호환성 매트릭스
| 작업기 | 동력 본체 조건 | 판정 상태 | 검증된 매칭 후보 / 비고 |
| :--- | :--- | :--- | :--- |
| `asia-fm120n` (아세아 휴립·멀칭기) | `asia-amc900`, `asia-amc1000` | **`approvedModelIds`** | 제조사 공식 명시(아세아 880/900/1000 전용 히치핀) |
| `asia-fm120n` | 트랙터·경운기 전체 | **`incompatible`** | 동력 본체 종류 및 히치 방식 불일치 |
| `wecan-sgw` (로타베이터) | 트랙터 35~75 PS | **`requiresHitchVerification`** | `daedong-dk450/550/600`, `ls-mt3-58`, `yanmar-yt470a`, `tym-t75` (Cat I/II·540rpm 확인) |
| `woongjin-wj230se` (로타베이터) | 트랙터 85~105 PS | **`requiresHitchVerification`** | `tym-t110`, `daedong-hx1400` (75PS 이하 비호환) |
| `woongjin-w62dp` (원판쟁기) | 트랙터 35~55 PS | **`requiresHitchVerification`** | `daedong-dk450/550` (425kg 승강력·히치 확인) |
| `woongjin-uj3ps` (삭쟁기) | 트랙터 50~70 PS | **`requiresHitchVerification`** | `daedong-dk550/600`, `ls-mt3-58`, `yanmar-yt470a` (45PS 이하 비호환) |
| `knong-kgph9000` (감자파종기) | 트랙터 50~200 HP, Cat I | **`requiresHitchVerification`** | `daedong-dk550/600`, `ls-mt3-58`, `yanmar-yt470a`, `tym-t75/110`, `daedong-hx1400` |
| `dooroo-drp1006sg` (6조 마늘파종기) | 트랙터 70 HP 이상, 1,220kg | **`requiresHitchVerification`** | `yanmar-yt470a`, `tym-t75/110`, `daedong-hx1400` (**60PS 이하 비호환**) |
| `knong-tj6000` (7조 마늘파종기) | 트랙터 45~100 HP | **`requiresHitchVerification`** | `daedong-dk450/550/600`, `ls-mt3-58`, `yanmar-yt470a`, `tym-t75` |
| `duru-dr950an` (감자수확기) | 트랙터 43마력 이상 | **`requiresHitchVerification`** | `daedong-dk450` 이상 후보군 (20~25PS 소형 비호환) |
| `dooroo-drgh1400` (땅속작물수확기) | 트랙터 43~55 HP 이상 | **`requiresHitchVerification`** | `daedong-dk450` 이상 후보군 (기어박스 직결 PTO 확인) |
| `won-matador3` (3톤 퇴비살포기) | 트랙터 50 HP 이상 견인 | **`requiresHitchVerification`** | `daedong-dk550` 이상 (드로바·유압·제동 확인 필수) |
| `ansung-2050qb` (프론트로더) | 트랙터 40~55 HP | **`requiresHitchVerification`** | `daedong-dk450/550` (차종별 서브프레임 브라켓 필수) |
| `daedong-dl7000` (대동 프론트로더) | 대동 트랙터 63~73 HP | **`requiresHitchVerification`** | 대동 해당 마력대 전용 브라켓 (타사 트랙터 비호환) |
| `myungsung-rb1100df` (원형 베일러) | 트랙터 60 HP 이상 | **`requiresHitchVerification`** | `yanmar-yt470a`, `tym-t75/110`, `daedong-hx1400` (외부 유압 포트 확인) |

---

## 5. 미확인(Unverified) 항목 및 향후 보완 과제
1. **3점 히치 카테고리·핀 직경·PTO 스플라인 실측 데이터:** 다수 국내 제조사 웹 제원표가 마력·치수 위주로 공개되어 있어 Cat I/II 및 PTO 스플라인(6산 등) 여부가 `unknowns`로 남아 있습니다. 매물 등록 시 게시자 실측 입력 또는 PDF 취급설명서 대조가 필요합니다.
2. **프론트로더 서브프레임 호환표:** 로더는 3점 히치가 아닌 트랙터 차체 전용 브라켓을 사용하므로 제조사별·연식별 장착표 추가 확보가 필요합니다.
3. **일부 모델 치수·중량 누락:** `kubota-b2320`, `ls-mt3-58`, `daedong-hx1400`, `daedong-dxm73gf5`(원문 웹표 행 어긋남) 등은 제조사 공식 카탈로그 PDF 대조를 통해 보완해야 합니다.
