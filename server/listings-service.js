import { cleanDeliveryMethods, inferDeliveryMethods } from "../src/data/delivery.js";
import { CROP_BY_ID, MACHINE_BY_ID, OPERATION_BY_ID } from "../src/data/farm-machines.js";
import { SPEC_BY_ID } from "../src/data/machine-specifications.js";
import { getPool, kstToday, withTransaction } from "./db.js";
import { fail, HttpError } from "./http.js";
import { validateAndReencodeImage } from "./images.js";
import { fetchListingById } from "./listings-db.js";
import { deletePhotoObject, getPhotoObject, isValidPhotoKey, newListingPhotoKey, putPhotoObject } from "./storage.js";
import { formatIsoDate, normalizeText, requireUuid } from "./validate.js";

const LISTING_TYPES = new Set(["rent", "sale"]);
const CONDITIONS = new Set(["good", "used", "repair"]);
const EDITABLE_STATUSES = new Set(["open", "dealing", "done"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeStringArray(values, allowedMap, label) {
  if (!Array.isArray(values)) {
    fail(400, "INVALID_INPUT", `${label}을(를) 선택해 주세요.`);
  }
  const unique = [];
  const seen = new Set();
  for (const raw of values) {
    if (typeof raw !== "string") continue;
    const item = raw.trim();
    if (!item || !Object.hasOwn(allowedMap, item) || seen.has(item)) continue;
    seen.add(item);
    unique.push(item);
  }
  if (!unique.length) {
    fail(400, "INVALID_INPUT", `${label}을(를) 1개 이상 선택해 주세요.`);
  }
  return unique;
}

function normalizePositiveInt(value, { min = 0, max = 1_000_000_000, field }) {
  const num = Number(value);
  if (!Number.isSafeInteger(num) || num < min || num > max) {
    fail(400, "INVALID_INPUT", `${field} 값이 올바르지 않습니다.`);
  }
  return num;
}

export function normalizeListingFields(payload, fallback = {}) {
  const type = typeof payload.type === "string" ? payload.type.trim() : fallback.type;
  if (!LISTING_TYPES.has(type)) {
    fail(400, "INVALID_TYPE", "거래 방식은 대여 또는 구매여야 합니다.");
  }

  let modelId = null;
  let spec = null;
  if (payload.modelId !== undefined && payload.modelId !== null && String(payload.modelId).trim() !== "") {
    modelId = String(payload.modelId).trim();
    spec = Object.hasOwn(SPEC_BY_ID, modelId) ? SPEC_BY_ID[modelId] : null;
    if (!spec) {
      fail(400, "INVALID_MODEL", "등록할 수 없는 기종입니다.");
    }
  } else if (payload.modelId === undefined && fallback.model_id) {
    modelId = fallback.model_id;
    spec = Object.hasOwn(SPEC_BY_ID, modelId) ? SPEC_BY_ID[modelId] : null;
  }

  const brandInput = spec ? spec.brand : (payload.brand ?? fallback.brand);
  const machineTypeInput = spec ? spec.machineType : (payload.machineType ?? fallback.machine_type);

  const title = normalizeText(payload.title ?? fallback.title, { min: 1, max: 80, field: "매물 제목" });
  const brand = normalizeText(brandInput, { min: 1, max: 40, field: "제조사" });
  const machineType = typeof machineTypeInput === "string" ? machineTypeInput.trim() : "";
  if (!Object.hasOwn(MACHINE_BY_ID, machineType)) {
    fail(400, "INVALID_MACHINE_TYPE", "기종 분류를 선택해 주세요.");
  }

  const cropIds = normalizeStringArray(payload.cropIds ?? fallback.crop_ids, CROP_BY_ID, "대상 작물");
  const operations = normalizeStringArray(payload.operations ?? fallback.operations, OPERATION_BY_ID, "작업 종류");

  const areaMin = normalizePositiveInt(payload.areaMin ?? fallback.area_min ?? 100, { min: 1, max: 1_000_000, field: "최소 면적" });
  const areaMax = normalizePositiveInt(payload.areaMax ?? fallback.area_max ?? areaMin, { min: areaMin, max: 1_000_000, field: "최대 면적" });
  const price = normalizePositiveInt(payload.price ?? fallback.price, { min: 0, max: 500_000_000, field: "가격" });
  const region = normalizeText(payload.region ?? fallback.region, { min: 1, max: 40, field: "지역" });

  const condition = typeof payload.condition === "string" ? payload.condition.trim() : (fallback.condition || "good");
  if (!CONDITIONS.has(condition)) {
    fail(400, "INVALID_CONDITION", "장비 상태 값이 올바르지 않습니다.");
  }

  const inspectedRaw = payload.inspectedAt ?? (fallback.inspected_at ? formatIsoDate(fallback.inspected_at) : kstToday());
  const inspectedAt = typeof inspectedRaw === "string" ? inspectedRaw.trim() : "";
  if (!DATE_RE.test(inspectedAt) || Number.isNaN(Date.parse(`${inspectedAt}T00:00:00Z`))) {
    fail(400, "INVALID_DATE", "점검일 형식이 올바르지 않습니다.");
  }

  const included = normalizeText(payload.included ?? fallback.included ?? "", { min: 0, max: 120, field: "포함 구성" });
  const pickupInput = payload.delivery && typeof payload.delivery === "object" && typeof payload.delivery.pickupPlace === "string"
    ? payload.delivery.pickupPlace
    : payload.pickup;
  const pickup = normalizeText(pickupInput ?? fallback.pickup ?? "", { min: 0, max: 120, field: "인수 방식" });
  const description = normalizeText(payload.description ?? fallback.description ?? "", {
    min: 0,
    max: 1000,
    field: "상세 설명",
    allowNewlines: true,
  });

  const summaryInput = payload.summary !== undefined ? payload.summary : (fallback.summary ?? "");
  let summary = normalizeText(summaryInput, { min: 0, max: 300, field: "요약" });
  if (!summary) {
    summary = `${brand} ${title} · ${region}`.slice(0, 300);
  }

  // 운송 방식: 화면·농농이 보낸 값이 우선. 보내지 않았으면(예전 화면·수정 시 생략) 저장된 값, 그것도 없으면 pickup 글로 추정한다.
  const deliveryInput = payload.delivery && typeof payload.delivery === "object" ? payload.delivery : null;
  let deliveryMethods;
  if (deliveryInput) {
    deliveryMethods = cleanDeliveryMethods(deliveryInput.methods);
    const unknown = Array.isArray(deliveryInput.methods) && deliveryInput.methods.some((m) => !["owner_delivery", "self_pickup"].includes(m));
    if (!deliveryMethods.length || unknown) fail(400, "INVALID_DELIVERY", "운송 방식을 하나 이상 골라 주세요.");
  } else {
    deliveryMethods = cleanDeliveryMethods(fallback.delivery_methods);
    if (!deliveryMethods.length) deliveryMethods = inferDeliveryMethods(pickup);
  }
  const ownerDelivers = deliveryMethods.includes("owner_delivery");
  const feeInput = deliveryInput ? deliveryInput.fee : fallback.delivery_fee;
  const deliveryFee = ownerDelivers && feeInput !== null && feeInput !== undefined && feeInput !== ""
    ? normalizePositiveInt(feeInput, { min: 0, max: 10_000_000, field: "운송비" })
    : null;
  const areaInput = deliveryInput ? deliveryInput.area : fallback.delivery_area;
  const deliveryArea = ownerDelivers ? normalizeText(areaInput ?? "", { min: 0, max: 80, field: "운송 가능 범위" }) : "";
  const delivery = { methods: deliveryMethods, fee: deliveryFee, area: deliveryArea };

  const operatorInput = payload.rentalOperator === undefined ? fallback.rental_operator : payload.rentalOperator;
  const rentalOperator = type === "rent" && operatorInput != null ? {
    name: normalizeText(operatorInput.name, { min: 1, max: 40, field: "작업자 이름" }),
    experience: normalizeText(operatorInput.experience, { min: 1, max: 300, field: "작업자 이력", allowNewlines: true }),
    dailyPrice: normalizePositiveInt(operatorInput.dailyPrice, { min: 1, max: 500_000_000, field: "작업자 일당" }),
  } : null;

  return {
    rentalOperator,
    delivery,
    type,
    modelId,
    title,
    brand,
    machineType,
    cropIds,
    operations,
    areaMin,
    areaMax,
    price,
    region,
    condition,
    inspectedAt,
    included,
    pickup,
    description,
    summary,
  };
}

function sameStringArray(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

function matchesExistingListing(row, fields) {
  return (
    row.type === fields.type &&
    row.rental_operator?.name === fields.rentalOperator?.name &&
    row.rental_operator?.experience === fields.rentalOperator?.experience &&
    row.rental_operator?.dailyPrice === fields.rentalOperator?.dailyPrice &&
    (row.model_id ?? null) === (fields.modelId ?? null) &&
    row.title === fields.title &&
    row.brand === fields.brand &&
    row.machine_type === fields.machineType &&
    sameStringArray(row.crop_ids, fields.cropIds) &&
    sameStringArray(row.operations, fields.operations) &&
    Number(row.area_min) === fields.areaMin &&
    Number(row.area_max) === fields.areaMax &&
    Number(row.price) === fields.price &&
    row.region === fields.region &&
    row.condition === fields.condition &&
    formatIsoDate(row.inspected_at) === fields.inspectedAt &&
    row.included === fields.included &&
    row.pickup === fields.pickup &&
    sameStringArray(cleanDeliveryMethods(row.delivery_methods), fields.delivery.methods) &&
    (row.delivery_fee ?? null) === fields.delivery.fee &&
    (row.delivery_area ?? "") === fields.delivery.area &&
    row.description === fields.description
  );
}

export async function createListing(user, payload, { pool = getPool() } = {}) {
  const id = requireUuid(payload?.id, "매물 ID");
  const fields = normalizeListingFields(payload || {});
  const photoDataUrl = typeof payload?.photoDataUrl === "string" && payload.photoDataUrl.trim()
    ? payload.photoDataUrl.trim()
    : null;

  // Idempotency pre-check BEFORE image validation/upload to prevent orphan objects on retry
  const preExisting = await pool.query(`SELECT * FROM listings WHERE id = $1 LIMIT 1`, [id]);
  if (preExisting.rows.length) {
    const existing = preExisting.rows[0];
    if (existing.owner_id !== user.id || !matchesExistingListing(existing, fields)) {
      fail(409, "IDEMPOTENCY_CONFLICT", "이미 처리된 요청 식별자와 충돌합니다.");
    }
    const listing = await fetchListingById(id, { viewerId: user.id, includeRemoved: true, pool });
    return { status: 200, idempotent: true, listing };
  }

  // 현재 회원의 초안 사진만 재사용한다. 이전 초안은 첨부 원본으로 다시 저장할 수 있다.
  const draftPhotoKey = typeof payload?.draftPhotoKey === "string" && payload.draftPhotoKey.trim()
    ? payload.draftPhotoKey.trim()
    : null;
  let draftKey = null;
  if (draftPhotoKey) {
    const draft = isValidPhotoKey(draftPhotoKey) && draftPhotoKey.startsWith(`listings/${id}/`)
      ? await pool.query(
        "SELECT 1 FROM listing_draft_photos WHERE listing_id = $1 AND user_id = $2 AND photo_key = $3",
        [id, user.id, draftPhotoKey],
      )
      : null;
    if (draft?.rows.length && await getPhotoObject(draftPhotoKey)) {
      draftKey = draftPhotoKey;
    }
  }

  let uploadedKey = null;
  if (photoDataUrl && !draftKey) {
    const encoded = await validateAndReencodeImage(photoDataUrl);
    uploadedKey = newListingPhotoKey(id);
    await putPhotoObject(uploadedKey, encoded.buffer, encoded.contentType);
  }

  let outcome;
  try {
    outcome = await withTransaction(async (client) => {
      const locked = await client.query(`SELECT * FROM listings WHERE id = $1 FOR UPDATE`, [id]);
      if (locked.rows.length) {
        const existing = locked.rows[0];
        if (existing.owner_id !== user.id || !matchesExistingListing(existing, fields)) {
          fail(409, "IDEMPOTENCY_CONFLICT", "이미 처리된 요청 식별자와 충돌합니다.");
        }
        return { idempotent: true, discardUploaded: Boolean(uploadedKey) };
      }

      const draftOwner = await client.query(
        "SELECT user_id FROM listing_draft_photos WHERE listing_id = $1 FOR UPDATE",
        [id],
      );
      const reservedForAnotherUser = draftOwner.rows.length > 0 && draftOwner.rows[0].user_id !== user.id;
      if (reservedForAnotherUser || (draftPhotoKey && !draftKey && !uploadedKey)) {
        fail(400, "INVALID_DRAFT_PHOTO", "사진을 다시 올려 주세요.");
      }

      await client.query(
        `INSERT INTO listings (
          id, owner_id, type, model_id, title, brand, machine_type,
          crop_ids, operations, area_min, area_max, price, region,
          condition, inspected_at, included, pickup, description, summary,
          photo_key, status, is_demo, sort_order, rental_operator,
          delivery_methods, delivery_fee, delivery_area
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12, $13,
          $14, $15, $16, $17, $18, $19,
          $20, 'open', false, 0, $21,
          $22, $23, $24
        )`,
        [
          id,
          user.id,
          fields.type,
          fields.modelId,
          fields.title,
          fields.brand,
          fields.machineType,
          fields.cropIds,
          fields.operations,
          fields.areaMin,
          fields.areaMax,
          fields.price,
          fields.region,
          fields.condition,
          fields.inspectedAt,
          fields.included,
          fields.pickup,
          fields.description,
          fields.summary,
          uploadedKey || draftKey,
          fields.rentalOperator,
          fields.delivery.methods,
          fields.delivery.fee,
          fields.delivery.area,
        ]
      );

      if (draftOwner.rows.length) {
        await client.query(
          "DELETE FROM listing_draft_photos WHERE listing_id = $1 AND user_id = $2",
          [id, user.id],
        );
      }
      return { idempotent: false, discardUploaded: false };
    }, pool);
  } catch (error) {
    if (uploadedKey) {
      await deletePhotoObject(uploadedKey).catch(() => {});
    }
    if (error instanceof HttpError) throw error;
    if (error?.code === "23505") {
      const winnerRes = await pool.query(`SELECT * FROM listings WHERE id = $1 LIMIT 1`, [id]);
      const winner = winnerRes.rows[0];
      if (winner && winner.owner_id === user.id && matchesExistingListing(winner, fields)) {
        const listing = await fetchListingById(id, { viewerId: user.id, includeRemoved: true, pool });
        return { status: 200, idempotent: true, listing };
      }
      fail(409, "IDEMPOTENCY_CONFLICT", "이미 처리된 요청 식별자와 충돌합니다.");
    }
    throw error;
  }
  if (outcome.discardUploaded && uploadedKey) {
    await deletePhotoObject(uploadedKey).catch(() => {});
  }
  const listing = await fetchListingById(id, { viewerId: user.id, includeRemoved: true, pool });
  return { status: outcome.idempotent ? 200 : 201, idempotent: outcome.idempotent, listing };
}

export async function updateListing(user, payload, { pool = getPool() } = {}) {
  const action = typeof payload?.action === "string" ? payload.action.trim() : "";
  const id = normalizeText(payload?.id, { min: 1, max: 80, field: "매물 ID" });

  if (!["update", "status", "remove"].includes(action)) {
    fail(400, "UNKNOWN_ACTION", "지원하지 않는 매물 작업입니다.");
  }

  let newPhotoKey = null;
  if (action === "update" && typeof payload?.photoDataUrl === "string" && payload.photoDataUrl.trim()) {
    // Preflight existence & ownership before spending CPU/storage on image re-encoding
    const check = await pool.query(`SELECT owner_id, status FROM listings WHERE id = $1 LIMIT 1`, [id]);
    if (!check.rows.length) fail(404, "LISTING_NOT_FOUND", "매물을 찾을 수 없습니다.");
    if (check.rows[0].owner_id !== user.id) fail(403, "FORBIDDEN", "내가 등록한 매물만 수정할 수 있습니다.");
    if (check.rows[0].status === "removed") fail(409, "LISTING_REMOVED", "삭제된 매물은 수정할 수 없습니다.");

    const encoded = await validateAndReencodeImage(payload.photoDataUrl.trim());
    newPhotoKey = newListingPhotoKey(id);
    await putPhotoObject(newPhotoKey, encoded.buffer, encoded.contentType);
  }

  let oldPhotoKeyToDelete = null;
  let idempotent = false;

  try {
    await withTransaction(async (client) => {
      const lockedRes = await client.query(`SELECT * FROM listings WHERE id = $1 FOR UPDATE`, [id]);
      if (!lockedRes.rows.length) {
        fail(404, "LISTING_NOT_FOUND", "매물을 찾을 수 없습니다.");
      }
      const row = lockedRes.rows[0];
      if (row.owner_id !== user.id) {
        fail(403, "FORBIDDEN", "내가 등록한 매물만 변경할 수 있습니다.");
      }

      const today = kstToday();

      if (action === "remove") {
        if (row.status === "removed") {
          idempotent = true;
          return;
        }
        const activeRes = await client.query(
          `SELECT 1 FROM rental_requests
           WHERE listing_id = $1 AND status = 'approved' AND end_date >= $2
           LIMIT 1`,
          [id, today]
        );
        if (activeRes.rows.length) {
          fail(409, "ACTIVE_BOOKING_EXISTS", "진행 중이거나 예정된 대여 예약이 있어 매물을 숨길 수 없습니다.");
        }
        await client.query(
          `UPDATE listings SET status = 'removed', updated_at = now() WHERE id = $1`,
          [id]
        );
        return;
      }

      if (row.status === "removed") {
        fail(409, "LISTING_REMOVED", "삭제된 매물은 변경할 수 없습니다.");
      }

      if (action === "status") {
        const nextStatus = typeof payload.status === "string" ? payload.status.trim() : "";
        if (!EDITABLE_STATUSES.has(nextStatus)) {
          fail(400, "INVALID_STATUS", "변경할 수 없는 매물 상태입니다.");
        }
        if (row.status === nextStatus) {
          idempotent = true;
          return;
        }
        await client.query(
          `UPDATE listings SET status = $2, updated_at = now() WHERE id = $1`,
          [id, nextStatus]
        );
        return;
      }

      // action === "update"
      const fields = normalizeListingFields(payload, row);
      if (row.type === "rent" && fields.type !== "rent") {
        const activeRes = await client.query(
          `SELECT 1 FROM rental_requests
           WHERE listing_id = $1 AND status = 'approved' AND end_date >= $2
           LIMIT 1`,
          [id, today]
        );
        if (activeRes.rows.length) {
          fail(409, "ACTIVE_BOOKING_EXISTS", "진행 중이거나 예정된 대여 예약이 있어 거래 방식을 변경할 수 없습니다.");
        }
      }

      const removePhoto = payload.removePhoto === true && !newPhotoKey;
      const nextPhotoKey = newPhotoKey ? newPhotoKey : (removePhoto ? null : row.photo_key);
      if (row.photo_key && (newPhotoKey || removePhoto) && row.photo_key !== nextPhotoKey) {
        oldPhotoKeyToDelete = row.photo_key;
      }

      await client.query(
        `UPDATE listings
         SET type = $2, model_id = $3, title = $4, brand = $5, machine_type = $6,
             crop_ids = $7, operations = $8, area_min = $9, area_max = $10, price = $11,
             region = $12, condition = $13, inspected_at = $14, included = $15,
             pickup = $16, description = $17, summary = $18, photo_key = $19,
             rental_operator = $20, delivery_methods = $21, delivery_fee = $22,
             delivery_area = $23, updated_at = now()
         WHERE id = $1`,
        [
          id,
          fields.type,
          fields.modelId,
          fields.title,
          fields.brand,
          fields.machineType,
          fields.cropIds,
          fields.operations,
          fields.areaMin,
          fields.areaMax,
          fields.price,
          fields.region,
          fields.condition,
          fields.inspectedAt,
          fields.included,
          fields.pickup,
          fields.description,
          fields.summary,
          nextPhotoKey,
          fields.rentalOperator,
          fields.delivery.methods,
          fields.delivery.fee,
          fields.delivery.area,
        ]
      );
    }, pool);
  } catch (error) {
    if (newPhotoKey) {
      await deletePhotoObject(newPhotoKey).catch(() => {});
    }
    throw error;
  }

  // Delete replaced photo only AFTER DB transaction commits cleanly
  if (oldPhotoKeyToDelete) {
    await deletePhotoObject(oldPhotoKeyToDelete).catch((err) => {
      console.warn("old photo delete failed", oldPhotoKeyToDelete, err instanceof Error ? err.message : "unknown");
    });
  }

  const listing = await fetchListingById(id, { viewerId: user.id, includeRemoved: true, pool });
  return { status: 200, idempotent, listing };
}
