import { SPEC_BY_ID } from "../src/data/machine-specifications.js";
import { getPool } from "./db.js";
import { fail } from "./http.js";
import { ensureSchema } from "./schema.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MACHINES = 20;
const MAX_FAVORITES = 200;

export async function getUserData(user) {
  await ensureSchema();
  const pool = getPool();
  const [{ rows: favorites }, { rows: machines }] = await Promise.all([
    pool.query("SELECT listing_id FROM favorite WHERE user_id = $1 ORDER BY created_at", [user.id]),
    pool.query("SELECT id, model_id, name FROM owned_machine WHERE user_id = $1 ORDER BY created_at, id", [user.id]),
  ]);
  return {
    favorites: favorites.map((row) => row.listing_id),
    ownedMachines: machines.map((row) => ({ id: row.id, modelId: row.model_id, name: row.name })),
  };
}

function listingIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id) => typeof id === "string" && id.length <= 80))].slice(0, MAX_FAVORITES);
}

// 보유 농기계는 동력 본체(트랙터·관리기) 모델만 받는다. 화면(garage.js)과 같은 규칙이다.
function machines(value) {
  if (!Array.isArray(value)) fail(400, "INVALID_MACHINES", "보유 농기계 목록이 올바르지 않습니다.");
  if (value.length > MAX_MACHINES) fail(400, "TOO_MANY_MACHINES", `보유 농기계는 ${MAX_MACHINES}대까지 등록할 수 있어요.`);
  const seen = new Set();
  return value.map((item) => {
    const model = SPEC_BY_ID[item?.modelId];
    if (!item || typeof item.id !== "string" || !UUID.test(item.id) || seen.has(item.id) || model?.role !== "powerUnit") {
      fail(400, "INVALID_MACHINES", "보유 농기계 목록이 올바르지 않습니다.");
    }
    seen.add(item.id);
    const name = (typeof item.name === "string" ? item.name.trim() : "").slice(0, 40) || model.model;
    return { id: item.id, model_id: model.id, name };
  });
}

export async function setFavorite(user, input) {
  await ensureSchema();
  const [listingId] = listingIds([input.listingId]);
  if (!listingId) fail(400, "INVALID_LISTING", "매물을 선택해 주세요.");
  const pool = getPool();
  if (input.on) {
    await pool.query(`
      INSERT INTO favorite (user_id, listing_id) SELECT $1, id FROM listing WHERE id = $2
      ON CONFLICT DO NOTHING`, [user.id, listingId]);
  } else {
    await pool.query("DELETE FROM favorite WHERE user_id = $1 AND listing_id = $2", [user.id, listingId]);
  }
  return getUserData(user);
}

// 화면은 보유 목록 전체를 보낸다. 목록에 없는 기계는 지우고, 있는 기계는 넣거나 이름을 바꾼다.
export async function saveOwnedMachines(user, input) {
  await ensureSchema();
  const rows = machines(input.ownedMachines);
  await getPool().query(`
    WITH incoming AS (
      SELECT * FROM json_to_recordset($2::json) AS x(id uuid, model_id text, name text)
    ), removed AS (
      DELETE FROM owned_machine WHERE user_id = $1 AND id NOT IN (SELECT id FROM incoming)
    )
    INSERT INTO owned_machine (id, user_id, model_id, name)
    SELECT id, $1, model_id, name FROM incoming
    ON CONFLICT (id) DO UPDATE SET model_id = EXCLUDED.model_id, name = EXCLUDED.name
      WHERE owned_machine.user_id = $1
  `, [user.id, JSON.stringify(rows)]);
  return getUserData(user);
}

// 로그인하기 전에 브라우저에 모아 둔 찜과 보유 농기계를 계정에 합친다. 이미 있는 항목은 그대로 둔다.
export async function mergeGuestData(user, input) {
  await ensureSchema();
  const favorites = listingIds(input.favorites);
  const incoming = Array.isArray(input.ownedMachines) ? machines(input.ownedMachines.slice(0, MAX_MACHINES)) : [];
  const pool = getPool();
  if (favorites.length) {
    await pool.query(`
      INSERT INTO favorite (user_id, listing_id) SELECT $1, id FROM listing WHERE id = ANY($2::text[])
      ON CONFLICT DO NOTHING`, [user.id, favorites]);
  }
  if (incoming.length) {
    await pool.query(`
      INSERT INTO owned_machine (id, user_id, model_id, name)
      SELECT x.id, $1, x.model_id, x.name FROM json_to_recordset($2::json) AS x(id uuid, model_id text, name text)
      WHERE (SELECT count(*) FROM owned_machine WHERE user_id = $1) < ${MAX_MACHINES}
      ON CONFLICT (id) DO NOTHING`, [user.id, JSON.stringify(incoming)]);
  }
  return getUserData(user);
}
