import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "./db.js";
import { fail } from "./http.js";

const PHOTO_KEY_RE =
  /^listings\/([A-Za-z0-9_-]{1,80})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.webp$/i;

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

export function photoPublicUrl(key) {
  if (!isValidPhotoKey(key)) return undefined;
  return `/api/photos?key=${encodeURIComponent(key)}`;
}

function useVercelBlob() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function blobAccessMode() {
  return process.env.BLOB_ACCESS === "private" ? "private" : "public";
}

function localStorageRoot() {
  if (process.env.OBJECT_STORAGE_DIR) {
    return resolve(process.env.OBJECT_STORAGE_DIR);
  }
  if (process.env.VERCEL) {
    fail(503, "OBJECT_STORAGE_UNCONFIGURED", "객체 저장소가 구성되지 않았습니다.");
  }
  if (process.env.NODE_TEST_CONTEXT) {
    return resolve(join(tmpdir(), `moa-test-objects-${process.pid}`));
  }
  return resolve(fileURLToPath(new URL("../data/objects", import.meta.url)));
}

function resolveLocalPath(key) {
  if (!isValidPhotoKey(key)) {
    fail(400, "INVALID_PHOTO_KEY", "잘못된 사진 키입니다.");
  }
  const root = localStorageRoot();
  const target = resolve(join(root, key));
  if (!target.startsWith(`${root}${process.platform === "win32" ? "\\" : "/"}`) && target !== root) {
    fail(400, "INVALID_PHOTO_KEY", "잘못된 사진 경로입니다.");
  }
  return target;
}

export async function putPhotoObject(key, buffer, contentType = "image/webp") {
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
    return { key };
  }

  const filePath = resolveLocalPath(key);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, buffer, { flag: "wx" });
  return { key };
}

export async function getPhotoObject(key) {
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

  const filePath = resolveLocalPath(key);
  try {
    const buffer = await readFile(filePath);
    return { buffer, contentType: "image/webp" };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function deletePhotoObject(key) {
  if (!isValidPhotoKey(key)) return false;

  if (useVercelBlob()) {
    const { del } = await import("@vercel/blob");
    await del(key);
    return true;
  }

  const filePath = resolveLocalPath(key);
  try {
    await rm(filePath, { force: true });
    return true;
  } catch {
    return false;
  }
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

export async function listPhotoObjects() {
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

  const root = localStorageRoot();
  const base = join(root, "listings");
  return walkLocalFiles(base, "listings");
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
  const stored = await listPhotoObjects();

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
      await deletePhotoObject(obj.key);
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
