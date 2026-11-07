import { closePool, getPool, usesLocalDatabase } from "../server/db.js";
import { ensureSchema } from "../server/schema.js";

// 계정 테이블(better-auth)과 앱 테이블을 만들고 시드 매물을 넣는다. 여러 번 실행해도 결과가 같다.
// 서버도 처음 요청을 받을 때 같은 일을 하므로, 배포 전에 미리 확인하고 싶을 때 실행한다.
try {
  await ensureSchema();
  const { rows: [counts] } = await getPool().query(`
    SELECT (SELECT count(*)::int FROM listing) AS listings,
           (SELECT count(*)::int FROM listing WHERE type = 'rent') AS rentals,
           (SELECT count(*)::int FROM booking) AS bookings,
           (SELECT count(*)::int FROM "user") AS users
  `, []);
  console.log(`${usesLocalDatabase() ? "로컬 DB(data/pglite)" : "DATABASE_URL"} 준비 완료: 매물 ${counts.listings}건(대여 ${counts.rentals}건), 예약 ${counts.bookings}건, 사용자 ${counts.users}명`);
} finally {
  await closePool();
}
