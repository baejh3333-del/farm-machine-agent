import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "./db.js";
import { fail } from "./http.js";
import { isUuid } from "./validate.js";

const PHOTO_KEY_RE =
  /^(?:listings|uploads)\/([A-Za-z0-9_-]{1,80})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.webp$/i;

export function isValidPhotoKey(key) {
  return typeof key === "string" && PHOTO_KEY_RE.test(key);
}

export function newListingPhotoKey(listingId) {
  const safeId = String(listingId || "").replace(/[^A-Za-z0-9_-]/g, "");
  if (!safeId || safeId.length > 80) {
    fail(400, "INVALID_LISTING_ID", "유효하지 않은 매물 식별자입니다.");
  }
  return `listings/${safeId}/${randomUUID()}.webp`;
}

export function newUploadedPhotoKey(ownerId) {
  const safeId = String(ownerId || "user").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80) || "user";
  return `uploads/${safeId}/${randomUUID()}.webp`;
}

export function photoPublicUrl(key) {
  if (!isValidPhotoKey(key)) return undefined;
  return `/api/photos?key=${encodeURIComponent(key)}`;
}

function useVercelBlob() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function useLocalFilesystem() {
  return !useVercelBlob() && Boolean(process.env.OBJECT_STORAGE_DIR);
}

export function getPhotoStorageMode() {
  if (useVercelBlob()) return "blob";
  if (useLocalFilesystem()) return "fs";
  return "db";
}

function blobAccessMode() {
  return process.env.BLOB_ACCESS === "private" ? "private" : "public";
}

function legacyLocalObjectsRoot() {
  return resolve(fileURLToPath(new URL("../data/objects", import.meta.url)));
}

function resolvePathUnder(root, key) {
  if (!isValidPhotoKey(key)) {
    fail(400, "INVALID_PHOTO_KEY", "잘못된 사진 키입니다.");
  }
  const target = resolve(join(root, key));
  if (!target.startsWith(`${root}${process.platform === "win32" ? "\\" : "/"}`) && target !== root) {
    fail(400, "INVALID_PHOTO_KEY", "잘못된 사진 경로입니다.");
  }
  return target;
}

function resolveLocalPath(key) {
  const root = resolve(process.env.OBJECT_STORAGE_DIR);
  return resolvePathUnder(root, key);
}

function toBuffer(raw) {
  if (Buffer.isBuffer(raw)) return raw;
  if (raw instanceof Uint8Array) return Buffer.from(raw);
  if (typeof raw === "string") {
    if (raw.startsWith("\\x")) return Buffer.from(raw.slice(2), "hex");
    return Buffer.from(raw, "base64");
  }
  return Buffer.from(raw);
}

async function putPhotoInDb(key, buffer, contentType, { pool = getPool(), ownerId = null, filename = "" } = {}) {
  const safeFilename = typeof filename === "string" ? filename.trim().slice(0, 180) : "";
  const safeOwnerId = typeof ownerId === "string" && ownerId.trim() ? ownerId.trim() : null;
  const res = await pool.query(
    `INSERT INTO stored_images (storage_key, owner_id, mime_type, filename, byte_size, data)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, storage_key, mime_type, byte_size, created_at`,
    [key, safeOwnerId, contentType || "image/webp", safeFilename, buffer.length, buffer]
  );
  const row = res.rows[0];
  return {
    id: String(row.id),
    key: row.storage_key,
    contentType: row.mime_type,
    byteSize: Number(row.byte_size),
  };
}

async function getPhotoFromDbByKey(key, { pool = getPool() } = {}) {
  try {
    const res = await pool.query(
      `SELECT id, storage_key, mime_type, data FROM stored_images WHERE storage_key = $1 LIMIT 1`,
      [key]
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      id: String(row.id),
      key: row.storage_key,
      buffer: toBuffer(row.data),
      contentType: row.mime_type || "image/webp",
    };
  } catch (error) {
    if (error?.code === "42P01") return null;
    throw error;
  }
}

export async function getPhotoObjectById(id, { pool = getPool() } = {}) {
  if (!isUuid(id)) return null;
  try {
    const res = await pool.query(
      `SELECT id, storage_key, mime_type, data FROM stored_images WHERE id = $1 LIMIT 1`,
      [id.trim().toLowerCase()]
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      id: String(row.id),
      key: row.storage_key,
      buffer: toBuffer(row.data),
      contentType: row.mime_type || "image/webp",
    };
  } catch (error) {
    if (error?.code === "42P01") return null;
    throw error;
  }
}

export async function putPhotoObject(key, buffer, contentType = "image/webp", options = {}) {
  if (!isValidPhotoKey(key)) {
    fail(400, "INVALID_PHOTO_KEY", "잘못된 사진 키입니다.");
  }
  if (useVercelBlob()) {
    const { put } = await import("@vercel/blob");
    await put(key, buffer, {
      access: blobAccessMode(),
      contentType,
      addRandomSuffix: false,
      allowOverwrite: false,
    });
    return { key, contentType, byteSize: buffer.length };
  }

  if (useLocalFilesystem()) {
    const filePath = resolveLocalPath(key);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, buffer, { flag: "wx" });
    return { key, contentType, byteSize: buffer.length };
  }

  return putPhotoInDb(key, buffer, contentType, options);
}

export async function getPhotoObject(key, { pool = getPool() } = {}) {
  if (!isValidPhotoKey(key)) return null;

  if (useVercelBlob()) {
    const { get } = await import("@vercel/blob");
    const result = await get(key, { access: blobAccessMode() });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    const chunks = [];
    for await (const chunk of result.stream) chunks.push(Buffer.from(chunk));
    return {
      buffer: Buffer.concat(chunks),
      contentType: result.blob?.contentType || "image/webp",
    };
  }

  if (useLocalFilesystem()) {
    const filePath = resolveLocalPath(key);
    try {
      const buffer = await readFile(filePath);
      return { buffer, contentType: "image/webp" };
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      return getPhotoFromDbByKey(key, { pool });
    }
  }

  const fromDb = await getPhotoFromDbByKey(key, { pool });
  if (fromDb) return fromDb;

  // Read-only fallback for legacy local dev files created before DB photo storage
  if (!process.env.VERCEL && !process.env.NODE_TEST_CONTEXT) {
    try {
      const legacyPath = resolvePathUnder(legacyLocalObjectsRoot(), key);
      const buffer = await readFile(legacyPath);
      return { buffer, contentType: "image/webp" };
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  return null;
}

export async function deletePhotoObject(key, { pool = getPool() } = {}) {
  if (!isValidPhotoKey(key)) return false;

  if (useVercelBlob()) {
    const { del } = await import("@vercel/blob");
    await del(key);
    return true;
  }

  if (useLocalFilesystem()) {
    const filePath = resolveLocalPath(key);
    try {
      await rm(filePath, { force: true });
    } catch {
      // ignore fs delete error and still clean DB if any
    }
    try {
      await pool.query("DELETE FROM stored_images WHERE storage_key = $1", [key]);
    } catch (error) {
      if (error?.code !== "42P01") throw error;
    }
    return true;
  }

  const res = await pool.query("DELETE FROM stored_images WHERE storage_key = $1", [key]);
  return (res.rowCount ?? 0) > 0;
}

async function walkLocalFiles(dir, prefix = "") {
  const entries = await readdir(dir, { withFileTypes: true }).catch((err) => {
    if (err?.code === "ENOENT") return [];
    throw err;
  });
  const items = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      items.push(...(await walkLocalFiles(full, rel)));
    } else if (entry.isFile()) {
      const info = await stat(full);
      items.push({ key: rel.replaceAll("\\", "/"), mtimeMs: info.mtimeMs });
    }
  }
  return items;
}

export async function listPhotoObjects({ pool = getPool() } = {}) {
  if (useVercelBlob()) {
    const { list } = await import("@vercel/blob");
    const items = [];
    let cursor;
    do {
      const page = await list({ prefix: "listings/", cursor });
      for (const blob of page.blobs || []) {
        items.push({
          key: blob.pathname,
          mtimeMs: new Date(blob.uploadedAt).getTime(),
        });
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return items;
  }

  if (useLocalFilesystem()) {
    const root = resolve(process.env.OBJECT_STORAGE_DIR);
    const base = join(root, "listings");
    return walkLocalFiles(base, "listings");
  }

  const res = await pool.query(
    `SELECT storage_key, created_at FROM stored_images WHERE storage_key LIKE 'listings/%' ORDER BY created_at ASC`
  );
  return res.rows.map((row) => ({
    key: row.storage_key,
    mtimeMs: new Date(row.created_at).getTime(),
  }));
}

/**
 * Reconciles stored objects against DB references (including status = 'removed' listings).
 * Only deletes unreferenced objects older than minAgeMs.
 */
export async function reconcilePhotos({ pool = getPool(), minAgeMs = 10 * 60 * 1000, now = Date.now() } = {}) {
  const refRes = await pool.query(
    "SELECT DISTINCT photo_key FROM listings WHERE photo_key IS NOT NULL"
  );
  const referenced = new Set(refRes.rows.map((row) => row.photo_key));
  const stored = await listPhotoObjects({ pool });

  const deletedKeys = [];
  const skippedRecentKeys = [];
  const errors = [];

  for (const obj of stored) {
    if (!isValidPhotoKey(obj.key)) continue;
    if (referenced.has(obj.key)) continue;
    if (now - obj.mtimeMs < minAgeMs) {
      skippedRecentKeys.push(obj.key);
      continue;
    }
    try {
      await deletePhotoObject(obj.key, { pool });
      await pool.query("DELETE FROM listing_draft_photos WHERE photo_key = $1", [obj.key]);
      deletedKeys.push(obj.key);
    } catch (error) {
      errors.push({ key: obj.key, error: error instanceof Error ? error.message : "unknown" });
    }
  }

  return {
    checked: stored.length,
    referencedCount: referenced.size,
    deletedKeys,
    skippedRecentKeys,
    errors,
  };
}
