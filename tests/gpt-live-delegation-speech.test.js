// gpt-live 위임 대기 중 말하기: 접수 인사 1회, 실제 진행 소식 최대 1회(meta.onProgress), barge-in/resume, 중복·낡은 결과·겹침·재연결.
import test from "node:test";
import assert from "node:assert/strict";
import { cleanProgressLabel, createGptLiveController } from "../src/ai/gpt-live.js";

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

function makeLive({ delegate, options = {} } = {}) {
  const sent = [];
  let listeners = {};
  const track = { enabled: true, stop() {} };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const audio = { autoplay: false, srcObject: null, muted: false, pause() {} };
  class FakePC {
    constructor() { this.iceGatheringState = "complete"; this.localDescription = { sdp: "offer" }; }
    addEventListener() {}
    removeEventListener() {}
    addTrack() {}
    createDataChannel() {
      listeners = {};
      return { readyState: "open", send: (s) => sent.push(JSON.parse(s)), addEventListener: (t, f) => { listeners[t] = f; }, close() {} };
    }
    async createOffer() { return { type: "offer", sdp: "offer" }; }
    async setLocalDescription() {}
    async setRemoteDescription() {}
    close() {}
  }
  const calls = { committed: [], delegations: [], assistant: [], states: [] };
  const live = createGptLiveController({
    region: "영양읍",
    history: [],
    PeerConnectionCtor: FakePC,
    getUserMedia: async () => stream,
    createSession: async () => ({ transport: { sdp: "answer" } }),
    audioElement: audio,
    closeTimeoutMs: 20,
    userQuietMs: 0,
    speakingIdleMs: 20,
    progressDelayMs: 40,
    ackGuardMs: 0,
    resumeGraceMs: 20,
    onState: (s) => calls.states.push(s),
    onAssistantTranscriptDelta: (payload, meta) => calls.assistant.push({ payload, meta }),
    onTurnCommitted: (turn, meta) => calls.committed.push({ turn, meta }),
    onClientDelegation: async (payload, meta) => {
      calls.delegations.push({ payload, meta });
      return delegate ? delegate(payload, meta) : { spokenSummary: `결과:${payload.userText}` };
    },
    onError: () => {},
    ...options,
  });
  const emit = (e) => listeners.message({ data: JSON.stringify(e) });
  const say = (delta) => emit({ type: "session.input_transcript.delta", delta });
  const speak = (delta) => emit({ type: "session.output_transcript.delta", delta });
  const delegateEvent = (id) => emit({ type: "session.delegation.created", delegation: { id, target: "client" } });
  const commentary = (pred = () => true) => sent.filter((m) => m.type === "session.commentary.append" && pred(m));
  const thinking = (pred = () => true) => sent.filter((m) => m.type === "session.thinking.append" && pred(m));
  return { live, sent, emit, say, speak, delegateEvent, calls, audio, commentary, thinking };
}

test("진행 label 정리: 특수 토큰·꺾쇠를 지우고 120자로 자른다", () => {
  assert.equal(cleanProgressLabel("<|SpawnThinking|> 영양읍 <b>트랙터</b> 검색 중"), "영양읍 b 트랙터 /b 검색 중");
  assert.equal(cleanProgressLabel("가".repeat(200)).length, 120);
  assert.equal(cleanProgressLabel(null), "");
});

test("위임 시점에는 아무것도 보내지 않아 자동 접수 인사를 살리고, 접수 인사 뒤 모델이 덧붙이는 말은 끈다", async () => {
  const gate = deferred();
  const { live, sent, say, speak, delegateEvent, calls, audio, commentary } = makeLive({
    delegate: async () => { await gate.promise; return { spokenSummary: "트랙터 2대 있어요" }; },
  });
  await live.start();
  say("트랙터 찾아줘");
  delegateEvent("d1");
  await tick();
  assert.deepEqual(sent, [], "thinking/commentary append는 대기 중 자동 acknowledgement를 취소하므로 보내지 않는다");

  // GPT-Live 자동 acknowledgement: 한 번은 그대로 들린다.
  speak("네, 트랙터 찾아볼게요.");
  assert.equal(audio.muted, false);
  assert.equal(calls.assistant.at(-1).meta.kind, "ack");
  assert.equal(calls.assistant.at(-1).meta.delegationId, "d1");
  await tick(40);

  // 실제 진행·결과 없이 덧붙이는 말: 소리를 끄고 전사·기록도 남기지 않는다.
  const before = calls.assistant.length;
  speak("잠시만 기다려 주세요.");
  assert.equal(audio.muted, true);
  assert.equal(calls.assistant.length, before);
  await tick(40);
  assert.equal(audio.muted, false, "덧말이 끝나면 소리를 다시 켠다");
  assert.equal(calls.committed.some((c) => /잠시만/.test(c.turn.text)), false);

  gate.resolve();
  await tick();
  assert.deepEqual(commentary().map((m) => m.content), ["트랙터 2대 있어요"]);
  speak("트랙터가 두 대 있어요.");
  assert.equal(audio.muted, false);
  assert.equal(calls.assistant.at(-1).meta.kind, "result");
  await live.stop();
});

test("위임 직전에 모델이 이미 답(접수 한마디)했으면 그 뒤 자동 acknowledgement는 두 번째 접수라 끈다", async () => {
  const gate = deferred();
  const { live, say, speak, delegateEvent, calls, audio } = makeLive({
    delegate: async () => { await gate.promise; return { spokenSummary: "있어요" }; },
  });
  await live.start();
  say("콤바인 있어?");
  speak("네, 콤바인 찾아볼게요.");
  delegateEvent("d1");
  await tick(40);
  assert.equal(calls.committed.find((c) => c.turn.role === "assistant").meta.kind, "ack");
  speak("확인해 볼게요.");
  assert.equal(audio.muted, true, "같은 위임의 두 번째 접수 인사");
  gate.resolve();
  await tick(40);
  await live.stop();
});

test("겹친 위임은 위임마다 접수 인사 한 번씩만 허용한다", async () => {
  const gates = { a: deferred(), b: deferred() };
  const { live, say, speak, delegateEvent, audio } = makeLive({
    delegate: async (p) => { await gates[p.delegationId].promise; return { spokenSummary: p.delegationId }; },
  });
  await live.start();
  say("트랙터 찾아줘");
  delegateEvent("a");
  say(" 그리고 내일 날씨");
  delegateEvent("b");
  await tick();
  speak("네, 찾아볼게요.");
  assert.equal(audio.muted, false);
  await tick(40);
  speak("날씨도 볼게요.");
  assert.equal(audio.muted, false, "두 번째 위임의 접수 인사");
  await tick(40);
  speak("조금만요.");
  assert.equal(audio.muted, true, "세 번째 덧말은 끈다");
  gates.a.resolve();
  gates.b.resolve();
  await tick(40);
  await live.stop();
});

test("meta.onProgress: 실제 진행은 지연 뒤 한 번만 말하고, 중복은 버리고, 이후 진행은 말하지 않는 thinking으로 보낸다", async () => {
  const gate = deferred();
  let meta;
  const { live, say, delegateEvent, commentary, thinking } = makeLive({
    delegate: async (_p, m) => { meta = m; await gate.promise; return { spokenSummary: "트랙터 2대 있어요" }; },
  });
  await live.start();
  say("트랙터 찾아줘");
  delegateEvent("d1");
  await tick();
  assert.equal(typeof meta.onProgress, "function");
  assert.equal(meta.onProgress({ label: "" }), false);
  assert.equal(meta.onProgress({ label: "영양읍 매물 12건 검색 중" }), true);
  assert.equal(meta.onProgress({ label: "영양읍 매물 12건 검색 중" }), false, "같은 label은 중복");
  assert.equal(meta.onProgress({ label: "예약 가능일 확인 중" }), true);
  assert.deepEqual(commentary(), [], "progressDelayMs 전에는 말하지 않는다");
  await tick(60);
  const progress = commentary((m) => m.event_id.startsWith("progress_"));
  assert.equal(progress.length, 1);
  assert.equal(progress[0].delegation_id, "d1");
  assert.match(progress[0].content, /예약 가능일 확인 중/, "말하기 전까지 온 것 중 가장 최근의 실제 진행");
  assert.equal(meta.onProgress({ label: "요금 계산 중" }), true);
  await tick(60);
  assert.equal(commentary((m) => m.event_id.startsWith("progress_")).length, 1, "한 번의 대기에 진행 소식은 최대 한 번");
  assert.ok(thinking((m) => /요금 계산 중/.test(m.content) && m.delegation_id === "d1").length === 1);

  gate.resolve();
  await tick();
  assert.equal(meta.onProgress({ label: "끝난 뒤 진행" }), false, "결과 뒤 진행은 버린다");
  await live.stop();
});

test("결과가 progressDelayMs 안에 오면 진행 소식을 말하지 않는다", async () => {
  const { live, say, delegateEvent, commentary } = makeLive({
    delegate: async (_p, m) => { m.onProgress({ label: "검색 중" }); await tick(10); return { spokenSummary: "있어요" }; },
  });
  await live.start();
  say("트랙터");
  delegateEvent("d1");
  await tick(80);
  assert.deepEqual(commentary().map((m) => m.content), ["있어요"]);
  await live.stop();
});

test("겹친 위임의 진행 소식은 짧은 시간 안에 하나만 말하고 나머지는 조용히 넘긴다", async () => {
  const gates = { a: deferred(), b: deferred() };
  const metas = {};
  const { live, say, delegateEvent, commentary, thinking } = makeLive({
    delegate: async (p, m) => { metas[p.delegationId] = m; await gates[p.delegationId].promise; return { spokenSummary: p.delegationId }; },
  });
  await live.start();
  say("트랙터 찾아줘");
  delegateEvent("a");
  say(" 콤바인도");
  delegateEvent("b");
  await tick();
  metas.a.onProgress({ label: "트랙터 검색 중" });
  metas.b.onProgress({ label: "콤바인 검색 중" });
  await tick(60);
  assert.equal(commentary((m) => m.event_id.startsWith("progress_")).length, 1);
  assert.equal(thinking((m) => m.event_id.startsWith("progress_")).length, 1);
  gates.a.resolve();
  gates.b.resolve();
  await tick();
  await live.stop();
});

test("정정된 작업의 진행 소식은 받지 않고, 줄 서 있던 진행 소식도 결과·정정이 오면 버린다", async () => {
  const gates = { old: deferred(), next: deferred() };
  const metas = {};
  const { live, say, delegateEvent, commentary } = makeLive({
    delegate: async (p, m) => { metas[p.delegationId] = m; await gates[p.delegationId].promise; return { spokenSummary: p.delegationId }; },
    options: { userQuietMs: 200 },
  });
  await live.start();
  say("트랙터 빌려줘");
  delegateEvent("old");
  await tick();
  metas.old.onProgress({ label: "트랙터 검색 중" });
  say("아니 콤바인으로"); // 사용자가 말하는 중이라 진행 소식은 줄을 서고, 정정으로 낡는다.
  await tick(60);
  assert.equal(metas.old.isStale(), true);
  assert.equal(metas.old.onProgress({ label: "다른 진행" }), false);
  delegateEvent("next");
  gates.old.resolve();
  await tick(250);
  assert.equal(commentary((m) => m.event_id.startsWith("progress_")).length, 0);
  gates.next.resolve();
  await tick(250);
  await live.stop();
});

test("확인 중(thinking)에 말하는 접수 인사도 사용자가 끼어들면 바로 끄고, 백엔드 작업과 확인 중 상태는 유지한다", async () => {
  const gate = deferred();
  const { live, say, speak, delegateEvent, calls, audio } = makeLive({
    delegate: async () => { await gate.promise; return { spokenSummary: "트랙터 2대 있어요" }; },
    options: { userQuietMs: 40 },
  });
  await live.start();
  say("트랙터 찾아줘");
  delegateEvent("d1");
  await tick(60);
  speak("네, 트랙터 찾아");
  assert.equal(live.state, "thinking");
  say("아 그리고");
  assert.equal(audio.muted, true);
  const cut = calls.committed.find((c) => c.turn.role === "assistant");
  assert.equal(cut.turn.interrupted, true);
  assert.equal(live.state, "thinking");
  speak("볼게요."); // 끊긴 발화의 나머지는 사용자가 말하는 동안 버린다.
  assert.equal(calls.assistant.some((a) => a.payload.delta === "볼게요."), false);
  gate.resolve();
  await tick(80);
  assert.ok(calls.delegations.length === 1);
  await live.stop();
});

test("결과 낭독이 짧은 맞장구로 끊기면 말이 끝난 뒤 남은 결과를 한 번만 이어서 말한다", async () => {
  const { live, say, speak, delegateEvent, commentary } = makeLive({ options: { userQuietMs: 30 } });
  await live.start();
  say("트랙터 찾아줘");
  delegateEvent("d1");
  await tick(50);
  assert.equal(commentary().length, 1);
  speak("트랙터가 두 대 있는데");
  say("네네");
  await tick(120);
  const resumed = commentary((m) => m.event_id.startsWith("resume_"));
  assert.equal(resumed.length, 1);
  assert.equal(resumed[0].delegation_id, "d1");
  assert.match(resumed[0].content, /결과:트랙터 찾아줘/);
  // 이어 말한 것이 또 끊겨도 다시 반복하지 않는다.
  speak("남은 건");
  say("응");
  await tick(120);
  assert.equal(commentary((m) => m.event_id.startsWith("resume_")).length, 1);
  await live.stop();
});

test("끊은 말이 새 요청이면 조회 결과는 다시 말하지 않고 thinking으로만 남기고, 쓰기 결과는 반드시 다시 알린다", async () => {
  {
    const { live, say, speak, delegateEvent, commentary, thinking } = makeLive({ options: { userQuietMs: 30 } });
    await live.start();
    say("트랙터 찾아줘");
    delegateEvent("r1");
    await tick(50);
    speak("트랙터가");
    say("내일 날씨는?");
    delegateEvent("r2");
    await tick(150);
    assert.equal(commentary((m) => m.event_id.startsWith("resume_")).length, 0);
    assert.equal(thinking((m) => m.event_id.startsWith("missed_") && m.delegation_id === "r1").length, 1);
    await live.stop();
  }
  {
    const { live, say, speak, delegateEvent, commentary } = makeLive({
      options: { userQuietMs: 30 },
      delegate: async (p) => (p.delegationId === "w1"
        ? { spokenSummary: "예약 완료했어요. 신청번호 R-1", effect: "write" }
        : { spokenSummary: "맑아요" }),
    });
    await live.start();
    say("트랙터 예약해줘");
    delegateEvent("w1");
    await tick(50);
    speak("예약 완료");
    say("내일 날씨는?");
    delegateEvent("q2");
    await tick(150);
    const resumed = commentary((m) => m.event_id.startsWith("resume_"));
    assert.equal(resumed.length, 1);
    assert.match(resumed[0].content, /R-1/);
    await live.stop();
  }
});

test("같은 위임 이벤트가 두 번 와도 백엔드는 한 번만 부르고 결과도 한 번만 말한다", async () => {
  const { live, delegateEvent, say, calls, commentary } = makeLive();
  await live.start();
  say("트랙터");
  delegateEvent("dup");
  delegateEvent("dup");
  await tick(20);
  assert.equal(calls.delegations.length, 1);
  assert.equal(commentary().length, 1);
  await live.stop();
});

test("재연결: 이전 연결에서 늦게 온 쓰기 결과는 새 세션에 delegation_id 없이 알리고, 조회 결과·이전 진행은 버린다", async () => {
  const gates = { w: deferred(), r: deferred() };
  const metas = {};
  const { live, emit, say, delegateEvent, commentary } = makeLive({
    delegate: async (p, m) => {
      metas[p.delegationId] = m;
      await gates[p.delegationId].promise;
      return p.delegationId === "w"
        ? { spokenSummary: "예약 완료, 신청번호 R-9", result: { reservation: { id: "R-9" } } }
        : { spokenSummary: "트랙터 3대 있어요", effect: "read" };
    },
  });
  await live.start();
  emit({ type: "session.started" });
  say("트랙터 예약해줘");
  delegateEvent("w");
  say(" 콤바인도 찾아줘");
  delegateEvent("r");
  await tick();
  const stopping = live.stop();
  emit({ type: "session.closed" });
  await stopping;
  await live.start();
  emit({ type: "session.started" });
  assert.equal(metas.w.onProgress({ label: "이전 연결 진행" }), false);
  gates.w.resolve();
  gates.r.resolve();
  await tick(20);
  const carried = commentary((m) => m.event_id.startsWith("carry_"));
  assert.equal(carried.length, 1);
  assert.equal(carried[0].delegation_id, null, "이전 세션의 위임 ID는 새 세션에서 쓸 수 없다");
  assert.match(carried[0].content, /R-9/);
  assert.equal(commentary((m) => /트랙터 3대/.test(m.content)).length, 0);
  assert.equal(commentary((m) => m.delegation_id === "w" || m.delegation_id === "r").length, 0);
  await live.stop();
});

test("재연결 전에 줄 서 있던 쓰기 결과는 다음 세션이 시작되면 알린다", async () => {
  const { live, emit, say, delegateEvent, commentary } = makeLive({
    options: { userQuietMs: 500 },
    delegate: async () => ({ spokenSummary: "판매글 올렸어요", result: { createdListing: { id: "L1" } } }),
  });
  await live.start();
  emit({ type: "session.started" });
  say("판매글 올려줘");
  delegateEvent("w");
  await tick(20);
  assert.equal(commentary((m) => m.delegation_id === "w").length, 0, "사용자가 아직 말하는 중이라 줄을 섰다");
  const stopping = live.stop();
  emit({ type: "session.closed" });
  await stopping;
  await live.start();
  emit({ type: "session.started" });
  await tick(20);
  const carried = commentary((m) => m.event_id.startsWith("carry_"));
  assert.equal(carried.length, 1);
  assert.match(carried[0].content, /판매글 올렸어요/);
  await live.stop();
});

test("실시간 음성: 대행운영서비스 사용·제공 여부와 작업자 정보 답은 늘 농농이(백엔드)에게 맡긴다", async () => {
  const { buildGptLiveInstructions } = await import("../server/gpt-live.js");
  const text = buildGptLiveInstructions({});
  assert.match(text, /대행운영서비스/);
  assert.match(text, /대행운영[^\n]*(?:delegate|맡긴다)/i);
});
