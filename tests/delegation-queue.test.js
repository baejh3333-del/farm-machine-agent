import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { after, before, test } from "node:test";

import accountHandler from "../api/account.js";
import delegationJobsHandler from "../api/conversations.js";
import { isAuthorizedSweep } from "../server/delegation-sweep-api.js";
import { resetAuthCache } from "../server/account-auth.js";
import { sendMessage } from "../server/chat.js";
import { createPglitePool, kstToday, setPool } from "../server/db.js";
import {
  backoffDelayMs,
  classifyRunResult,
  enqueueDelegatedReply,
  getDelegationJobState,
  processDelegationJobs,
  requeueFailedDelegationJob,
} from "../server/delegation-queue.js";
import { createListing } from "../server/listings-service.js";
import { initEnvironment, runMigrations } from "../server/migrator.js";

function patchRes(res) {
  let code = 200;
  res.status = (c) => {
    code = c;
    return res;
  };
  res.json = (obj) => {
    if (!res.headersSent) res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(obj));
    return res;
  };
}

let pool;
let server;
let baseUrl;
const prevEnv = {};
const ENV_KEYS = ["APP_ENV", "DATABASE_URL", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "CRON_SECRET"];

async function signup(username, name) {
  const res = await fetch(`${baseUrl}/api/account?action=signup`, {
    method: "POST",
    headers: { origin: baseUrl, "content-type": "application/json" },
    body: JSON.stringify({ username, name, password: "Password123!" }),
  });
  const body = await res.json();
  assert.equal(res.status, 200, `signup failed: ${JSON.stringify(body)}`);
  return body.user;
}

let seq = 0;
async function makeConversation({ ownerMode = "off", buyerMode = "off" } = {}) {
  seq += 1;
  const owner = await signup(`dq_owner${seq}`, "소유");
  const buyer = await signup(`dq_buyer${seq}`, "구매");
  const { listing } = await createListing(
    owner,
    {
      id: randomUUID(),
      title: "관리기 임대",
      type: "rent",
      modelId: "asia-amc900",
      cropIds: ["pepper"],
      operations: ["till"],
      price: 100000,
      region: "영양읍",
      condition: "good",
      description: "직접 인수",
    },
    { pool }
  );
  const first = await sendMessage(buyer, { id: randomUUID(), listingId: listing.id, body: "내일 대여 가능할까요?" }, { pool });
  const conversationId = first.conversation.id;
  // 역할 API(chat.js)의 변경과 무관하게 큐만 검증하도록 모드는 직접 설정한다.
  await pool.query(`UPDATE conversations SET owner_ai_mode = $2, buyer_ai_mode = $3 WHERE id = $1`, [
    conversationId,
    ownerMode,
    buyerMode,
  ]);
  return { owner, buyer, listing, conversationId, firstSeq: first.message.seq };
}

async function jobRow(conversationId, role, triggerSeq) {
  const res = await pool.query(
    `SELECT * FROM delegation_jobs WHERE conversation_id = $1 AND target_role = $2 AND trigger_seq = $3`,
    [conversationId, role, triggerSeq]
  );
  return res.rows[0] || null;
}

async function makeDue(jobId) {
  await pool.query(`UPDATE delegation_jobs SET next_attempt_at = now() - interval '1 second' WHERE id = $1`, [jobId]);
}

const replyStub = (body) => async () => ({
  content: [{ type: "tool_use", id: `t_${randomUUID()}`, name: "send_proxy_reply", input: { body, confidence: "high" } }],
});

before(async () => {
  for (const k of ENV_KEYS) prevEnv[k] = process.env[k];
  delete process.env.DATABASE_URL;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.CRON_SECRET;
  process.env.APP_ENV = "test";

  pool = createPglitePool("memory://");
  setPool(pool);
  resetAuthCache();
  await initEnvironment({ env: "test", pool });
  const mig = await runMigrations({ env: "test", pool });
  assert.ok(mig.applied.includes("0010_delegation_jobs.sql"));

  const routes = new Map([
    ["/api/account", accountHandler],
    ["/api/delegation-jobs", delegationJobsHandler],
  ]);
  server = createServer(async (req, res) => {
    patchRes(res);
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const handler = routes.get(url.pathname);
    if (!handler) return res.status(404).json({});
    await handler(req, res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((r) => server?.close(r));
  await pool?.end();
  for (const [k, v] of Object.entries(prevEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

test("Q1. 같은 수신 이벤트를 여러 번(동시에) 넣어도 작업은 1건이다", async () => {
  const { conversationId, firstSeq } = await makeConversation({ ownerMode: "autonomous" });
  const results = await Promise.all(
    Array.from({ length: 6 }, () => enqueueDelegatedReply({ conversationId, triggerSeq: firstSeq, targetRole: "owner", pool }))
  );
  assert.equal(results.filter((r) => r.created).length, 1);
  assert.equal(new Set(results.map((r) => r.jobId)).size, 1);
  const cnt = await pool.query(`SELECT count(*)::int AS c FROM delegation_jobs WHERE conversation_id = $1`, [conversationId]);
  assert.equal(cnt.rows[0].c, 1);

  // 역할이 다르면 별개 이벤트
  const other = await enqueueDelegatedReply({ conversationId, triggerSeq: firstSeq, targetRole: "buyer", pool });
  assert.equal(other.created, true);

  await assert.rejects(() => enqueueDelegatedReply({ conversationId, triggerSeq: 0, targetRole: "owner", pool }), TypeError);
  await assert.rejects(() => enqueueDelegatedReply({ conversationId, triggerSeq: 1, targetRole: "seller", pool }), TypeError);
});

test("Q2. 기본 실행기: 큐 처리로 실제 AI 대리 답장 1건이 커밋되고, 재처리해도 중복되지 않는다", async () => {
  const { conversationId, firstSeq } = await makeConversation({ ownerMode: "autonomous" });
  await enqueueDelegatedReply({ conversationId, triggerSeq: firstSeq, targetRole: "owner", pool });

  const stats = await processDelegationJobs({
    pool,
    conversationId,
    runnerOptions: { call: replyStub("네, 내일 대여 가능합니다."), today: kstToday() },
  });
  assert.equal(stats.claimed, 1);
  assert.equal(stats.succeeded, 1);
  const job = await jobRow(conversationId, "owner", firstSeq);
  assert.equal(job.status, "succeeded");
  assert.equal(job.attempts, 1);
  assert.equal(job.lease_token, null);

  const msgs = await pool.query(
    `SELECT count(*)::int AS c FROM messages WHERE conversation_id = $1 AND sender_kind = 'ai_proxy' AND reply_to_seq = $2`,
    [conversationId, firstSeq]
  );
  assert.equal(msgs.rows[0].c, 1);

  // 이미 처리된 이벤트를 다시 넣고 처리해도 작업·답장은 늘지 않는다
  const again = await enqueueDelegatedReply({ conversationId, triggerSeq: firstSeq, targetRole: "owner", pool });
  assert.equal(again.created, false);
  const stats2 = await processDelegationJobs({ pool, conversationId, runnerOptions: { call: replyStub("중복") } });
  assert.equal(stats2.claimed, 0);

  // 임대 만료로 같은 작업이 다시 실행돼도(at-least-once) 답장은 1건 그대로다
  await pool.query(
    `UPDATE delegation_jobs SET status = 'running', lease_token = gen_random_uuid(), lease_until = now() - interval '1 second' WHERE id = $1`,
    [job.id]
  );
  const stats3 = await processDelegationJobs({ pool, conversationId, runnerOptions: { call: replyStub("중복2") } });
  assert.equal(stats3.succeeded, 1);
  const msgs2 = await pool.query(
    `SELECT count(*)::int AS c FROM messages WHERE conversation_id = $1 AND sender_kind = 'ai_proxy'`,
    [conversationId]
  );
  assert.equal(msgs2.rows[0].c, 1);
});

test("Q3. 일시 실패는 백오프 재시도, 상한 도달 시 failed로 남고 사용자 재시도로 복구된다", async () => {
  const { conversationId, firstSeq } = await makeConversation({ ownerMode: "autonomous" });
  const { jobId } = await enqueueDelegatedReply({ conversationId, triggerSeq: firstSeq, targetRole: "owner", pool });

  let calls = 0;
  const flaky = async () => {
    calls += 1;
    return { skipped: true, reason: "LLM_FAILED" };
  };

  const s1 = await processDelegationJobs({ pool, conversationId, runner: flaky });
  assert.equal(s1.retried, 1);
  let job = await jobRow(conversationId, "owner", firstSeq);
  assert.equal(job.status, "retry");
  assert.equal(job.last_reason, "LLM_FAILED");
  const delaySec = (new Date(job.next_attempt_at).getTime() - Date.now()) / 1000;
  assert.ok(delaySec > 20 && delaySec <= 31, `1차 백오프는 약 30초여야 함: ${delaySec}`);

  // 백오프 시간이 지나기 전에는 다시 가져가지 않는다
  const early = await processDelegationJobs({ pool, conversationId, runner: flaky });
  assert.equal(early.claimed, 0);

  for (let i = 2; i <= 4; i += 1) {
    await makeDue(jobId);
    await processDelegationJobs({ pool, conversationId, runner: flaky });
  }
  job = await jobRow(conversationId, "owner", firstSeq);
  assert.equal(job.status, "failed");
  assert.equal(job.attempts, 4);
  assert.equal(calls, 4);
  assert.ok(job.finished_at);

  await makeDue(jobId);
  const none = await processDelegationJobs({ pool, conversationId, runner: flaky });
  assert.equal(none.claimed, 0, "failed 작업은 자동으로 다시 실행되지 않는다");

  const state = await getDelegationJobState({ conversationId, targetRole: "owner", pool });
  assert.equal(state.failed.length, 1);
  assert.equal(state.failed[0].triggerSeq, firstSeq);
  assert.equal(state.failed[0].lastReason, "LLM_FAILED");
  const buyerState = await getDelegationJobState({ conversationId, targetRole: "buyer", pool });
  assert.equal(buyerState.failed.length, 0, "다른 역할의 실패는 보이지 않는다");

  const rq = await requeueFailedDelegationJob({ conversationId, triggerSeq: firstSeq, targetRole: "owner", pool });
  assert.equal(rq.requeued, true);
  const ok = await processDelegationJobs({ pool, conversationId, runner: async () => ({ action: "replied" }) });
  assert.equal(ok.succeeded, 1);
  job = await jobRow(conversationId, "owner", firstSeq);
  assert.equal(job.status, "succeeded");
  assert.equal(job.source, "manual");
});

test("Q4. 실행기 예외는 재시도하되, 오류 원문(비밀·사용자 입력)은 저장하지 않는다", async () => {
  const { conversationId, firstSeq } = await makeConversation({ ownerMode: "autonomous" });
  await enqueueDelegatedReply({ conversationId, triggerSeq: firstSeq, targetRole: "owner", pool });
  const secretish = "sk-live-SECRET-should-not-persist 사용자 메시지 원문";
  const boom = async () => {
    const err = new Error(secretish);
    err.code = "ECONNRESET";
    throw err;
  };
  const s = await processDelegationJobs({ pool, conversationId, runner: boom });
  assert.equal(s.retried, 1);
  const job = await jobRow(conversationId, "owner", firstSeq);
  assert.equal(job.status, "retry");
  assert.equal(job.last_reason, "RUNNER_ERROR");
  assert.equal(job.last_error, "Error:ECONNRESET");
  assert.ok(!JSON.stringify(job).includes("SECRET"));
});

test("Q5. 결과 분류: 최종 skip 사유는 성공 처리, 일시 사유만 재시도", () => {
  for (const reason of ["LLM_FAILED", "LLM_NO_ACTION", "LOCK_BUSY", "LLM_UNAVAILABLE"]) {
    assert.equal(classifyRunResult({ skipped: true, reason }), "retry", reason);
  }
  for (const reason of ["AI_MODE_OFF", "AI_PAUSED", "STALE_TRIGGER", "ALREADY_REPLIED", "POLICY_CHANGED", "MODE_CHANGED"]) {
    assert.equal(classifyRunResult({ skipped: true, reason }), "succeeded", reason);
  }
  assert.equal(classifyRunResult({ aborted: true, reason: "STALE_TRIGGER_ON_COMMIT" }), "succeeded");
  assert.equal(classifyRunResult({ retryable: true }), "retry");
  assert.equal(classifyRunResult({ action: "replied" }), "succeeded");
  assert.deepEqual([1, 2, 3, 9].map(backoffDelayMs), [30_000, 120_000, 600_000, 600_000]);
});

test("Q6. 프로세스가 실행 중 죽어도(임대 만료) 다른 처리기가 회수하고, 늦게 끝난 옛 처리기는 결과를 덮어쓰지 못한다", async () => {
  const { conversationId, firstSeq } = await makeConversation({ ownerMode: "autonomous" });
  const { jobId } = await enqueueDelegatedReply({ conversationId, triggerSeq: firstSeq, targetRole: "owner", pool });

  // 처리기 A: 실행 도중 임대가 만료되고(= 멈춘 프로세스), 처리기 B가 그 사이 회수해 성공시킨다.
  let bStats = null;
  const slowA = async () => {
    await pool.query(`UPDATE delegation_jobs SET lease_until = now() - interval '1 second' WHERE id = $1`, [jobId]);
    bStats = await processDelegationJobs({ pool, conversationId, runner: async () => ({ action: "replied", seq: 99 }) });
    return { skipped: true, reason: "LLM_FAILED" }; // A의 늦은 결과
  };
  const aStats = await processDelegationJobs({ pool, conversationId, runner: slowA });
  assert.equal(bStats.succeeded, 1);
  assert.equal(aStats.leaseLost, 1);
  const job = await jobRow(conversationId, "owner", firstSeq);
  assert.equal(job.status, "succeeded", "늦게 끝난 처리기 A가 B의 결과를 덮어쓰면 안 된다");
  assert.equal(job.attempts, 2);
});

test("Q7. 한 번의 스윕은 limit/동시성 상한을 지키고, 동시에 돈 두 스윕이 같은 작업을 두 번 실행하지 않는다", async () => {
  const convs = [];
  for (let i = 0; i < 4; i += 1) convs.push(await makeConversation({ ownerMode: "autonomous" }));
  for (const c of convs) {
    await enqueueDelegatedReply({ conversationId: c.conversationId, triggerSeq: c.firstSeq, targetRole: "owner", pool });
  }
  const runs = new Map();
  const counting = async (job) => {
    runs.set(job.id, (runs.get(job.id) || 0) + 1);
    await new Promise((r) => setTimeout(r, 5));
    return { action: "replied" };
  };
  const capped = await processDelegationJobs({ pool, runner: counting, limit: 1, concurrency: 3 });
  assert.equal(capped.claimed, 1);

  const [x, y] = await Promise.all([
    processDelegationJobs({ pool, runner: counting, limit: 10, concurrency: 2 }),
    processDelegationJobs({ pool, runner: counting, limit: 10, concurrency: 2 }),
  ]);
  for (const c of convs) {
    const job = await jobRow(c.conversationId, "owner", c.firstSeq);
    assert.equal(job.status, "succeeded");
    assert.equal(runs.get(job.id), 1, "각 작업은 정확히 1회 실행");
  }
  assert.ok(x.claimed + y.claimed >= 3);
  // 참고: PGlite는 단일 연결이라 실제 병렬 잠금 경합은 TEST_DATABASE_URL(실 PostgreSQL) 테스트에서 검증한다.
});

test("Q8. 누락 이벤트 보충: 자동 응대 역할의 최신 상대 메시지에 작업이 없으면 스윕이 만든다", async () => {
  const auto = await makeConversation({ ownerMode: "autonomous" });
  const offConv = await makeConversation({ ownerMode: "off" });
  const selfLast = await makeConversation({ ownerMode: "autonomous" });
  // 소유자가 마지막으로 말한 대화는 소유자 AI가 답할 이벤트가 아니다
  const ownerMsg = await sendMessage(selfLast.owner, { id: randomUUID(), conversationId: selfLast.conversationId, body: "직접 답할게요" }, { pool });
  // sendMessage 구현(역할 API)이 사람 발신 시 모드를 바꿀 수 있어 다시 고정한다
  await pool.query(`UPDATE conversations SET owner_ai_mode = 'autonomous' WHERE id = $1`, [selfLast.conversationId]);

  const ran = [];
  const stats = await processDelegationJobs({
    pool,
    backfill: true,
    runner: async (job) => {
      ran.push(job.conversationId);
      return { action: "replied" };
    },
  });
  assert.ok(stats.backfilled >= 1);
  const autoJob = await jobRow(auto.conversationId, "owner", auto.firstSeq);
  assert.equal(autoJob?.source, "backfill");
  assert.equal(autoJob?.status, "succeeded");
  assert.equal(await jobRow(offConv.conversationId, "owner", offConv.firstSeq), null);
  assert.equal(await jobRow(selfLast.conversationId, "owner", ownerMsg.message.seq), null);
  assert.equal(await jobRow(selfLast.conversationId, "buyer", ownerMsg.message.seq), null, "buyer 모드 off");

  // 이미 처리된 이벤트는 다시 보충하지 않는다
  const again = await processDelegationJobs({ pool, backfill: true, runner: async () => ({ action: "replied" }) });
  assert.equal(again.backfilled, 0);
});

test("Q9. 앱을 닫은 상태(요청 없음)에서도 스윕만으로 자동 응대가 진행된다", async () => {
  // 메시지는 커밋됐지만 즉시 처리 경로가 실행되지 못한 상황(프로세스 종료·브라우저 닫힘)을 만든다.
  const { conversationId, firstSeq } = await makeConversation({ ownerMode: "autonomous" });
  assert.equal(await jobRow(conversationId, "owner", firstSeq), null);

  // 정기 스윕(cron이 부르는 것과 같은 함수·옵션) — LLM만 스텁
  const stats = await processDelegationJobs({
    pool,
    backfill: true,
    limit: 10,
    runnerOptions: { call: replyStub("내일 오전 9시 인수 가능합니다."), today: kstToday() },
  });
  assert.ok(stats.succeeded >= 1);
  const reply = await pool.query(
    `SELECT body FROM messages WHERE conversation_id = $1 AND sender_kind = 'ai_proxy' AND reply_to_seq = $2`,
    [conversationId, firstSeq]
  );
  assert.equal(reply.rows.length, 1);
  assert.equal(reply.rows[0].body, "내일 오전 9시 인수 가능합니다.");
});

test("Q10. /api/delegation-jobs: 비밀 미설정 503, 잘못된 비밀 401, 올바른 Bearer만 스윕 실행", async () => {
  const call = (headers = {}, method = "GET") => fetch(`${baseUrl}/api/delegation-jobs`, { method, headers });

  delete process.env.CRON_SECRET;
  let res = await call({ authorization: "Bearer anything-anything-anything" });
  assert.equal(res.status, 503);

  process.env.CRON_SECRET = "short";
  res = await call({ authorization: "Bearer short" });
  assert.equal(res.status, 503, "너무 짧은 비밀은 설정되지 않은 것으로 본다");

  process.env.CRON_SECRET = "test-cron-secret-0123456789";
  res = await call();
  assert.equal(res.status, 401);
  res = await call({ authorization: "Bearer test-cron-secret-012345678" });
  assert.equal(res.status, 401);
  res = await call({ authorization: "test-cron-secret-0123456789" });
  assert.equal(res.status, 401, "Bearer 스킴 필수");
  res = await call({ authorization: "Bearer test-cron-secret-0123456789" }, "DELETE");
  assert.equal(res.status, 405);

  // 누락 이벤트 하나를 만들어 두면, LLM 키가 없는 테스트 환경에서는 재시도 상태로 기록돼야 한다(실제 처리 증거)
  const { conversationId, firstSeq } = await makeConversation({ ownerMode: "autonomous" });
  res = await call({ authorization: "Bearer test-cron-secret-0123456789" });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.ok(body.backfilled >= 1);
  assert.deepEqual(Object.keys(body).sort(), ["backfilled", "claimed", "failed", "leaseLost", "ok", "retried", "succeeded"]);
  const job = await jobRow(conversationId, "owner", firstSeq);
  assert.equal(job.status, "retry");
  assert.equal(job.last_reason, "LLM_UNAVAILABLE");

  assert.equal(isAuthorizedSweep({ headers: { authorization: "Bearer x" } }, "y".repeat(32)), false);
  assert.equal(isAuthorizedSweep({ headers: { authorization: `Bearer ${"y".repeat(32)}` } }, "y".repeat(32)), true);
});

test("Q11. 로컬 개발 서버 스위퍼는 간격 0이면 꺼지고, 기본은 켜진다", async () => {
  const { startLocalDelegationSweeper } = await import("../dev-server.js");
  assert.equal(startLocalDelegationSweeper({ intervalMs: 0 }), null);
  const timer = startLocalDelegationSweeper({ intervalMs: 60_000 });
  assert.ok(timer);
  clearInterval(timer);
});
