// 농농 첫마디 테스트
// Z.ai에 질문을 하나 보내고, 농농의 대답을 화면에 보여줘요.
// 실행: node --env-file=.env.local scripts/hello-nongnong.mjs

// 1) 금고(.env.local)에서 키를 꺼내요. 키는 코드에 직접 적지 않아요!
const apiKey = process.env.ZAI_API_KEY;
if (!apiKey) {
  console.error("❌ ZAI_API_KEY가 없어요. .env.local 파일을 확인하세요.");
  process.exit(1);
}

// 2) 어느 주소의, 어떤 AI 모델에게 물어볼지 정해요.
//    (교수님 키가 'Coding Plan' 키라면 .env.local에 ZAI_BASE_URL을 따로 적어서 바꿀 수 있어요.)
const BASE_URL = process.env.ZAI_BASE_URL || "https://api.z.ai/api/paas/v4";
const MODEL = process.env.ZAI_MODEL || "glm-4.7-flash";

// 3) 농농의 성격(시스템 프롬프트)과 사용자의 질문을 준비해요.
const messages = [
  {
    role: "system",
    content:
      "너는 농기계 대여 서비스 '모아농'의 AI 상담사 '농농'이야. " +
      "농사를 처음 시작한 분이나 어르신께 말하듯 쉽고 따뜻한 말로, 세 문장 이내로 답해.",
  },
  { role: "user", content: "안녕하세요, 처음 농사 짓는데 뭐부터 하면 될까요?" },
];

console.log(`📨 ${MODEL} 모델에게 질문을 보내는 중...`);

// 4) Z.ai 창구(API)로 질문을 보내요.
const response = await fetch(`${BASE_URL}/chat/completions`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: MODEL,
    messages,
    thinking: { type: "disabled" }, // 깊게 고민하는 모드는 꺼서 빠르게 답하게 해요.
  }),
});

const data = await response.json().catch(() => null);

// 5) 실패하면 이유를 보여줘요. (키는 화면에 나오지 않아요.)
if (!response.ok) {
  console.error(`❌ 요청 실패 (상태 코드 ${response.status})`);
  console.error(JSON.stringify(data?.error ?? data, null, 2));
  process.exit(1);
}

// 6) 성공하면 농농의 대답과 사용량을 보여줘요.
console.log("\n🌱 농농:", data.choices[0].message.content);
console.log("\n📊 사용한 토큰:", data.usage);
