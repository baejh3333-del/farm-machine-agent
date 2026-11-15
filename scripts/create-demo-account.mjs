import { postgresAuth } from "../server/account-auth.js";
import { closePool, getPool } from "../server/db.js";
import { DEMO_ACCOUNT_EMAIL, DEMO_OWNER_ID } from "../server/migrator.js";

// Run only in a trusted environment with DATABASE_URL, BETTER_AUTH_SECRET,
// BETTER_AUTH_URL, and DEMO_ACCOUNT_PASSWORD set. Never commit passwords.
const password = process.env.DEMO_ACCOUNT_PASSWORD;
if (!password || password.length < 8 || password.length > 128) {
  throw new Error("DEMO_ACCOUNT_PASSWORD must be between 8 and 128 characters");
}

const auth = postgresAuth();
try {
  const result = await auth.api.signUpEmail({
    body: {
      name: "시연용 계정",
      email: DEMO_ACCOUNT_EMAIL,
      password,
    },
  });
  const userId = result.user?.id;
  if (userId) {
    const pool = getPool();
    const reg = await pool.query("SELECT to_regclass('public.listings')::text AS reg");
    if (reg.rows[0]?.reg) {
      await pool.query(
        "UPDATE listings SET owner_id = $1 WHERE id IN ('r1', 's1') AND owner_id = $2",
        [userId, DEMO_OWNER_ID]
      );
    }
  }
  console.log("10jo 시연용 계정 등록 완료:", userId);
} finally {
  await closePool();
}
