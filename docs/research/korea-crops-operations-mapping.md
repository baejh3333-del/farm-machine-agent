# 대한민국 주요 농작물 작업단계 및 필요 농기계 매핑 가이드

- **기준일(Checked At)**: `2026-11-17`
- **데이터 파일**: [korea-crops.json](file:///C:/Users/baejh/orca/workspaces/nongnong/db-rebuild-plan/docs/research/korea-crops.json)
- **연계 코드**: [farm-machines.js](file:///C:/Users/baejh/orca/workspaces/nongnong/db-rebuild-plan/src/data/farm-machines.js)
- **목적**: 대한민국 주요 20개 농작물의 생육 단계(`STAGES`), 농작업(`OPERATIONS`), 필요 농기계(`machineTypes`), 주산지 작업 성수기 및 농촌진흥청(농사로·국립식량과학원·국립원예특작과학원)·통계청 공식 자료 기반 표준 매핑 제공.

---

## 1. 작업단계(`STAGES`) 및 농작업(`OPERATIONS`) 체계

기존 `src/data/farm-machines.js`의 4개 작업단계(`prepare`, `plant`, `care`, `harvest`) 및 13개 농작업 ID를 **100% 보존**하면서, 대한민국 밭작물·과수·시설원예 현장에 필수적인 `orchard` 단계와 11개 농작업을 확장하였다.

| 단계 ID | 단계명 | 포함 작업 ID (`OPERATIONS`) |
|---|---|---|
| `prepare` | 밭·논 준비 | `deepTill` (심경·쟁기질), `till` (흙갈이·로터리), `spreadFertilizer` (비료·퇴비 살포), `ridge` (두둑·고랑 만들기), `mulch` (멀칭·비닐 피복), `level` (논 고르기) |
| `plant` | 심기 | `transplant` (모종 심기), `seed` (씨감자 파종), `ricePlant` (모 심기), `directSeed` (밭작물·맥류 직파), `garlicOnionPlant` (마늘·양파 파종·정식) |
| `care` | 생육 관리 | `spray` (방제), `orchardSpray` (과수 SS 방제), `droneSpray` (드론 방제), `water` (관수), `hill` (북주기), `weedMow` (제초·예초) |
| `orchard` | 과원·전정 관리 | `pruneShred` (전정·잔가지 파쇄) |
| `harvest` | 수확 | `riceHarvest` (벼 수확), `potatoHarvest` (감자 굴취), `rootHarvest` (땅속작물·마늘·양파 굴취/수확), `thresh` (탈곡·선별), `forageBale` (사료작물 수확·곤포), `transport` (수확물 운반) |

---

## 2. 작물군별 상세 매핑 (총 20개 작물)

### A. 식량작물 (5개: `rice`, `soybean`, `corn`, `sweetPotato`, `barleyWheat`)

| 작물 ID | 작물명 | 주요 작형 / 성수기 | 단계별 핵심 농작업 | 추천 농기계 (`machineTypes`) | 현장·기계화 참고 |
|---|---|---|---|---|---|
| `rice` | **벼** | 단작 (5~10월) / 성수기: 4·5·7·8·9·10월 | `deepTill` → `till` → `spreadFertilizer` → `level` → `ricePlant` → `spray`/`droneSpray` → `riceHarvest` → `transport` | `tractor`, `plow`, `rotavator`, `spreader`, `ricePlanter`, `sprayer`, `agriDrone`, `combine`, `carrier`, `loader` | 논농업 기계화율 약 99.7%. 드문모심기·드론 항공방제·자탈형 콤바인 일관작업 표준화 |
| `soybean` | **콩** | 단작(5~10월), 맥류후작(6~11월) / 성수기: 5·6·7·8·10·11월 | `deepTill` → `till` → `spreadFertilizer` → `ridge` → `directSeed` → `hill` → `spray`/`droneSpray` → `riceHarvest`/`thresh` → `transport` | `tractor`, `plow`, `rotavator`, `spreader`, `ridgeMulcher`, `ridingCultivator`, `cultivator`, `agriDrone`, `combine`, `thresher`, `carrier` | 논콩 재배 시 배수골·두둑 성형 필수. 평형작휴 동시파종기 및 콩 수확후처리(탈곡·선별) 일관화 보급 |
| `corn` | **옥수수** | 봄파종(4~8월), 사료용(4~9월) / 성수기: 4·5·7·8·9월 | `till` → `spreadFertilizer` → `ridge` → `mulch` → `directSeed` → `hill` → `spray` → `forageBale` → `transport` | `tractor`, `rotavator`, `spreader`, `ridgeMulcher`, `ridingCultivator`, `cultivator`, `sprayer`, `baler`, `loader`, `carrier` | 식용(찰옥수수)은 비닐멀칭·점파 위주, 사료용은 원형곤포기(`baler`) 및 로더 활용 |
| `sweetPotato` | **고구마** | 보통(5~10월), 조기(4~8월) / 성수기: 4·5·9·10월 | `deepTill` → `till` → `spreadFertilizer` → `ridge` → `mulch` → `transplant` → `spray` → `rootHarvest` → `transport` | `tractor`, `plow`, `rotavator`, `spreader`, `ridgeMulcher`, `transplanter`, `sprayer`, `shredder`, `rootHarvester`, `carrier` | 수확 전 줄기파쇄기(`shredder`)로 덩굴 제거 후 진동식 굴취기(`rootHarvester`) 투입 |
| `barleyWheat` | **보리·밀** | 가을파종 월동(10~6월) / 성수기: 10·11·2·3·5·6월 | `till` → `spreadFertilizer` → `directSeed` → `spray`/`droneSpray` → `riceHarvest` → `thresh` → `transport` | `tractor`, `rotavator`, `spreader`, `sprayer`, `agriDrone`, `combine`, `thresher`, `carrier` | 답리작 휴립세조파·평면세조파로 파종·시비·복토 동시 처리. 습해 방지 배수골 정비 중요 |

---

### B. 노지·양념채소 (`채소`, 8개: `pepper`, `garlic`, `onion`, `radish`, `cabbage`, `potato`, `greenOnion`, `ginger`)

| 작물 ID | 작물명 | 주요 작형 / 성수기 | 단계별 핵심 농작업 | 추천 농기계 (`machineTypes`) | 현장·기계화 참고 |
|---|---|---|---|---|---|
| `pepper` | **고추** | 노지(4~10월) / 성수기: 4~9월 | `deepTill` → `till` → `spreadFertilizer` → `ridge` → `mulch` → `transplant` → `spray` → `water` → `transport` | `tractor`, `plow`, `rotavator`, `cultivator`, `spreader`, `ridgeMulcher`, `transplanter`, `sprayer`, `carrier`, `tiller` | 기존 ID 보존. 정식기 보급 확대 및 탄저병·총채벌레 주기적 방제·관수 중요 |
| `garlic` | **마늘** | 난지형(9~5월), 한지형(10~6월) / 성수기: 9·10·4·5·6월 | `deepTill` → `till` → `spreadFertilizer` → `ridge` → `mulch` → `garlicOnionPlant` → `spray` → `water` → `rootHarvest` → `transport` | `tractor`, `plow`, `rotavator`, `spreader`, `ridgeMulcher`, `garlicOnionPlanter`, `sprayer`, `agriDrone`, `rootHarvester`, `carrier`, `loader` | 파종·수확 인력 의존도가 높은 작목으로 마늘 파종기 및 줄기절단·굴취기·수집수확기 일관 보급 |
| `onion` | **양파** | 가을정식(10~6월) / 성수기: 10·11·4·5·6월 | `deepTill` → `till` → `spreadFertilizer` → `ridge` → `mulch` → `garlicOnionPlant` → `spray` → `water` → `rootHarvest` → `transport` | `tractor`, `plow`, `rotavator`, `spreader`, `ridgeMulcher`, `garlicOnionPlanter`, `transplanter`, `sprayer`, `rootHarvester`, `carrier`, `loader` | 승용·보행형 양파 정식기 및 줄기절단·굴취·수집형 수확기 활용 |
| `radish` | **무** | 봄(3~6월), 고랭지(6~9월), 김장(8~11월) / 성수기: 3·4·8~11월 | `deepTill` → `till` → `spreadFertilizer` → `ridge` → `mulch` → `directSeed` → `spray` → `water` → `rootHarvest` → `transport` | `tractor`, `plow`, `rotavator`, `spreader`, `ridgeMulcher`, `ridingCultivator`, `sprayer`, `rootHarvester`, `carrier`, `loader` | 직근 발육을 위한 30cm 내외 심경 필수. 점파 파종기 및 인발/굴취형 수확기 활용 |
| `cabbage` | **배추** | 봄(3~6월), 고랭지(5~9월), 김장(8~11월) / 성수기: 4·5·8~11월 | `deepTill` → `till` → `spreadFertilizer` → `ridge` → `mulch` → `transplant` → `spray` → `water` → `transport` | `tractor`, `plow`, `rotavator`, `cultivator`, `spreader`, `ridgeMulcher`, `transplanter`, `sprayer`, `agriDrone`, `carrier`, `loader` | 기존 ID 보존. 배추·고추 범용 정식기 및 결구기 관수·운반차 투입 비중 높음 |
| `potato` | **감자** | 봄(3~6월), 고랭지(4~9월), 가을(8~11월) / 성수기: 3·4·6·7·8·10월 | `deepTill` → `till` → `spreadFertilizer` → `ridge` → `mulch` → `seed` → `hill` → `spray` → `potatoHarvest` → `transport` | `tractor`, `plow`, `rotavator`, `cultivator`, `spreader`, `ridgeMulcher`, `potatoPlanter`, `ridingCultivator`, `sprayer`, `potatoHarvester`, `carrier` | 기존 ID 보존. 전 과정 기계화 모델 정착(파종기 → 배토 북주기 → 진동/수집형 굴취기) |
| `greenOnion` | **대파** | 봄파종(3~10월), 월동(9~4월) / 성수기: 4·5·7·8·10·11월 | `deepTill` → `till` → `spreadFertilizer` → `ridge` → `transplant` → `hill` → `spray` → `water` → `rootHarvest` → `transport` | `tractor`, `plow`, `rotavator`, `cultivator`, `spreader`, `ridgeMulcher`, `transplanter`, `ridingCultivator`, `sprayer`, `rootHarvester`, `carrier` | 연백부 생육을 위해 관리기 배토(`hill`) 작업 2~3회 필수. 트랙터 부착 대파 굴취기 활용 |
| `ginger` | **생강** | 노지(4~11월) / 성수기: 4·5·7·8·10·11월 | `deepTill` → `till` → `spreadFertilizer` → `ridge` → `mulch` → `directSeed` → `spray` → `water` → `rootHarvest` → `transport` | `tractor`, `plow`, `rotavator`, `cultivator`, `spreader`, `ridgeMulcher`, `sprayer`, `rootHarvester`, `carrier`, `tiller` | 된서리 전(10월 하순~11월 상순) 줄기 제거 후 굴취기 수확, 수확 후 큐어링·저장 이동 |

---

### C. 과수 (4개: `apple`, `pear`, `peach`, `grape`)

과수원은 다년생 영년작물 특성상 경운·정식보다 **정지·전정 및 잔가지 파쇄(`orchard`: `pruneShred`), SS기 방제(`orchardSpray`), 초생 예초(`weedMow`), 관수(`water`), 운반(`transport`)**이 핵심 기계화 공정이다.

| 작물 ID | 작물명 | 수확기 / 성수기 | 단계별 핵심 농작업 | 추천 농기계 (`machineTypes`) | 현장·기계화 참고 |
|---|---|---|---|---|---|
| `apple` | **사과** | 9~11월 수확 / 성수기: 2·3·5·6·7·9·10·11월 | `spreadFertilizer` → `pruneShred` → `orchardSpray` → `water` → `weedMow` → `transport` | `spreader`, `tractor`, `shredder`, `speedSprayer`, `sprayer`, `mower`, `ridingCultivator`, `carrier`, `loader` | 동계 전정 후 잔가지 파쇄기 필수, SS기 정기 방제 및 다축형 스마트 과원 확산 |
| `pear` | **배** | 8~10월 수확 / 성수기: 2·3·4·6·8·9·10월 | `spreadFertilizer` → `pruneShred` → `orchardSpray` → `water` → `weedMow` → `transport` | `spreader`, `tractor`, `shredder`, `speedSprayer`, `sprayer`, `mower`, `ridingCultivator`, `carrier`, `loader` | 흑성병·꼬마배나무이 SS기 방제, 초생재배 승용 제초기 활용 |
| `peach` | **복숭아** | 6~9월 수확 / 성수기: 2·3·5·6·7·8·9월 | `spreadFertilizer` → `pruneShred` → `orchardSpray` → `water` → `weedMow` → `transport` | `spreader`, `tractor`, `shredder`, `speedSprayer`, `sprayer`, `mower`, `ridingCultivator`, `carrier` | 세균구멍병·복숭아순나방 방제, 수확물 타박상 방지를 위한 저속 운반차 중요 |
| `grape` | **포도** | 7~10월 수확 / 성수기: 2·3·5·6·8·9·10월 | `spreadFertilizer` → `pruneShred` → `orchardSpray` → `water` → `weedMow` → `transport` | `spreader`, `cultivator`, `tractor`, `shredder`, `speedSprayer`, `sprayer`, `mower`, `carrier`, `tiller` | 비가림·덕 시설 내 소형 운반차 및 열간 예초기 활용 |

---

### D. 시설·특용 (3개: `strawberry`, `tomato`, `sesame`)

| 작물 ID | 작물명 | 주요 작형 / 성수기 | 단계별 핵심 농작업 | 추천 농기계 (`machineTypes`) | 현장·기계화 참고 |
|---|---|---|---|---|---|
| `strawberry` | **딸기** | 촉성(9~5월), 반촉성(1~6월) / 성수기: 8·9·11~4월 | `till` → `spreadFertilizer` → `ridge` → `mulch` → `transplant` → `spray` → `water` → `transport` | `cultivator`, `tractor`, `rotavator`, `spreader`, `ridgeMulcher`, `transplanter`, `sprayer`, `carrier` | 하우스 내 저속 안전 작업 권고. 고설수경재배 확산에 따라 좁은 통로용 전동 운반차 수요 높음 |
| `tomato` | **토마토** | 촉성·반촉성·억제 연중재배 / 성수기: 3~6·9~11월 | `till` → `spreadFertilizer` → `ridge` → `mulch` → `transplant` → `spray` → `water` → `transport` | `cultivator`, `tractor`, `rotavator`, `spreader`, `ridgeMulcher`, `transplanter`, `sprayer`, `carrier` | 토경 시 소형 관리기 로터리·멀칭, 수확 상자 이송용 전동 운반차·관비 장치 활용 |
| `sesame` | **참깨·들깨** | 참깨(5~8월), 들깨(6~10월) / 성수기: 5~10월 | `till` → `spreadFertilizer` → `ridge` → `mulch` → `directSeed`/`transplant` → `spray` → `thresh` → `transport` | `tractor`, `rotavator`, `cultivator`, `spreader`, `ridgeMulcher`, `transplanter`, `sprayer`, `agriDrone`, `thresher`, `combine`, `carrier`, `tiller` | 장마 전 역병·잎마름병 예방 방제 필수. 탈립 방지를 위한 적기 예취 후 탈곡기·선별기 처리 |

---

## 3. 신뢰 출처 (Verified Official Sources)

1. **농촌진흥청 농사로 (식량작물 농업기술길잡이)**: https://www.nongsaro.go.kr/portal/ps/psb/psbx/cropEbookMain.ps?menuId=PS65290&stdPrdlstCode=FC&sSearchType=srchType01
2. **농촌진흥청 농사로 (채소 농업기술길잡이)**: https://www.nongsaro.go.kr/portal/ps/psb/psbx/cropEbookLst.ps?menuId=PS65290&stdPrdlstCode=VC&sStdPrdlstCode=VC021001&totalSearchYn=Y
3. **농촌진흥청 농사로 (시설채소 농업기술길잡이)**: https://www.nongsaro.go.kr/portal/ps/psb/psbx/cropEbookLst.ps?menuId=PS65290&stdPrdlstCode=VC&sStdPrdlstCode=VC010804
4. **농촌진흥청 농사로 (과수 농업기술길잡이)**: https://www.nongsaro.go.kr/portal/ps/psb/psbx/cropEbookLst.ps?menuId=PS65290&stdPrdlstCode=FT&sStdPrdlstCode=FT020604
5. **농촌진흥청 농사로 (특용작물 농업기술길잡이)**: https://www.nongsaro.go.kr/portal/ps/psb/psbx/cropEbookLst.ps?menuId=PS65290&stdPrdlstCode=PG&sStdPrdlstCode=PG01PG12&totalSearchYn=Y
6. **농촌진흥청 농사로 (농작업일정 및 재배력)**: https://www.nongsaro.go.kr/portal/ps/psb/psbl/workScheduleDtl.ps?menuId=PS00087&cntntsNo=30625
7. **국립식량과학원 (콩 수확후처리 일관 기계화 시스템)**: https://www.nics.go.kr/bbs/view.do?m=100000126&bbsSn=569628&homepageSeCode=nics&bbsId=research
8. **국립식량과학원 (맥류 기계화 일관작업 연구)**: https://www.nics.go.kr/bbs/view.do?m=100000126&bbsSn=202725&homepageSeCode=nics&bbsId=research
9. **국립식량과학원 (식량작물 작목별 종합정보)**: https://www.nics.go.kr/oneStopApi/oneStopCrop.do?subCategoryCode=IC011601&subTechCode=GS&homepageSeCode=oneStopIndex&m=700000190
10. **국립원예특작과학원 (과수 재배기술정보)**: https://fruit.nihhs.go.kr/apple/openApi/cropTechInfo.do
11. **농촌진흥청 (밭작물 전 과정 기계화 모델 영농정보)**: https://www.rda.go.kr/board/board.do?boardId=farmprmninfo&prgId=day_farmprmninfoEntry&currPage=8&dataNo=100000810883&mode=updateCnt
12. **농촌진흥청 (농사로 연계 작목 DB)**: https://www.rda.go.kr/middlePopOpenPopNongsaroDBView.do?no=1402
13. **통계청 KOSIS (농업기계 보유 및 이용 실태 통계)**: https://kosis.kr/statHtml/statHtml.do?orgId=143&tblId=DT_143004N_025
