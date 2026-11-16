// 농농 대화형 에이전트(/api/nongnong) 호출. 대화 기록은 화면이 들고 있다가 매번 함께 보낸다.
export async function askNongnong(messages) {
  const response = await fetch("/api/nongnong", {
    method: "POST",
    credentials: "same-origin",
    signal: AbortSignal.timeout(65_000),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.error || "농농이가 잠시 답할 수 없어요. 잠시 후 다시 시도해 주세요.");
    error.status = response.status;
    throw error;
  }
  if (!data || (data.mode === "agent" && typeof data.reply !== "string")) throw new Error("응답 형식이 올바르지 않습니다.");
  return data;
}
