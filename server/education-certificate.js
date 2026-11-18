// 마이페이지(내 계정) 교육이수증: 사용자가 올린 이수증 사진을 계정당 1장 보관한다.
// 개인 서류라 공개 URL을 만들지 않고, 본인이 로그인했을 때만 /api/me 로 사진을 받는다.
import { getPool } from "./db.js";
import { fail } from "./http.js";
import { validateAndReencodeImage } from "./images.js";

const UNDEFINED_TABLE = "42P01";

function toStatus(row) {
  if (!row) return { uploaded: false, uploadedAt: null };
  const at = row.uploaded_at instanceof Date ? row.uploaded_at.toISOString() : String(row.uploaded_at);
  return { uploaded: true, uploadedAt: at };
}

/** 이수증 업로드 여부만 돌려준다. 마이그레이션 전(테이블 없음)이면 미업로드로 본다. */
export async function getEducationCertificateStatus(userId, { pool = getPool() } = {}) {
  try {
    const res = await pool.query(
      "SELECT uploaded_at FROM education_certificates WHERE user_id = $1 LIMIT 1",
      [userId]
    );
    return toStatus(res.rows[0]);
  } catch (error) {
    if (error?.code === UNDEFINED_TABLE) return { uploaded: false, uploadedAt: null };
    throw error;
  }
}

/** 사진(data URL)을 검사·재인코딩(WebP, 메타데이터 제거)해 저장한다. 이미 있으면 새 사진으로 바꾼다. */
export async function saveEducationCertificate(userId, photoDataUrl, { pool = getPool(), reencode = validateAndReencodeImage } = {}) {
  if (typeof photoDataUrl !== "string" || !photoDataUrl.trim()) {
    fail(400, "INVALID_PHOTO", "교육이수증 사진을 선택해 주세요.");
  }
  const encoded = await reencode(photoDataUrl.trim());
  const res = await pool.query(
    `INSERT INTO education_certificates (user_id, image, content_type, byte_length, uploaded_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (user_id) DO UPDATE
       SET image = EXCLUDED.image,
           content_type = EXCLUDED.content_type,
           byte_length = EXCLUDED.byte_length,
           uploaded_at = EXCLUDED.uploaded_at
     RETURNING uploaded_at`,
    [userId, encoded.buffer, encoded.contentType, encoded.byteLength]
  );
  return toStatus(res.rows[0]);
}

/** 본인 이수증 사진을 data URL로 돌려준다. 없으면 404. */
export async function getEducationCertificateImage(userId, { pool = getPool() } = {}) {
  const res = await pool.query(
    "SELECT image, content_type, uploaded_at FROM education_certificates WHERE user_id = $1 LIMIT 1",
    [userId]
  );
  const row = res.rows[0];
  if (!row) fail(404, "CERTIFICATE_NOT_FOUND", "등록된 교육이수증이 없습니다.");
  const buffer = Buffer.isBuffer(row.image) ? row.image : Buffer.from(row.image);
  return {
    ...toStatus(row),
    imageDataUrl: `data:${row.content_type || "image/webp"};base64,${buffer.toString("base64")}`,
  };
}

/** 사용자가 직접 요청했을 때만 본인 이수증 사진을 지운다. */
export async function deleteEducationCertificate(userId, { pool = getPool() } = {}) {
  await pool.query("DELETE FROM education_certificates WHERE user_id = $1", [userId]);
  return { uploaded: false, uploadedAt: null };
}
