import { randomUUID } from "node:crypto";
import { CROP_BY_ID } from "../src/data/farm-machines.js";
import { getPool, withTransaction } from "./db.js";
import { isUuid } from "./validate.js";

const VALID_INTENTS = new Set(["rent", "buy", "sell"]);
const VALID_STAGES = new Set(["collecting", "confirming", "submitted", "closed"]);
const MAX_BODY_CHARS = 4000;

function sanitizeIntent(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "sale") return "buy";
  return VALID_INTENTS.has(trimmed) ? trimmed : null;
}

function sanitizeStage(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return VALID_STAGES.has(trimmed) ? trimmed : null;
}

function sanitizePlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function sanitizeSlotsPatch(patch) {
  const obj = sanitizePlainObject(patch);
  const cleaned = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== null && value !== undefined) {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

function sanitizeFarmProfilePatch(patch = {}) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return { region: null, cropIds: null, areaPyeong: null, notes: null };
  }
  const region = typeof patch.region === "string" && patch.region.trim()
    ? patch.region.trim().slice(0, 40)
    : null;
  const rawCrops = Array.isArray(patch.cropIds)
    ? patch.cropIds
    : (typeof patch.cropId === "string" && patch.cropId.trim() ? [patch.cropId.trim()] : null);
  const cropIds = rawCrops
    ? [...new Set(rawCrops.filter((id) => typeof id === "string" && Object.hasOwn(CROP_BY_ID, id)))].slice(0, 12)
    : null;
  const hasAreaValue = patch.areaPyeong !== null
    && patch.areaPyeong !== undefined
    && patch.areaPyeong !== ""
    && typeof patch.areaPyeong !== "boolean";
  const parsedArea = hasAreaValue ? Number(patch.areaPyeong) : NaN;
  const areaPyeong = Number.isFinite(parsedArea) && Math.trunc(parsedArea) > 0 && Math.trunc(parsedArea) <= 1_000_000
    ? Math.trunc(parsedArea)
    : null;
  const notes = typeof patch.notes === "string" && patch.notes.trim()
    ? patch.notes.trim().slice(0, 500)
    : null;
  return {
    region,
    cropIds: cropIds && cropIds.length > 0 ? cropIds : null,
    areaPyeong,
    notes,
  };
}

function toFarmProfileDto(row) {
  if (!row) return null;
  return {
    region: row.region || "",
    cropIds: Array.isArray(row.crop_ids) ? [...row.crop_ids] : [],
    areaPyeong: row.area_pyeong != null ? Number(row.area_pyeong) : null,
    notes: row.notes || "",
  };
}

function toSessionDto(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    userId: row.user_id,
    intent: row.intent ?? null,
    stage: row.stage || "collecting",
    slots: sanitizePlainObject(row.slots),
    lastSeq: Number(row.last_seq ?? 0),
  };
}

/**
 * 사용자의 영구 농가 프로필(farm_profiles)을 조회한다.
 * DB 미연결·오류 시 경고를 남기고 null을 반환한다(fail-open).
 */
export async function loadFarmProfile(userId, { pool } = {}) {
  if (!userId || typeof userId !== "string") return null;
  try {
    const activePool = pool || getPool();
    const res = await activePool.query(
      `SELECT user_id, region, crop_ids, area_pyeong, notes, updated_at
       FROM farm_profiles
       WHERE user_id = $1
       LIMIT 1`,
      [userId]
    );
    return toFarmProfileDto(res.rows[0]);
  } catch (error) {
    console.warn("loadFarmProfile failed", error?.message || error);
    return null;
  }
}

/**
 * 사용자의 농가 프로필(farm_profiles)에 유효한 필드를 기존 값과 병합해 저장한다.
 */
export async function upsertFarmProfile(userId, patch = {}, { pool } = {}) {
  if (!userId || typeof userId !== "string" || !patch || typeof patch !== "object" || Array.isArray(patch)) {
    return null;
  }
  const clean = sanitizeFarmProfilePatch(patch);
  if (!clean.region && !clean.cropIds && !clean.areaPyeong && !clean.notes) {
    return await loadFarmProfile(userId, { pool });
  }
  try {
    const activePool = pool || getPool();
    const res = await activePool.query(
      `INSERT INTO farm_profiles (user_id, region, crop_ids, area_pyeong, notes, updated_at)
       VALUES ($1, COALESCE($2, ''), COALESCE($3::text[], '{}'), $4, COALESCE($5, ''), now())
       ON CONFLICT (user_id) DO UPDATE SET
         region = COALESCE(NULLIF($2, ''), farm_profiles.region),
         crop_ids = CASE
           WHEN $3::text[] IS NOT NULL AND cardinality($3::text[]) > 0 THEN $3::text[]
           ELSE farm_profiles.crop_ids
         END,
         area_pyeong = COALESCE($4, farm_profiles.area_pyeong),
         notes = COALESCE(NULLIF($5, ''), farm_profiles.notes),
         updated_at = now()
       RETURNING user_id, region, crop_ids, area_pyeong, notes`,
      [userId, clean.region, clean.cropIds, clean.areaPyeong, clean.notes]
    );
    return toFarmProfileDto(res.rows[0]);
  } catch (error) {
    console.warn("upsertFarmProfile failed", error?.message || error);
    return null;
  }
}

/**
 * 사용자의 에이전트 세션(agent_sessions)을 조회하거나 새로 생성한다.
 */
export async function getOrCreateAgentSession(
  userId,
  sessionId = null,
  { intent = null, stage = "collecting", slots = {}, pool } = {}
) {
  if (!userId || typeof userId !== "string") return null;
  try {
    const activePool = pool || getPool();
    const targetId = isUuid(sessionId) ? sessionId.trim().toLowerCase() : randomUUID();
    const cleanIntent = sanitizeIntent(intent);
    const cleanStage = sanitizeStage(stage) || "collecting";
    const cleanSlots = sanitizeSlotsPatch(slots);
    const slotsJson = JSON.stringify(cleanSlots);

    const upsertSql = `
      INSERT INTO agent_sessions (id, user_id, intent, stage, slots, last_seq)
      VALUES ($1, $2, $3, $4, $5::jsonb, 0)
      ON CONFLICT (id) DO UPDATE SET updated_at = now()
      WHERE agent_sessions.user_id = EXCLUDED.user_id
      RETURNING id, user_id, intent, stage, slots, last_seq
    `;

    let res = await activePool.query(upsertSql, [targetId, userId, cleanIntent, cleanStage, slotsJson]);
    if (!res.rows.length) {
      // 다른 사용자의 세션 ID와 충돌하면 새 세션 ID를 발급한다.
      res = await activePool.query(upsertSql, [randomUUID(), userId, cleanIntent, cleanStage, slotsJson]);
    }
    return toSessionDto(res.rows[0]);
  } catch (error) {
    console.warn("getOrCreateAgentSession failed", error?.message || error);
    return null;
  }
}

/**
 * 한 턴의 사용자/어시스턴트 메시지, 학습된 슬롯, 도구 실행 이력을 트랜잭션으로 저장한다.
 */
export async function recordAgentTurn({
  sessionId = null,
  userId,
  userMessage = "",
  assistantReply = "",
  slotsPatch = {},
  intent = null,
  stage = null,
  toolCalls = [],
  model = null,
  pool,
} = {}) {
  if (!userId || typeof userId !== "string" || !sessionId || !isUuid(sessionId)) return null;
  const cleanIntent = sanitizeIntent(intent);
  const cleanStage = sanitizeStage(stage);
  const cleanSlots = sanitizeSlotsPatch(slotsPatch);
  const cleanUserMsg = typeof userMessage === "string" ? userMessage.trim().slice(0, MAX_BODY_CHARS) : "";
  const cleanAssistantReply = typeof assistantReply === "string" ? assistantReply.trim().slice(0, MAX_BODY_CHARS) : "";
  const calls = Array.isArray(toolCalls) ? toolCalls : [];

  try {
    const activePool = pool || getPool();
    const ensuredSession = await getOrCreateAgentSession(userId, sessionId, {
      intent: cleanIntent,
      stage: cleanStage || "collecting",
      slots: cleanSlots,
      pool: activePool,
    });
    if (!ensuredSession) return null;
    const cleanSessionId = ensuredSession.id;

    const txResult = await withTransaction(async (client) => {
      const sessionRes = await client.query(
        `SELECT id, user_id, intent, stage, slots, last_seq
         FROM agent_sessions
         WHERE id = $1
         FOR UPDATE`,
        [cleanSessionId]
      );
      const session = sessionRes.rows[0];
      if (!session || session.user_id !== userId) return null;

      let seq = Number(session.last_seq ?? 0);
      let userMessageId = null;
      let assistantMessageId = null;

      if (cleanUserMsg) {
        seq += 1;
        userMessageId = randomUUID();
        await client.query(
          `INSERT INTO agent_messages (id, session_id, seq, role, body, meta)
           VALUES ($1, $2, $3, 'user', $4, '{}'::jsonb)`,
          [userMessageId, cleanSessionId, seq, cleanUserMsg]
        );
      }

      if (cleanAssistantReply) {
        seq += 1;
        assistantMessageId = randomUUID();
        await client.query(
          `INSERT INTO agent_messages (id, session_id, seq, role, body, meta)
           VALUES ($1, $2, $3, 'assistant', $4, '{}'::jsonb)`,
          [assistantMessageId, cleanSessionId, seq, cleanAssistantReply]
        );
      }

      const updatedRes = await client.query(
        `UPDATE agent_sessions
         SET slots = COALESCE(slots, '{}'::jsonb) || $2::jsonb,
             last_seq = $3,
             intent = COALESCE($4, intent),
             stage = COALESCE($5, stage),
             updated_at = now()
         WHERE id = $1
         RETURNING id, user_id, intent, stage, slots, last_seq`,
        [cleanSessionId, JSON.stringify(cleanSlots), seq, cleanIntent, cleanStage]
      );

      let recordedCalls = 0;
      for (const tc of calls) {
        if (!tc || typeof tc !== "object") continue;
        const toolName = String(tc.tool || tc.name || "").trim().slice(0, 80);
        if (!toolName) continue;
        const argsJson = JSON.stringify(sanitizePlainObject(tc.args ?? tc.input));
        const rawResult = tc.result ?? tc.output;
        const resultObj = rawResult && typeof rawResult === "object" && !Array.isArray(rawResult)
          ? rawResult
          : (rawResult !== undefined ? { value: rawResult } : {});
        const ok = tc.ok !== undefined ? Boolean(tc.ok) : !(resultObj.error || resultObj.ok === false);
        const errorCode = typeof tc.errorCode === "string" && tc.errorCode.trim()
          ? tc.errorCode.trim().slice(0, 80)
          : (typeof resultObj.code === "string" ? resultObj.code.slice(0, 80) : null);
        const latencyMs = tc.latencyMs !== null && tc.latencyMs !== undefined && Number.isFinite(Number(tc.latencyMs))
          ? Math.max(0, Math.trunc(Number(tc.latencyMs)))
          : null;
        const tcModel = typeof tc.model === "string" && tc.model.trim()
          ? tc.model.trim().slice(0, 80)
          : (typeof model === "string" && model.trim() ? model.trim().slice(0, 80) : null);
        const inputTokens = Number.isSafeInteger(tc.inputTokens) ? tc.inputTokens : null;
        const outputTokens = Number.isSafeInteger(tc.outputTokens) ? tc.outputTokens : null;

        await client.query(
          `INSERT INTO agent_tool_calls (
             id, session_id, message_id, tool, args, result, ok, error_code, latency_ms, model, input_tokens, output_tokens
           )
           VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11, $12)`,
          [
            randomUUID(),
            cleanSessionId,
            assistantMessageId,
            toolName,
            argsJson,
            JSON.stringify(resultObj),
            ok,
            errorCode,
            latencyMs,
            tcModel,
            inputTokens,
            outputTokens,
          ]
        );
        recordedCalls += 1;
      }

      return {
        session: toSessionDto(updatedRes.rows[0]),
        userMessageId,
        assistantMessageId,
        toolCallCount: recordedCalls,
      };
    }, activePool);

    if (!txResult) return null;

    const profilePatch = {};
    if (typeof cleanSlots.region === "string" && cleanSlots.region.trim()) {
      profilePatch.region = cleanSlots.region;
    }
    if (Array.isArray(cleanSlots.cropIds) && cleanSlots.cropIds.length > 0) {
      profilePatch.cropIds = cleanSlots.cropIds;
    } else if (typeof cleanSlots.cropId === "string" && cleanSlots.cropId.trim()) {
      profilePatch.cropIds = [cleanSlots.cropId.trim()];
    }
    if (cleanSlots.areaPyeong !== undefined) {
      profilePatch.areaPyeong = cleanSlots.areaPyeong;
    }
    if (typeof cleanSlots.notes === "string" && cleanSlots.notes.trim()) {
      profilePatch.notes = cleanSlots.notes;
    }
    if (Object.keys(profilePatch).length > 0) {
      await upsertFarmProfile(userId, profilePatch, { pool: activePool });
    }

    return {
      sessionId: txResult.session.id,
      slots: txResult.session.slots,
      lastSeq: txResult.session.lastSeq,
      session: txResult.session,
      userMessageId: txResult.userMessageId,
      assistantMessageId: txResult.assistantMessageId,
      toolCallCount: txResult.toolCallCount,
    };
  } catch (error) {
    console.warn("recordAgentTurn failed", error?.message || error);
    return null;
  }
}
