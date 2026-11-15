import { getMigrations } from "better-auth/db/migration";
import { postgresAuth } from "../server/account-auth.js";
import { closePool } from "../server/db.js";

// 관리 작업(마이그레이션 등)은 오래 걸릴 수 있어 쿼리 타임아웃을 기본으로 끈다.
process.env.DB_QUERY_TIMEOUT_MS ??= "0";

const auth = postgresAuth();
try {
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
  console.log("계정 데이터베이스 준비 완료");
} finally {
  await closePool();
}
