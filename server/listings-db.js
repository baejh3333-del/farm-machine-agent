import { SPEC_BY_ID } from "../src/data/machine-specifications.js";
import { getPool } from "./db.js";
import { buildMockListings } from "./listing-seed.js";
import { photoPublicUrl } from "./storage.js";

/**
 * Legacy synchronous seed accessor retained strictly for pure unit test fixtures.
 * Runtime API and recommendation handlers must query PostgreSQL via fetchListings().
 */
export function listListings() {
  return buildMockListings();
}

export function toListingDto(row, booked = [], viewerId = null) {
  const spec = row.model_id && Object.hasOwn(SPEC_BY_ID, row.model_id) ? SPEC_BY_ID[row.model_id] : null;
  const photoUrl = row.photo_key ? photoPublicUrl(row.photo_key) ?? null : null;
  return {
    id: row.id,
    ownerId: row.owner_id,
    ownerName: row.owner_name ?? null,
    owner: Boolean(viewerId && row.owner_id === viewerId),
    type: row.type,
    modelId: row.model_id ?? null,
    model: spec ? spec.model : null,
    specification: spec,
    title: row.title,
    brand: row.brand,
    machineType: row.machine_type,
    cropIds: Array.isArray(row.crop_ids) ? [...row.crop_ids] : [],
    operations: Array.isArray(row.operations) ? [...row.operations] : [],
    areaMin: Number(row.area_min),
    areaMax: Number(row.area_max),
    price: Number(row.price),
    rentalOperator: row.rental_operator ?? null,
    region: row.region,
    condition: row.condition,
    inspectedAt: typeof row.inspected_at === "string"
      ? row.inspected_at.slice(0, 10)
      : new Date(row.inspected_at).toISOString().slice(0, 10),
    included: row.included ?? "",
    pickup: row.pickup ?? "",
    description: row.description ?? "",
    summary: row.summary ?? "",
    photoKey: row.photo_key ?? null,
    photoUrl,
    status: row.status,
    demo: Boolean(row.is_demo),
    booked: booked.map((item) => ({ start: item.start, end: item.end })),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

async function fetchBookedRangesMap(listingIds, pool) {
  const map = new Map();
  if (!listingIds.length) return map;
  const res = await pool.query(
    `SELECT listing_id, start_date, end_date
     FROM rental_requests
     WHERE status = 'approved' AND listing_id = ANY($1::text[])
     ORDER BY start_date ASC, end_date ASC, created_at ASC`,
    [listingIds]
  );
  for (const row of res.rows) {
    const list = map.get(row.listing_id) || [];
    list.push({
      start: String(row.start_date).slice(0, 10),
      end: String(row.end_date).slice(0, 10),
    });
    map.set(row.listing_id, list);
  }
  return map;
}

export async function fetchListings({
  viewerId = null,
  includeRemoved = false,
  ownerOnly = false,
  pool = getPool(),
} = {}) {
  const conditions = [];
  const params = [];

  if (ownerOnly) {
    if (!viewerId) return [];
    params.push(viewerId);
    conditions.push(`l.owner_id = $${params.length}`);
    if (!includeRemoved) {
      conditions.push(`l.status <> 'removed'`);
    }
  } else if (includeRemoved && viewerId) {
    params.push(viewerId);
    conditions.push(`(l.status <> 'removed' OR l.owner_id = $${params.length})`);
  } else {
    conditions.push(`l.status <> 'removed'`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const listingsRes = await pool.query(
    `SELECT l.*, u.name AS owner_name
     FROM listings l
     JOIN "user" u ON u.id = l.owner_id
     ${whereClause}
     ORDER BY l.is_demo DESC, l.sort_order ASC, l.created_at DESC`,
    params
  );

  if (!listingsRes.rows.length) return [];
  const ids = listingsRes.rows.map((r) => r.id);
  const bookedMap = await fetchBookedRangesMap(ids, pool);
  return listingsRes.rows.map((row) => toListingDto(row, bookedMap.get(row.id) || [], viewerId));
}

export async function fetchListingById(id, { viewerId = null, includeRemoved = false, pool = getPool() } = {}) {
  const res = await pool.query(
    `SELECT l.*, u.name AS owner_name
     FROM listings l
     JOIN "user" u ON u.id = l.owner_id
     WHERE l.id = $1
     LIMIT 1`,
    [id]
  );
  const row = res.rows[0];
  if (!row) return null;
  if (row.status === "removed" && !(includeRemoved && viewerId && row.owner_id === viewerId)) {
    return null;
  }
  const bookedMap = await fetchBookedRangesMap([row.id], pool);
  return toListingDto(row, bookedMap.get(row.id) || [], viewerId);
}
