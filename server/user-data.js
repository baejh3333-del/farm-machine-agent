import { randomUUID } from "node:crypto";
import { SPEC_BY_ID } from "../src/data/machine-specifications.js";
import { getPool, withTransaction } from "./db.js";
import { fail, HttpError } from "./http.js";
import { isUuid, normalizeText, requireUuid } from "./validate.js";

function toOwnedDto(row) {
  const spec = SPEC_BY_ID[row.model_id] || null;
  return {
    id: String(row.id),
    modelId: row.model_id,
    name: row.name,
    isSelected: Boolean(row.is_selected),
    specification: spec,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

export async function getUserData(userId, { pool = getPool(), client = null } = {}) {
  const db = client || pool;
  const [favRes, ownedRes] = await Promise.all([
    db.query(
      `SELECT f.listing_id
       FROM favorites f
       JOIN listings l ON l.id = f.listing_id
       WHERE f.user_id = $1 AND l.status <> 'removed'
       ORDER BY f.created_at ASC`,
      [userId]
    ),
    db.query(
      `SELECT id, model_id, name, is_selected, created_at
       FROM owned_machines
       WHERE user_id = $1
       ORDER BY created_at ASC, id ASC`,
      [userId]
    ),
  ]);

  const favorites = favRes.rows.map((r) => r.listing_id);
  const ownedMachines = ownedRes.rows.map(toOwnedDto);
  const selected = ownedMachines.find((m) => m.isSelected) || null;
  return {
    favorites,
    ownedMachines,
    selectedOwnedMachineId: selected ? selected.id : null,
  };
}

export async function toggleFavorite(userId, listingId, { favorite, pool = getPool() } = {}) {
  const cleanId = normalizeText(listingId, { min: 1, max: 80, field: "매물 ID" });

  return withTransaction(async (client) => {
    const listingRes = await client.query(
      `SELECT id, status FROM listings WHERE id = $1 LIMIT 1`,
      [cleanId]
    );
    if (!listingRes.rows.length || listingRes.rows[0].status === "removed") {
      fail(404, "LISTING_NOT_FOUND", "매물을 찾을 수 없습니다.");
    }

    const existsRes = await client.query(
      `SELECT 1 FROM favorites WHERE user_id = $1 AND listing_id = $2`,
      [userId, cleanId]
    );
    const currentlyFav = existsRes.rows.length > 0;
    const nextFav = typeof favorite === "boolean" ? favorite : !currentlyFav;

    if (nextFav && !currentlyFav) {
      await client.query(
        `INSERT INTO favorites (user_id, listing_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [userId, cleanId]
      );
    } else if (!nextFav && currentlyFav) {
      await client.query(
        `DELETE FROM favorites WHERE user_id = $1 AND listing_id = $2`,
        [userId, cleanId]
      );
    }

    const userData = await getUserData(userId, { client });
    return { isFavorite: nextFav, userData };
  }, pool);
}

export async function addOwnedMachine(userId, payload, { pool = getPool() } = {}) {
  const id = requireUuid(payload?.id, "보유 농기계 ID");
  const modelId = typeof payload?.modelId === "string" ? payload.modelId.trim() : "";
  const spec = SPEC_BY_ID[modelId];
  if (!spec || spec.role !== "powerUnit") {
    fail(400, "INVALID_MODEL", "선택한 본체 모델을 찾을 수 없습니다.");
  }
  const rawName = typeof payload?.name === "string" && payload.name.trim() ? payload.name : spec.model;
  const name = normalizeText(rawName, { min: 1, max: 40, field: "기계 별명" });

  const matchesExistingOwned = (existing) =>
    existing.user_id === userId && existing.model_id === modelId && existing.name === name;

  try {
    return await withTransaction(async (client) => {
      // Lock parent user row first so 0-row concurrent inserts for the same user serialize cleanly.
      await client.query(`SELECT id FROM "user" WHERE id = $1 FOR UPDATE`, [userId]);

      const existingRes = await client.query(
        `SELECT id, user_id, model_id, name, is_selected
         FROM owned_machines
         WHERE id = $1
         FOR UPDATE`,
        [id]
      );
      if (existingRes.rows.length) {
        const existing = existingRes.rows[0];
        if (!matchesExistingOwned(existing)) {
          fail(409, "IDEMPOTENCY_CONFLICT", "이미 처리된 요청 식별자와 충돌합니다.");
        }
        const userData = await getUserData(userId, { client });
        return { idempotent: true, userData };
      }

      const userRowsRes = await client.query(
        `SELECT id, is_selected FROM owned_machines WHERE user_id = $1 FOR UPDATE`,
        [userId]
      );
      const shouldSelect = userRowsRes.rows.length === 0 || payload?.select !== false;
      if (shouldSelect) {
        await client.query(
          `UPDATE owned_machines SET is_selected = false WHERE user_id = $1 AND is_selected = true`,
          [userId]
        );
      }

      await client.query(
        `INSERT INTO owned_machines (id, user_id, model_id, name, is_selected)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, userId, modelId, name, shouldSelect]
      );

      const userData = await getUserData(userId, { client });
      return { idempotent: false, userData };
    }, pool);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error?.code === "23505") {
      const winnerRes = await pool.query(
        `SELECT id, user_id, model_id, name FROM owned_machines WHERE id = $1 LIMIT 1`,
        [id]
      );
      const winner = winnerRes.rows[0];
      if (winner && matchesExistingOwned(winner)) {
        const userData = await getUserData(userId, { pool });
        return { idempotent: true, userData };
      }
      fail(409, "IDEMPOTENCY_CONFLICT", "이미 처리된 요청 식별자와 충돌합니다.");
    }
    throw error;
  }
}

export async function selectOwnedMachine(userId, ownedId, { pool = getPool() } = {}) {
  const id = requireUuid(ownedId, "보유 농기계 ID");

  return withTransaction(async (client) => {
    await client.query(`SELECT id FROM "user" WHERE id = $1 FOR UPDATE`, [userId]);

    const targetRes = await client.query(
      `SELECT id, user_id, is_selected FROM owned_machines WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (!targetRes.rows.length) {
      fail(404, "OWNED_MACHINE_NOT_FOUND", "보유 농기계를 찾을 수 없습니다.");
    }
    if (targetRes.rows[0].user_id !== userId) {
      fail(403, "FORBIDDEN", "다른 사용자의 보유 농기계에 접근할 수 없습니다.");
    }

    if (!targetRes.rows[0].is_selected) {
      await client.query(
        `SELECT id FROM owned_machines WHERE user_id = $1 FOR UPDATE`,
        [userId]
      );
      await client.query(
        `UPDATE owned_machines SET is_selected = false WHERE user_id = $1 AND is_selected = true`,
        [userId]
      );
      await client.query(
        `UPDATE owned_machines SET is_selected = true WHERE id = $1 AND user_id = $2`,
        [id, userId]
      );
    }

    const userData = await getUserData(userId, { client });
    return { userData };
  }, pool);
}

export async function removeOwnedMachine(userId, ownedId, { pool = getPool() } = {}) {
  const id = requireUuid(ownedId, "보유 농기계 ID");

  return withTransaction(async (client) => {
    await client.query(`SELECT id FROM "user" WHERE id = $1 FOR UPDATE`, [userId]);

    const targetRes = await client.query(
      `SELECT id, user_id, is_selected FROM owned_machines WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (!targetRes.rows.length) {
      fail(404, "OWNED_MACHINE_NOT_FOUND", "보유 농기계를 찾을 수 없습니다.");
    }
    if (targetRes.rows[0].user_id !== userId) {
      fail(403, "FORBIDDEN", "다른 사용자의 보유 농기계는 삭제할 수 없습니다.");
    }

    await client.query(
      `DELETE FROM owned_machines WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );

    if (targetRes.rows[0].is_selected) {
      const nextRes = await client.query(
        `SELECT id FROM owned_machines WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
        [userId]
      );
      if (nextRes.rows.length) {
        await client.query(
          `UPDATE owned_machines SET is_selected = true WHERE id = $1`,
          [nextRes.rows[0].id]
        );
      }
    }

    const userData = await getUserData(userId, { client });
    return { userData };
  }, pool);
}

export async function importGuestData(userId, { favorites = [], ownedMachines = [] } = {}, { pool = getPool() } = {}) {
  const favInput = Array.isArray(favorites)
    ? [...new Set(favorites.filter((id) => typeof id === "string" && id.trim().length > 0 && id.length <= 80).map((id) => id.trim()))].slice(0, 100)
    : [];
  const ownedInput = Array.isArray(ownedMachines) ? ownedMachines.slice(0, 30) : [];

  return withTransaction(async (client) => {
    await client.query(`SELECT id FROM "user" WHERE id = $1 FOR UPDATE`, [userId]);

    let importedFavorites = 0;
    if (favInput.length) {
      const validRes = await client.query(
        `SELECT id FROM listings WHERE id = ANY($1::text[]) AND status <> 'removed'`,
        [favInput]
      );
      for (const row of validRes.rows) {
        const res = await client.query(
          `INSERT INTO favorites (user_id, listing_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [userId, row.id]
        );
        importedFavorites += res.rowCount ?? 0;
      }
    }

    const existingOwnedRes = await client.query(
      `SELECT id, model_id, name, is_selected FROM owned_machines WHERE user_id = $1 FOR UPDATE`,
      [userId]
    );
    let hasSelected = existingOwnedRes.rows.some((r) => r.is_selected);
    const existingIds = new Set(existingOwnedRes.rows.map((r) => String(r.id).toLowerCase()));

    let importedMachines = 0;
    for (const item of ownedInput) {
      if (!item || typeof item !== "object") continue;
      const modelId = typeof item.modelId === "string" ? item.modelId.trim() : "";
      const spec = SPEC_BY_ID[modelId];
      if (!spec || spec.role !== "powerUnit") continue;
      const rawName = typeof item.name === "string" && item.name.trim() ? item.name.trim().slice(0, 40) : spec.model;
      if (!rawName) continue;

      let candidateId = isUuid(item.id) ? item.id.trim().toLowerCase() : randomUUID();
      if (existingIds.has(candidateId)) continue;

      const globalConflict = await client.query(
        `SELECT 1 FROM owned_machines WHERE id = $1`,
        [candidateId]
      );
      if (globalConflict.rows.length) {
        // Guest UUID was already imported into a different browser session's account
        candidateId = randomUUID();
      }

      const selectNow = !hasSelected;
      await client.query(
        `INSERT INTO owned_machines (id, user_id, model_id, name, is_selected)
         VALUES ($1, $2, $3, $4, $5)`,
        [candidateId, userId, modelId, rawName, selectNow]
      );
      existingIds.add(candidateId);
      if (selectNow) hasSelected = true;
      importedMachines += 1;
    }

    const userData = await getUserData(userId, { client });
    return { importedFavorites, importedMachines, userData };
  }, pool);
}
