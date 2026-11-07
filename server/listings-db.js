import { SPEC_BY_ID } from "../src/data/machine-specifications.js";
import { getPool } from "./db.js";
import { DEMO_OWNER_ID, ensureSchema } from "./schema.js";

const LISTING_COLUMNS = `
  l.id, l.owner_id, l.type, l.title, l.brand, l.machine_type, l.model_id, l.crop_ids, l.operations,
  l.area_min, l.area_max, l.price, l.region, l.condition, l.inspected_at::text AS inspected_at,
  l.included, l.pickup, l.description, l.summary, l.photo_url, l.status, l.is_demo,
  COALESCE((
    SELECT json_agg(json_build_object('start', lower(b.period)::text, 'end', (upper(b.period) - 1)::text)
      ORDER BY lower(b.period))
    FROM booking b WHERE b.listing_id = l.id
  ), '[]'::json) AS booked`;

// 브라우저가 쓰던 매물 형태를 그대로 돌려준다. owner는 "지금 로그인한 사용자의 매물인지"다.
export function toListing(row, viewerId) {
  const specification = row.model_id ? SPEC_BY_ID[row.model_id] : undefined;
  return {
    id: row.id, type: row.type, title: row.title, brand: row.brand, machineType: row.machine_type,
    cropIds: row.crop_ids, operations: row.operations, areaMin: row.area_min, areaMax: row.area_max,
    price: row.price, region: row.region, condition: row.condition, inspectedAt: row.inspected_at,
    included: row.included, pickup: row.pickup, description: row.description, summary: row.summary,
    ...(row.photo_url ? { photo: row.photo_url } : {}),
    booked: typeof row.booked === "string" ? JSON.parse(row.booked) : row.booked,
    status: row.status,
    owner: Boolean(viewerId) && row.owner_id === viewerId,
    // 데모 농가 소유 매물은 승인할 사람이 없다. 화면에서 안내하는 데 쓴다.
    demoOwner: row.owner_id === DEMO_OWNER_ID,
    demo: row.is_demo,
    ...(specification ? { modelId: specification.id, model: specification.model, specification } : {}),
  };
}

export async function listListings({ viewerId = null, ownerOnly = false } = {}) {
  await ensureSchema();
  const { rows } = await getPool().query(`
    SELECT ${LISTING_COLUMNS}
    FROM listing l
    WHERE l.status <> 'hidden' AND ($2::boolean IS NOT TRUE OR l.owner_id = $1)
    ORDER BY l.sort_order, l.created_at, l.id
  `, [viewerId, ownerOnly]);
  return rows.map((row) => toListing(row, viewerId));
}

export async function getListing(id, viewerId = null) {
  await ensureSchema();
  const { rows } = await getPool().query(`SELECT ${LISTING_COLUMNS} FROM listing l WHERE l.id = $1`, [id]);
  return rows[0] ? toListing(rows[0], viewerId) : null;
}
