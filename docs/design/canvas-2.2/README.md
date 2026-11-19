# 모아농 디자인 2.1–2.2 (캔버스 '연동' 화면 3개)

Claude 디자인 캔버스에서 '(연동)'이라고 적힌 화면 3개를 그대로 옮긴 거예요.
피그마 파일의 '모아농 2.1·2.2 · 캔버스 연동' 페이지와 같은 화면이에요.

| 화면 | 바로 보기 | 미리보기 |
|---|---|---|
| 모아농 2.1 홈 · Desktop | [home.html](home.html) | [screenshots/home.jpg](screenshots/home.jpg) |
| 모아농 2.2 매물 찾기 · Desktop | [browse.html](browse.html) | [screenshots/browse.jpg](screenshots/browse.jpg) |
| 모아농 2.2 매물 상세 · Desktop | [detail.html](detail.html) | [screenshots/detail.jpg](screenshots/detail.jpg) |

## 폴더 구성

- `home.html`, `browse.html`, `detail.html`: 브라우저로 바로 열 수 있는 정적 화면이에요. 팝업은 닫힌 상태, 예약창은 올라온 상태로 고정돼 있어요. 움직임과 클릭은 동작하지 않아요.
- `assets/`: 화면에 쓰인 사진과 농농이 캐릭터예요.
- `screenshots/`: 화면 전체를 찍은 이미지예요.
- `source/*.dc.html`: 캔버스 원본 파일이에요. 캔버스 전용 런타임(`support.js`)에서 움직여서, 여기서 그대로 열면 화면이 보이지 않아요. 개발할 때 구조와 문구, 동작 로직을 참고하는 용도예요.

## 개발할 때 참고

- 글꼴은 Pretendard, 포인트 색은 #1E9B4B(진한 초록 #13773A)예요. 자세한 규칙은 `docs/brand/MOANONG_GUIDE.md`를 따라요.
- 매물·가격·후기·날씨·지도는 화면을 보여 주려고 넣은 예시 데이터예요. 실제 데이터로 바꿔야 해요.
- 매물 상세의 지도는 실제 지도가 아닌 그림이에요. 카카오맵 같은 지도 서비스를 붙여야 해요.
- 홈의 추천 매물 3개는 열 때마다 무작위로 바뀌어요. 정적 화면에는 캡처할 때 뽑힌 3개가 들어 있어요.
