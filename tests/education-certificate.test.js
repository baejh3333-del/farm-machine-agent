import assert from "node:assert/strict";
import test from "node:test";
import {
  deleteEducationCertificate,
  getEducationCertificateImage,
  getEducationCertificateStatus,
  saveEducationCertificate,
} from "../server/education-certificate.js";

// 메모리 안에서만 동작하는 간단한 가짜 DB
function fakePool() {
  const rows = new Map();
  return {
    rows,
    async query(sql, params) {
      if (/^\s*INSERT INTO education_certificates/.test(sql)) {
        const [userId, image, contentType, byteLength] = params;
        const row = { user_id: userId, image, content_type: contentType, byte_length: byteLength, uploaded_at: new Date("2026-11-17T03:00:00Z") };
        rows.set(userId, row);
        return { rows: [{ uploaded_at: row.uploaded_at }] };
      }
      if (/^\s*SELECT/.test(sql)) {
        const row = rows.get(params[0]);
        return { rows: row ? [row] : [] };
      }
      if (/^\s*DELETE/.test(sql)) {
        rows.delete(params[0]);
        return { rows: [] };
      }
      throw new Error(`unexpected sql: ${sql}`);
    },
  };
}

const fakeReencode = async () => {
  const buffer = Buffer.from("RIFFxxxxWEBP");
  return { buffer, contentType: "image/webp", byteLength: buffer.length };
};

test("올리기 전에는 미등록, 올리면 체크 상태(uploaded)가 된다", async () => {
  const pool = fakePool();
  assert.deepEqual(await getEducationCertificateStatus("u1", { pool }), { uploaded: false, uploadedAt: null });
  const saved = await saveEducationCertificate("u1", "data:image/jpeg;base64,AAAA", { pool, reencode: fakeReencode });
  assert.equal(saved.uploaded, true);
  assert.equal(saved.uploadedAt, "2026-11-17T03:00:00.000Z");
  assert.equal((await getEducationCertificateStatus("u1", { pool })).uploaded, true);
  // 다른 사용자에게는 보이지 않는다
  assert.equal((await getEducationCertificateStatus("u2", { pool })).uploaded, false);
});

test("본인 사진은 data URL로 돌려주고, 없으면 404", async () => {
  const pool = fakePool();
  await saveEducationCertificate("u1", "data:image/png;base64,AAAA", { pool, reencode: fakeReencode });
  const img = await getEducationCertificateImage("u1", { pool });
  assert.match(img.imageDataUrl, /^data:image\/webp;base64,/);
  await assert.rejects(getEducationCertificateImage("u2", { pool }), (e) => e.status === 404);
});

test("다시 올리면 한 장으로 교체되고, 삭제하면 체크가 풀린다", async () => {
  const pool = fakePool();
  await saveEducationCertificate("u1", "data:image/png;base64,AAAA", { pool, reencode: fakeReencode });
  await saveEducationCertificate("u1", "data:image/png;base64,BBBB", { pool, reencode: fakeReencode });
  assert.equal(pool.rows.size, 1);
  assert.deepEqual(await deleteEducationCertificate("u1", { pool }), { uploaded: false, uploadedAt: null });
  assert.equal((await getEducationCertificateStatus("u1", { pool })).uploaded, false);
});

test("빈 사진은 거부한다", async () => {
  const pool = fakePool();
  await assert.rejects(saveEducationCertificate("u1", "", { pool, reencode: fakeReencode }), (e) => e.status === 400);
  await assert.rejects(saveEducationCertificate("u1", null, { pool, reencode: fakeReencode }), (e) => e.status === 400);
});

test("마이그레이션 전(테이블 없음)에도 내 계정 화면은 미등록으로 열린다", async () => {
  const pool = { async query() { const e = new Error("relation does not exist"); e.code = "42P01"; throw e; } };
  assert.deepEqual(await getEducationCertificateStatus("u1", { pool }), { uploaded: false, uploadedAt: null });
});
