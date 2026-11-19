// 실시간 음성 위임(dispatch) 처리에 쓰는 순수 도우미. 패널(panel.js)이 DOM·상태를 맡고,
// 여기서는 카드/음성 요약 중복 제거, 늦게 온 결과 처리 방식, 내용 없는 지연 시간 측정만 다룬다.
import { tidySpokenText } from "./spoken-text.js";

const MACHINE_LIST_HEADING_RE = /^(?:#{1,6}\s*|\*\*[^*\n]*)(?:추천\s*매물|매물\s*목록|추천\s*농기계|추천\s*기계|검색\s*결과|추천\s*리스트)/;
const LIST_ITEM_RE = /^\s*(?:[-*•]|\d+[.)])\s+/;

/** 답변 글에 카드와 같은 매물 목록이 붙어 있으면 앞의 소개 문장만 남긴다. */
export function stripDuplicateMachineList(text, listingCount = 0) {
  const raw = String(text || "").replace(/\r\n?/g, "\n").trim();
  if (!raw || !listingCount) return raw;
  const lines = raw.split("\n");
  let cutIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    if (LIST_ITEM_RE.test(line)) {
      cutIndex = i;
      break;
    }
    if (MACHINE_LIST_HEADING_RE.test(line)) {
      const restHasList = lines.slice(i + 1).some((next) => LIST_ITEM_RE.test(next.trim()));
      if (restHasList) {
        cutIndex = i;
        break;
      }
    }
  }
  if (cutIndex === -1) return raw;
  const intro = lines.slice(0, cutIndex).join("\n").trim();
  return intro || `조건에 맞는 매물 ${listingCount}건을 찾았어요. 아래 카드에서 비교해 보세요.`;
}

/** 서버가 준 매물 ID를 순서를 지킨 채 중복 없이 정리한다(“1번”, “2번”이 서버와 같은 매물을 가리키게). */
export function uniqueListingIds(ids, limit = Infinity) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(ids) ? ids : []) {
    if (typeof raw !== "string") continue;
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= limit) break;
  }
  return out;
}

/** 서버에서 실제로 무언가를 바꾼(되돌릴 수 없는) 결과인가. 이런 결과는 늦게 와도 버리지 않는다. */
export function isWriteOutcome(result) {
  if (!result || typeof result !== "object") return false;
  return Boolean(
    result.reservation
    || result.createdListing
    || result.updatedListing
    || result.executedAction
    || result.outcome === "completed"
    || result.outcome === "partial"
    || (result.favoriteAction && result.favoriteAction.synced !== false),
  );
}

/** 서버가 확정한 쓰기 결과를 한 문장으로 요약한다(내용 없는 상태 안내용). */
export function describeWriteOutcome(result) {
  if (!isWriteOutcome(result)) return "";
  if (result.reservation) {
    const number = result.reservation.number ? ` 신청 번호는 ${result.reservation.number}예요.` : "";
    return `${result.reservation.kind === "purchase" ? "구매 신청" : "대여 예약 요청"}이 접수됐어요.${number}`;
  }
  if (result.createdListing) return "매물 등록을 마쳤어요.";
  if (result.updatedListing) return "매물 정보를 고쳤어요.";
  if (result.favoriteAction) return result.favoriteAction.favorite ? "찜 목록에 저장했어요." : "찜 목록에서 뺐어요.";
  return "요청하신 작업을 처리했어요.";
}

const SENTENCE_SPLIT = /(?<=[.?!。？！])\s+/;

function stripMarkdown(text) {
  return String(text || "")
    .replace(/\[([^\]\n]+)\]\((?:https?:\/\/|\/)[^)\s]+\)/g, "$1")
    .replace(/\*\*|__|`/g, "")
    .replace(/^\s*#{1,6}\s*/gm, "")
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, "")
    .replace(/\n+/g, " ");
}

/**
 * 음성으로 읽을 요약. 카드가 보여 주는 매물 목록은 읽지 않고(카드와 중복), 같은 문장은 한 번만 읽는다.
 * 쓰기 결과가 확정됐는데 답변이 그 사실을 말하지 않으면 확정 사실을 앞에 붙인다.
 */
export function buildSpokenSummary(reply, { listingCount = 0, result = null, maxLength = 600 } = {}) {
  const base = stripMarkdown(stripDuplicateMachineList(reply, listingCount));
  const seen = new Set();
  const sentences = [];
  for (const part of tidySpokenText(base).split(SENTENCE_SPLIT)) {
    const sentence = part.trim();
    if (!sentence) continue;
    const key = sentence.replace(/[\s.,?!。？！~]/g, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    sentences.push(sentence);
  }
  let spoken = sentences.join(" ");
  const outcome = describeWriteOutcome(result);
  if (outcome && !/(완료|접수|등록|신청 번호|시작했|저장했|뺐어|고쳤)/.test(spoken)) {
    spoken = `${outcome} ${spoken}`.trim();
  }
  if (spoken.length > maxLength) {
    const cut = spoken.slice(0, maxLength);
    const lastEnd = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
    spoken = lastEnd > maxLength / 2 ? cut.slice(0, lastEnd + 1) : cut;
  }
  return spoken;
}

/**
 * 위임 결과가 도착했을 때 어떻게 보여 줄지 정한다.
 * - fresh: 화면에 그리고 읽는다.
 * - superseded: 이미 더 새 위임이 시작됐다. 읽기 결과는 버리고, 쓰기 결과만 그린다(말로는 짧게).
 * - liveEnded: 음성 대화는 끝났지만 같은 패널 대화다. 쓰기 결과만 그리고 읽지 않는다.
 * - sessionReset: 패널 대화가 초기화됐다. 쓰기 결과는 알림으로만 알린다.
 */
export function classifyDispatchResult({ sameSession, sameLive, superseded, write }) {
  if (!sameSession) return write ? "notify" : "drop";
  if (!sameLive) return write ? "render" : "drop";
  if (superseded) return write ? "render_and_speak" : "drop";
  return "render_and_speak";
}

/**
 * 위임 한 건의 지연 시간 기록. 사용자 말·답변 내용은 담지 않고 시각 차이(ms)와 개수만 남긴다.
 * now()는 단조 증가 시계(performance.now)를 쓴다.
 */
export function createDispatchTimer(now = () => (globalThis.performance?.now?.() ?? Date.now())) {
  const t0 = now();
  const marks = { dispatch: 0 };
  return {
    mark(name) {
      if (typeof name === "string" && !(name in marks)) marks[name] = Math.max(0, Math.round(now() - t0));
      return marks[name];
    },
    has(name) {
      return name in marks;
    },
    snapshot(extra = {}) {
      const out = { marks: { ...marks } };
      for (const [key, value] of Object.entries(extra)) {
        if (typeof value === "number" && Number.isFinite(value)) out[key] = Math.round(value);
        else if (typeof value === "boolean" || (typeof value === "string" && value.length <= 40)) out[key] = value;
      }
      return out;
    },
  };
}

/** 서버 응답의 timing 필드에서 숫자만 꺼낸다(내용이 섞여 들어오지 않게). */
export function pickServerTiming(timing) {
  if (!timing || typeof timing !== "object") return null;
  const out = {};
  for (const key of ["firstModelMs", "firstModelDoneMs", "usefulResultMs", "totalMs", "modelCalls", "catalogMs"]) {
    const value = Number(timing[key]);
    if (Number.isFinite(value) && value >= 0) out[key] = Math.round(value);
  }
  return Object.keys(out).length ? out : null;
}
