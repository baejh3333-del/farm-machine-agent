import sharp from "sharp";
import { fail } from "./http.js";

export const MAX_IMAGE_INPUT_BYTES = 1024 * 1024; // 1MB
export const MAX_IMAGE_DIMENSION = 4096;
export const MAX_IMAGE_PIXELS = 12_000_000;

const DATA_URL_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\r\n]+)$/i;

function hasJpegMagic(buf) {
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

function hasPngMagic(buf) {
  return (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  );
}

function hasWebpMagic(buf) {
  return (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  );
}

export function detectImageMagic(buf) {
  if (!Buffer.isBuffer(buf)) return null;
  if (hasJpegMagic(buf)) return "jpeg";
  if (hasPngMagic(buf)) return "png";
  if (hasWebpMagic(buf)) return "webp";
  return null;
}

export function decodePhotoDataUrl(dataUrl) {
  if (typeof dataUrl !== "string") {
    fail(400, "INVALID_PHOTO", "사진 데이터 형식이 올바르지 않습니다.");
  }
  const match = DATA_URL_RE.exec(dataUrl.trim());
  if (!match) {
    fail(400, "INVALID_PHOTO_FORMAT", "JPG, PNG, WebP 이미지 파일만 등록할 수 있습니다.");
  }
  const declaredMime = match[1].toLowerCase();
  const base64Body = match[2].replace(/\s+/g, "");
  // Reject wildly oversized payloads before allocating large buffers
  if (base64Body.length > Math.ceil((MAX_IMAGE_INPUT_BYTES * 4) / 3) + 16) {
    fail(413, "PHOTO_TOO_LARGE", "사진 용량은 1MB 이하여야 합니다.");
  }
  const buffer = Buffer.from(base64Body, "base64");
  if (!buffer.length || buffer.length > MAX_IMAGE_INPUT_BYTES) {
    fail(413, "PHOTO_TOO_LARGE", "사진 용량은 1MB 이하여야 합니다.");
  }
  const detected = detectImageMagic(buffer);
  const expected = declaredMime === "image/jpeg" ? "jpeg" : declaredMime === "image/png" ? "png" : "webp";
  if (!detected || detected !== expected) {
    fail(400, "INVALID_PHOTO_SIGNATURE", "실제 이미지 파일 형식이 올바르지 않습니다.");
  }
  return buffer;
}

/**
 * Validates raw image buffer (magic bytes, dimensions, pixel limit) and re-encodes
 * as stripped WebP with no EXIF/GPS/ICC/XMP metadata.
 */
export async function validateAndReencodeImage(input) {
  const buffer = typeof input === "string" ? decodePhotoDataUrl(input) : input;
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    fail(400, "INVALID_PHOTO", "사진 데이터가 비어 있습니다.");
  }
  if (buffer.length > MAX_IMAGE_INPUT_BYTES) {
    fail(413, "PHOTO_TOO_LARGE", "사진 용량은 1MB 이하여야 합니다.");
  }
  const magic = detectImageMagic(buffer);
  if (!magic) {
    fail(400, "INVALID_PHOTO_SIGNATURE", "JPG, PNG, WebP 이미지 시그니처가 아닙니다.");
  }

  try {
    const pipeline = sharp(buffer, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: "error" });
    const meta = await pipeline.metadata();
    if (!meta || !["jpeg", "png", "webp"].includes(meta.format)) {
      fail(400, "INVALID_PHOTO_FORMAT", "지원하지 않는 이미지 형식입니다.");
    }
    if (
      !Number.isInteger(meta.width) ||
      !Number.isInteger(meta.height) ||
      meta.width < 1 ||
      meta.height < 1 ||
      meta.width > MAX_IMAGE_DIMENSION ||
      meta.height > MAX_IMAGE_DIMENSION ||
      meta.width * meta.height > MAX_IMAGE_PIXELS
    ) {
      fail(400, "INVALID_PHOTO_DIMENSIONS", "이미지 크기는 가로·세로 4096px 이하만 가능합니다.");
    }

    // Auto-rotate from EXIF orientation, resize only if large, and re-encode to WebP without keeping metadata.
    const output = await sharp(buffer, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: "error" })
      .rotate()
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();

    return {
      buffer: output,
      contentType: "image/webp",
      byteLength: output.length,
    };
  } catch (error) {
    if (error?.status) throw error;
    fail(400, "INVALID_PHOTO_CORRUPT", "손상되었거나 읽을 수 없는 이미지 파일입니다.");
  }
}
