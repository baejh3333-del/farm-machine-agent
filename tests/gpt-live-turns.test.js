// gpt-live full-duplex 발화 식별·타임스탬프·정정 인식(조회 결과 무효화, 쓰기 결과 보존) 테스트.
import test from "node:test";
import assert from "node:assert/strict";
import { createGptLiveController, isCorrectionUtterance, isWriteDelegationResult } from "../src/ai/gpt-live.js";

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

function makeLive(overrides = {}) {
  const sent = [];
  const listeners = {};
  const track = { enabled: true, stop() {} };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const channel = {
    readyState: "open",
    send: (s) => sent.push(JSON.parse(s)),
    addEventListener: (t, f) => { listeners[t] = f; },
    close() {},
  };
  class FakePC {
    constructor() { this.iceGatheringState = "complete"; this.localDescription = { sdp: "offer" }; }
    addEventListener() {}
    removeEventListener() {}
    addTrack() {}
    createDataChannel() { return channel; }
    async createOffer() { return { type: "offer", sdp: "offer" }; }
    async setLocalDescription() {}
    async setRemoteDescription() {}
    close() {}
  }
  const calls = { user: [], committed: [], delegations: [], states: [] };
  const live = createGptLiveController({
    region: "영양읍",
    history: [],
    PeerConnectionCtor: FakePC,
    getUserMedia: async () => stream,
    createSession: async () => ({ transport: { sdp: "answer" } }),
    audioElement: { autoplay: false, srcObject: null, pause() {} },
    closeTimeoutMs: 20,
    userQuietMs: 0,
    speakingIdleMs: 20,
    onState: (s) => calls.states.push(s),
    onUserTranscriptDelta: (e) => calls.user.push(e),
    onTurnCommitted: (turn, meta) => calls.committed.push({ turn, meta }),
    onClientDelegation: async (payload, meta) => {
      calls.delegations.push({ payload, meta });
      return overrides.delegate ? overrides.delegate(payload, meta) : { spokenSummary: `결과:${payload.userText}` };
    },
    ...overrides.options,
  });
  const emit = (e) => listeners.message({ data: JSON.stringify(e) });
  const spoken = () => sent.filter((m) => m.type === "session.commentary.append" && m.delegation_id).map((m) => m.content);
  return { live, sent, emit, calls, spoken };
}

test("정정 표현 인식: '아니'·'말고'는 정정, '아니면'·일반 요청은 아니다", () => {
  for (const t of ["아니 콤바인으로", "아뇨, 내일이요", "음 아니야 금요일", "트랙터 말고 콤바인", "그게 아니라 구매요", "취소하고 다시"]) {
    assert.equal(isCorrectionUtterance(t), true, t);
  }
  for (const t of ["트랙터 아니면 콤바인도 괜찮아", "트랙터 빌려줘", "금요일은 날씨 어때?", ""]) {
    assert.equal(isCorrectionUtterance(t), false, t);
  }
});

test("쓰기 결과 판별: effect 메타데이터가 우선이고, 없으면 예약·등록·수정·완료 outcome으로 본다", () => {
  assert.equal(isWriteDelegationResult({ effect: "write" }), true);
  assert.equal(isWriteDelegationResult({ effect: "read", result: { reservation: {} } }), false);
  assert.equal(isWriteDelegationResult({ result: { reservation: { id: 1 } } }), true);
  assert.equal(isWriteDelegationResult({ result: { createdListing: { id: 1 } } }), true);
  assert.equal(isWriteDelegationResult({ result: { updatedListing: { id: 1 } } }), true);
  assert.equal(isWriteDelegationResult({ result: { outcome: "partial" } }), true);
  assert.equal(isWriteDelegationResult({ result: { outcome: "failed" } }), false);
  assert.equal(isWriteDelegationResult({ result: { listingIds: ["a"], pendingAction: { title: "예약" } } }), false);
  assert.equal(isWriteDelegationResult(null), false);
});

test("발화마다 utteranceId를 붙이고 start/end 타임스탬프를 커밋·위임 메타데이터로 넘긴다", async () => {
  const { live, emit, calls } = makeLive();
  await live.start();
  emit({ type: "session.started" });
  emit({ type: "session.input_transcript.delta", delta: "콤바인 ", start_ms: 100, end_ms: 400 });
  emit({ type: "session.input_transcript.delta", delta: "있어?", start_ms: 400, end_ms: 900 });
  assert.equal(calls.user[0].utteranceId, calls.user[1].utteranceId);
  assert.equal(calls.user[1].startMs, 400); // delta 자체 타임스탬프는 그대로 전달
  assert.equal(live.utteranceId, calls.user[0].utteranceId);
  assert.equal(live.speechRevision, 1);

  emit({ type: "session.output_transcript.delta", delta: "네, 있어요.", start_ms: 1000, end_ms: 1500 });
  const userCommit = calls.committed.find((c) => c.turn.role === "user");
  assert.deepEqual(userCommit.turn, { role: "user", text: "콤바인 있어?" });
  assert.deepEqual(userCommit.meta, {
    utteranceId: calls.user[0].utteranceId, startMs: 100, endMs: 900, speechRevision: 1, taskRevision: 0, correction: false,
  });
  await tick(40);
  const assistantCommit = calls.committed.find((c) => c.turn.role === "assistant");
  assert.deepEqual(assistantCommit.meta, {
    utteranceId: assistantCommit.meta.utteranceId, replyTo: calls.user[0].utteranceId, delegationId: null, startMs: 1000, endMs: 1500, kind: "reply",
  });
  assert.match(assistantCommit.meta.utteranceId, /^ast_/);

  // 다음 발화는 새 id, 위임에는 그 발화의 메타데이터가 간다.
  emit({ type: "session.input_transcript.delta", delta: "트랙터 빌려줘", start_ms: 2000, end_ms: 2600 });
  emit({ type: "session.delegation.created", delegation: { id: "d1", target: "client" } });
  await tick();
  const { payload, meta } = calls.delegations[0];
  assert.deepEqual(payload, { delegationId: "d1", userText: "트랙터 빌려줘", userTurnCommitted: false });
  assert.notEqual(meta.utteranceId, calls.user[0].utteranceId);
  assert.equal(meta.startMs, 2000);
  assert.equal(meta.endMs, 2600);
  assert.equal(meta.speechRevision, 2);
  assert.equal(meta.isStale(), false);
});

test("정정 발화 뒤에 도착한 이전 조회 결과는 말하지 않고 모델에게만 무효라고 알린다", async () => {
  const gates = { 첫: deferred() };
  const { live, emit, calls, spoken, sent } = makeLive({
    delegate: async (payload) => {
      if (payload.userText === "트랙터 빌려줘") { await gates.첫.promise; return { spokenSummary: "트랙터 3대 있어요", effect: "read" }; }
      return { spokenSummary: "콤바인 2대 있어요" };
    },
  });
  await live.start();
  emit({ type: "session.started" });
  emit({ type: "session.input_transcript.delta", delta: "트랙터 빌려줘" });
  emit({ type: "session.delegation.created", delegation: { id: "old", target: "client" } });
  await tick();
  assert.equal(live.taskRevision, 0);

  // 결과를 기다리는 동안 사용자가 정정한다.
  emit({ type: "session.input_transcript.delta", delta: "아니 콤바인으로" });
  assert.equal(calls.user.at(-1).correction, true);
  assert.equal(live.taskRevision, 1);
  assert.equal(calls.delegations[0].meta.isStale(), true);
  emit({ type: "session.delegation.created", delegation: { id: "new", target: "client" } });
  await tick();
  assert.equal(calls.delegations[1].meta.correction, true);
  assert.equal(calls.delegations[1].meta.isStale(), false);
  assert.equal(live.state, "thinking"); // 이전 위임이 아직 끝나지 않았다.

  gates.첫.resolve();
  await tick();
  assert.equal(live.state, "listening");
  assert.deepEqual(spoken(), ["콤바인 2대 있어요"]);
  const stale = sent.find((m) => m.event_id?.startsWith("stale_"));
  assert.equal(stale.type, "session.thinking.append");
  assert.equal(stale.delegation_id, "old");
});

test("정정 전에 확인 중 상태가 남아 있으면 새 위임이 끝날 때까지 유지한다", async () => {
  const gates = { old: deferred(), next: deferred() };
  const { live, emit } = makeLive({
    delegate: async (payload) => {
      await (payload.delegationId === "old" ? gates.old : gates.next).promise;
      return { spokenSummary: payload.userText };
    },
  });
  await live.start();
  emit({ type: "session.started" });
  emit({ type: "session.input_transcript.delta", delta: "트랙터 빌려줘" });
  emit({ type: "session.delegation.created", delegation: { id: "old", target: "client" } });
  emit({ type: "session.input_transcript.delta", delta: "아니 이앙기" });
  emit({ type: "session.delegation.created", delegation: { id: "next", target: "client" } });
  await tick();
  assert.equal(live.state, "thinking");
  gates.old.resolve();
  await tick();
  assert.equal(live.state, "thinking"); // 무효가 된 이전 결과가 와도 새 위임을 기다리는 중
  gates.next.resolve();
  await tick();
  assert.equal(live.state, "listening");
});

test("사용자가 말하는 동안 줄 서 있던 조회 결과는 정정이 들어오면 버리고, 독립적인 새 요청이면 그대로 들려준다", async () => {
  // 1) 정정 → 줄 선 조회 결과 버림
  {
    const { live, emit, spoken } = makeLive({ options: { userQuietMs: 60 } });
    await live.start();
    emit({ type: "session.started" });
    emit({ type: "session.input_transcript.delta", delta: "트랙터 빌려줘" });
    emit({ type: "session.delegation.created", delegation: { id: "q1", target: "client" } });
    // 결과가 오기 직전에 사용자가 다시 말을 시작한다 → 결과는 줄을 선다.
    emit({ type: "session.input_transcript.delta", delta: "음 " });
    await tick();
    assert.deepEqual(spoken(), []);
    emit({ type: "session.input_transcript.delta", delta: "아니 콤바인" });
    await tick(120);
    assert.deepEqual(spoken(), []);
    await live.stop();
  }
  // 2) 독립 요청 → 이전 결과 유지, 말이 끝난 뒤 들려줌
  {
    const { live, emit, spoken } = makeLive({ options: { userQuietMs: 60 } });
    await live.start();
    emit({ type: "session.started" });
    emit({ type: "session.input_transcript.delta", delta: "트랙터 빌려줘" });
    emit({ type: "session.delegation.created", delegation: { id: "q2", target: "client" } });
    emit({ type: "session.input_transcript.delta", delta: "그리고 내일 날씨는?" });
    await tick();
    assert.deepEqual(spoken(), []);
    assert.equal(live.taskRevision, 0);
    await tick(120);
    assert.deepEqual(spoken(), ["결과:트랙터 빌려줘"]);
    await live.stop();
  }
});

test("독립적인 두 작업의 결과는 순서가 바뀌어 와도 둘 다 들려준다", async () => {
  const gates = { a: deferred(), b: deferred() };
  const { live, emit, spoken } = makeLive({
    delegate: async (payload) => {
      await (payload.delegationId === "a" ? gates.a : gates.b).promise;
      return { spokenSummary: `결과:${payload.userText}` };
    },
  });
  await live.start();
  emit({ type: "session.started" });
  emit({ type: "session.input_transcript.delta", delta: "트랙터 찾아줘" });
  emit({ type: "session.delegation.created", delegation: { id: "a", target: "client" } });
  emit({ type: "session.input_transcript.delta", delta: "내일 날씨 알려줘" });
  emit({ type: "session.delegation.created", delegation: { id: "b", target: "client" } });
  gates.b.resolve();
  await tick();
  gates.a.resolve();
  await tick();
  assert.deepEqual(spoken(), ["결과:내일 날씨 알려줘", "결과:트랙터 찾아줘"]);
});

test("정정이 와도 실제로 쓴 결과(예약 완료)와 실패 안내는 버리지 않는다", async () => {
  const gates = { write: deferred(), inferred: deferred(), fail: deferred() };
  const { live, emit, spoken } = makeLive({
    delegate: async (payload) => {
      if (payload.delegationId === "w") { await gates.write.promise; return { spokenSummary: "예약했어요", effect: "write" }; }
      if (payload.delegationId === "i") { await gates.inferred.promise; return { spokenSummary: "판매글 올렸어요", result: { createdListing: { id: "L1" } } }; }
      if (payload.delegationId === "f") { await gates.fail.promise; throw new Error("network"); }
      return { spokenSummary: "정정 결과" };
    },
    options: { onError: () => {} },
  });
  await live.start();
  emit({ type: "session.started" });
  emit({ type: "session.input_transcript.delta", delta: "트랙터 예약해줘" });
  emit({ type: "session.delegation.created", delegation: { id: "w", target: "client" } });
  emit({ type: "session.input_transcript.delta", delta: "판매글 올려줘" });
  emit({ type: "session.delegation.created", delegation: { id: "i", target: "client" } });
  emit({ type: "session.input_transcript.delta", delta: "구매해줘" });
  emit({ type: "session.delegation.created", delegation: { id: "f", target: "client" } });
  emit({ type: "session.input_transcript.delta", delta: "아니 그게 아니라" });
  emit({ type: "session.delegation.created", delegation: { id: "c", target: "client" } });
  await tick();
  gates.write.resolve();
  gates.inferred.resolve();
  gates.fail.resolve();
  await tick(10);
  const out = spoken();
  assert.ok(out.includes("예약했어요"));
  assert.ok(out.includes("판매글 올렸어요"));
  assert.ok(out.some((t) => /연결 문제/.test(t)));
  assert.ok(out.includes("정정 결과"));
});

test("정정 뒤에도 줄 서 있던 쓰기 결과와 UI 안내는 말이 끝나면 들려준다", async () => {
  const { live, emit, sent } = makeLive({
    options: { userQuietMs: 60 },
    delegate: async () => ({ spokenSummary: "예약 완료했어요", result: { reservation: { id: "r1" } } }),
  });
  await live.start();
  emit({ type: "session.started" });
  emit({ type: "session.input_transcript.delta", delta: "트랙터 예약해줘" });
  emit({ type: "session.delegation.created", delegation: { id: "w1", target: "client" } });
  emit({ type: "session.input_transcript.delta", delta: "음" });
  live.notifyUiEvent("지도에서 영양읍을 골랐어요");
  await tick();
  emit({ type: "session.input_transcript.delta", delta: " 아니 콤바인" });
  await tick(120);
  const contents = sent.filter((m) => m.type === "session.commentary.append").map((m) => m.content);
  assert.ok(contents.includes("예약 완료했어요"));
  assert.ok(contents.includes("지도에서 영양읍을 골랐어요"));
  await live.stop();
});

test("세션을 다시 시작하면 발화 상태를 초기화하지만 utteranceId는 겹치지 않는다", async () => {
  const { live, emit, calls } = makeLive();
  await live.start();
  emit({ type: "session.started" });
  emit({ type: "session.input_transcript.delta", delta: "안녕" });
  const first = calls.user[0].utteranceId;
  const stopping = live.stop();
  emit({ type: "session.closed" });
  await stopping;
  assert.equal(live.utteranceId, null);
  await live.start();
  emit({ type: "session.started" });
  emit({ type: "session.input_transcript.delta", delta: "다시" });
  assert.notEqual(calls.user.at(-1).utteranceId, first);
});

test("정정은 바로 앞 작업만 무효로 하고, 관련 없는 이전 작업 결과는 그대로 들려준다", async () => {
  const gates = { a: deferred(), b: deferred() };
  const { live, emit, calls, spoken } = makeLive({
    delegate: async (payload) => {
      if (payload.delegationId === "a") { await gates.a.promise; return { spokenSummary: "트랙터 3대 있어요" }; }
      if (payload.delegationId === "b") { await gates.b.promise; return { spokenSummary: "내일은 맑아요" }; }
      return { spokenSummary: "모레는 비가 와요" };
    },
  });
  await live.start();
  emit({ type: "session.started" });
  emit({ type: "session.input_transcript.delta", delta: "트랙터 찾아줘" });
  emit({ type: "session.delegation.created", delegation: { id: "a", target: "client" } });
  emit({ type: "session.input_transcript.delta", delta: "내일 날씨 알려줘" });
  emit({ type: "session.delegation.created", delegation: { id: "b", target: "client" } });
  emit({ type: "session.input_transcript.delta", delta: "아니 모레 날씨" });
  emit({ type: "session.delegation.created", delegation: { id: "c", target: "client" } });
  await tick();
  const meta = Object.fromEntries(calls.delegations.map((d) => [d.payload.delegationId, d.meta]));
  assert.equal(meta.a.isStale(), false); // 관련 없는 작업은 그대로
  assert.equal(meta.b.isStale(), true); // 정정 대상
  assert.equal(meta.c.isStale(), false);
  gates.a.resolve();
  gates.b.resolve();
  await tick();
  assert.deepEqual(spoken(), ["모레는 비가 와요", "트랙터 3대 있어요"]);

  // 두 번째 정정은 그다음 최근 작업(c)을 겨냥하고, 이미 정정된 b나 관련 없는 a에는 영향이 없다.
  emit({ type: "session.input_transcript.delta", delta: "아니 글피" });
  assert.equal(meta.c.isStale(), true);
  assert.equal(meta.a.isStale(), false);
});

test("줄에서 꺼내 말할 때 다시 확인한다: 어느 기종인지 애매한 정정은 되묻고, 답한 작업만 버리고 나머지는 말한다", async () => {
  const { live, emit, spoken, sent } = makeLive({ options: { userQuietMs: 60 } });
  await live.start();
  emit({ type: "session.started" });
  emit({ type: "session.input_transcript.delta", delta: "트랙터 찾아줘" });
  emit({ type: "session.delegation.created", delegation: { id: "x", target: "client" } });
  emit({ type: "session.input_transcript.delta", delta: "콤바인도 찾아줘" });
  emit({ type: "session.delegation.created", delegation: { id: "y", target: "client" } });
  emit({ type: "session.input_transcript.delta", delta: "음" }); // 사용자가 계속 말하는 중 → 두 결과 모두 줄을 선다.
  await tick();
  assert.deepEqual(spoken(), []);
  emit({ type: "session.input_transcript.delta", delta: " 아니 이앙기로" }); // 트랙터·콤바인 둘 다 기종 조건이 맞는다.
  await tick(120);
  assert.deepEqual(spoken(), [], "대상이 정해질 때까지 두 조회 결과 모두 잡아 둔다");
  emit({ type: "session.delegation.created", delegation: { id: "z", target: "client" } }); // 정정 발화가 끝난다.
  await tick(120);
  assert.deepEqual(live.pendingClarification, ["x", "y"]);
  assert.ok(sent.some((m) => m.event_id?.startsWith("clarify_") && /트랙터 찾기, 콤바인 찾기 중에 어느 요청을 바꿀까요/.test(m.content)));
  assert.deepEqual(spoken(), ["결과:음 아니 이앙기로"], "정정 발화 자신의 결과는 잡아 두지 않는다");
  emit({ type: "session.input_transcript.delta", delta: "콤바인이요" });
  emit({ type: "session.output_transcript.delta", delta: "네" }); // 답 발화가 끝난다.
  await tick(120);
  assert.equal(live.pendingClarification, null);
  assert.deepEqual(spoken(), ["결과:음 아니 이앙기로", "결과:트랙터 찾아줘"]);
  await live.stop();
});

test("쓰기 결과는 정정이 와도 남기되, 사용자가 말하는 동안에는 끼어들지 않고 말이 끝난 뒤 보낸다", async () => {
  const gate = deferred();
  const { live, emit, spoken } = makeLive({
    options: { userQuietMs: 80 },
    delegate: async () => { await gate.promise; return { spokenSummary: "예약 완료했어요", result: { reservation: { id: "r1" } } }; },
  });
  await live.start();
  emit({ type: "session.started" });
  emit({ type: "session.input_transcript.delta", delta: "트랙터 예약해줘" });
  emit({ type: "session.delegation.created", delegation: { id: "w", target: "client" } });
  emit({ type: "session.input_transcript.delta", delta: "아니 콤바인으로" });
  gate.resolve();
  await tick();
  assert.deepEqual(spoken(), []); // 사용자가 말하는 중
  await tick(150);
  assert.deepEqual(spoken(), ["예약 완료했어요"]);
  await live.stop();
});

test("어시스턴트 부분 delta는 같은 발화 동안 같은 utteranceId를 쓰고, 커밋 메타와 일치하며 위임 낭독에는 delegationId가 붙는다", async () => {
  const assistantDeltas = [];
  const { live, emit, calls } = makeLive({
    options: { onAssistantTranscriptDelta: (payload, meta) => assistantDeltas.push({ payload, meta }) },
  });
  await live.start();
  emit({ type: "session.started" });
  emit({ type: "session.input_transcript.delta", delta: "안녕" });
  emit({ type: "session.output_transcript.delta", delta: "안녕하세요, ", start_ms: 10, end_ms: 20 });
  emit({ type: "session.output_transcript.delta", delta: "반가워요.", start_ms: 20, end_ms: 30 });
  assert.deepEqual(assistantDeltas[0].payload, { delta: "안녕하세요, ", startMs: 10, endMs: 20 });
  const firstId = assistantDeltas[0].meta.utteranceId;
  assert.equal(assistantDeltas[1].meta.utteranceId, firstId);
  assert.equal(assistantDeltas[0].meta.replyTo, calls.user[0].utteranceId);
  await tick(40);
  const commit = calls.committed.find((c) => c.turn.role === "assistant");
  assert.equal(commit.meta.utteranceId, firstId);

  // 위임 결과 낭독: 새 발화 id, delegationId 연결
  emit({ type: "session.input_transcript.delta", delta: "트랙터 찾아줘" });
  emit({ type: "session.delegation.created", delegation: { id: "d9", target: "client" } });
  await tick();
  emit({ type: "session.output_transcript.delta", delta: "트랙터가 있어요." });
  const last = assistantDeltas.at(-1).meta;
  assert.notEqual(last.utteranceId, firstId);
  assert.equal(last.delegationId, "d9");
});
