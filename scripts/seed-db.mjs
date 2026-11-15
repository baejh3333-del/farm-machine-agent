import { closePool } from "../server/db.js";
import { resolveExpectedEnv, seedDemoListings } from "../server/migrator.js";

try {
  const env = resolveExpectedEnv();
  const result = await seedDemoListings({ env });
  console.log(`시드 완료 (${result.environment}): 총 ${result.totalDemo}건 중 ${result.inserted}건 추가`);
} finally {
  await closePool();
}
