import { getMigrations } from "better-auth/db/migration";
import { postgresAuth } from "../server/account-auth.js";

const auth = postgresAuth();
try {
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
  console.log("계정 데이터베이스 준비 완료");
} finally {
  await auth.options.database.end();
}
