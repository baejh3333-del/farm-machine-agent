// 대리 응대 작업 큐 정기 스윕 엔드포인트.
// vercel.json 크론은 Hobby 요금제 한도(하루 1회)에 맞춘 백스톱이다(매일 19:00 UTC = 04:00 KST).
// 분 단위 재시도·임대 회수는 server/delegation-kick.js의 트래픽 기반 스윕이 맡는다.
// 외부 스케줄러가 같은 Bearer 비밀로 이 주소를 더 자주 호출해도 된다(처리는 멱등).
// Vercel Cron은 `Authorization: Bearer ${CRON_SECRET}` 헤더로 GET 요청을 보낸다.
// 비밀이 설정되지 않았으면 503으로 거부하고, 일치하지 않으면 401을 돌려준다(익명 수동 스윕 없음).
// 응답에는 처리 건수만 담고 대화 내용이나 오류 원문은 담지 않는다.
import { createHash, timingSafeEqual } from "node:crypto";
import { fail, handle } from "../server/http.js";
import { processDelegationJobs } from "../server/delegation-queue.js";
import { isWritesFrozen } from "../server/migrator.js";

const MIN_SECRET_LENGTH = 16;

function digest(value) {
  return createHash("sha256").update(String(value), "utf8").digest();
}

export function isAuthorizedSweep(request, secret = process.env.CRON_SECRET) {
  if (typeof secret !== "string" || secret.length < MIN_SECRET_LENGTH) {
    fail(503, "SWEEP_NOT_CONFIGURED", "작업 스윕이 설정되지 않았습니다.");
  }
  const header = String(request.headers?.authorization || "");
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return false;
  // 길이가 달라도 비교 시간이 같도록 해시끼리 비교한다.
  return timingSafeEqual(digest(match[1].trim()), digest(secret));
}

export default handle(["GET", "POST"], async (request) => {
  if (!isAuthorizedSweep(request)) {
    fail(401, "UNAUTHORIZED", "인증되지 않은 요청입니다.");
  }
  if (await isWritesFrozen()) {
    return { status: 200, body: { ok: true, skipped: "WRITES_FROZEN" } };
  }
  const stats = await processDelegationJobs({
    limit: 10,
    concurrency: 2,
    budgetMs: 40_000,
    backfill: true,
  });
  return { status: 200, body: { ok: true, ...stats } };
});
