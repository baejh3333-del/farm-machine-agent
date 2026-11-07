import { accountAuth } from "../server/account-auth.js";
import { closePool } from "../server/db.js";
import { DEMO_ACCOUNT_EMAIL, assignDemoOwnership } from "../server/schema.js";

// Run only in a trusted environment with DEMO_ACCOUNT_PASSWORD set (and DATABASE_URL,
// BETTER_AUTH_SECRET, BETTER_AUTH_URL for a deployed database). Never commit passwords.
const password = process.env.DEMO_ACCOUNT_PASSWORD;
if (!password || password.length < 8 || password.length > 128) {
  throw new Error("DEMO_ACCOUNT_PASSWORD must be between 8 and 128 characters");
}
try {
  const auth = await accountAuth();
  const host = new URL(process.env.BETTER_AUTH_URL || `http://localhost:${Number(process.env.PORT) || 3000}`).host;
  const result = await auth.api.signUpEmail({
    headers: new Headers({ host }),
    body: { name: "시연용 계정", email: DEMO_ACCOUNT_EMAIL, password },
  });
  // 시드에서 시연 계정 소유였던 매물(r1, s1)을 이 계정으로 넘긴다.
  await assignDemoOwnership();
  console.log("10jo 시연용 계정 등록 완료:", result.user?.id);
} finally {
  await closePool();
}
