// 한국 시간 기준 날짜 도우미. 서버 응답의 Date 헤더로 기기 시간 차이를 맞춘다.
// 웹서버 시간과 내 기기 시간의 차이 (서버 응답의 Date 헤더로 맞춘다)
let serverTimeOffset = 0;
const serverNow = () => new Date(Date.now() + serverTimeOffset);
export const today = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(serverNow());
export const addDays = (isoDate, days) => {
  const d = new Date(`${isoDate}T12:00:00+09:00`);
  d.setUTCDate(d.getUTCDate() + days);
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
};
export const koreanDateParts = (isoDate) => {
  const d = new Date(`${isoDate}T12:00:00+09:00`);
  const fmt = (opts) => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", ...opts }).format(d);
  return { date: fmt({ year: "numeric", month: "long", day: "numeric" }), weekday: fmt({ weekday: "long" }) };
};
export async function syncServerTime() {
  try {
    const response = await fetch(location.pathname || "/", { method: "HEAD", cache: "no-store" });
    const header = response.headers.get("date");
    if (header) serverTimeOffset = new Date(header).getTime() - Date.now();
  } catch {
    // 서버 시간을 못 받으면 기기 시간을 그대로 쓴다
  }
}
