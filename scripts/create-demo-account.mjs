import { postgresAuth } from "../server/account-auth.js";

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
      email: "10jo@users.moa-farm.example.com",
      password,
    },
  });
  console.log("10jo 시연용 계정 등록 완료:", result.user?.id);
} finally {
  await auth.options.database.end();
}
