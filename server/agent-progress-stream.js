// /api/agent 채팅 요청의 진행 알림 스트림(NDJSON).
// - 클라이언트가 stream: true를 보낸 요청에서, 실제 내부 조회가 처음 실행될 때에만 200 + NDJSON으로 바꾼다.
//   그 전에 끝나는 응답(검증 실패·호출 제한·보험 흐름·승인 실행·조회 없는 답변)은 평소처럼 JSON 한 번으로 간다.
// - 줄 형식: {"type":"progress","label"} … 마지막에 {"type":"result","status","body"} 또는 {"type":"error","status","code","error"}.
// - 진행 문구는 서버가 만든 짧은 한국어 문장만 보낸다(도구 이름·인자·모델 출력은 보내지 않는다).

export const PROGRESS_CONTENT_TYPE = "application/x-ndjson; charset=utf-8";
const MAX_LABEL = 60;

export function cleanProgressLabel(label) {
  if (typeof label !== "string") return "";
  const text = label.replace(/\s+/g, " ").trim();
  if (!text || text.length > MAX_LABEL || !/[가-힣]/.test(text) || /[{}[\]<>_=`\\\u0000-\u001f\u007f]/.test(text)) return "";
  return text;
}

export function createProgressStream(response, { enabled = true } = {}) {
  let started = false;
  let ended = false;
  const writeLine = (obj) => {
    if (ended || response.writableEnded) return;
    response.write(`${JSON.stringify(obj)}\n`);
  };
  const start = () => {
    if (started) return;
    started = true;
    response.writeHead(200, {
      "Content-Type": PROGRESS_CONTENT_TYPE,
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    });
    response.flushHeaders?.();
  };
  return {
    get started() { return started; },
    progress(event) {
      if (!enabled || ended) return;
      const label = cleanProgressLabel(event?.label);
      if (!label) return;
      start();
      writeLine({ type: "progress", label });
    },
    /** 스트림을 시작했으면 결과를 마지막 줄로 보내고 true. 아니면 false(평소 JSON 응답으로 보낸다). */
    finish(status, body) {
      if (!started || ended) return false;
      writeLine({ type: "result", status, body });
      ended = true;
      response.end();
      return true;
    },
    /** 스트림을 시작한 뒤 생긴 오류를 마지막 줄로 보낸다. 시작 전이면 false(평소 오류 응답). */
    fail({ status, code, error }) {
      if (!started || ended) return false;
      writeLine({ type: "error", status, code, error });
      ended = true;
      response.end();
      return true;
    },
  };
}
