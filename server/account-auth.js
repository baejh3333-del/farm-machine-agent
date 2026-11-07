import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { betterAuth } from "better-auth";
import { getPool, usesLocalDatabase } from "./db.js";
import { ensureSchema } from "./schema.js";

const dataDirectory = new URL("../data/", import.meta.url);
const secure = Boolean(process.env.VERCEL || process.env.BETTER_AUTH_URL?.startsWith("https://"));
let ready;

function localSecret() {
  mkdirSync(dataDirectory, { recursive: true });
  const file = new URL("account-secret", dataDirectory);
  try {
    writeFileSync(file, randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  return readFileSync(file, "utf8");
}

export function accountAuthOptions({ database, secret, baseURL }) {
  return {
    appName: "모아농기계",
    database,
    secret,
    baseURL,
    emailAndPassword: { enabled: true, minPasswordLength: 8, maxPasswordLength: 128 },
    session: { expiresIn: 7 * 24 * 60 * 60 },
    rateLimit: { enabled: true, storage: "database" },
    advanced: {
      useSecureCookies: secure,
      ipAddress: { ipAddressHeaders: process.env.VERCEL ? ["x-vercel-forwarded-for"] : ["x-moa-local-ip"] },
    },
  };
}

export function createAccountAuth(params) {
  return betterAuth(accountAuthOptions(params));
}

// 계정과 앱 데이터는 같은 DB(getPool)를 쓴다. 매물·신청 테이블이 "user"를 외래 키로 참조하기 때문이다.
// better-auth는 만들어지는 순간 스키마를 검사하므로, 마이그레이션에는 인스턴스 대신 설정만 넘긴다.
export function buildAccountAuthOptions() {
  const { BETTER_AUTH_SECRET, BETTER_AUTH_URL, VERCEL_URL, VERCEL_BRANCH_URL, VERCEL_PROJECT_PRODUCTION_URL } = process.env;
  if (usesLocalDatabase() && !process.env.VERCEL) {
    return accountAuthOptions({
      database: getPool(),
      secret: BETTER_AUTH_SECRET || localSecret(),
      baseURL: BETTER_AUTH_URL || { allowedHosts: ["localhost:*", "127.0.0.1:*"], protocol: "http" },
    });
  }
  const hosts = [VERCEL_URL, VERCEL_BRANCH_URL, VERCEL_PROJECT_PRODUCTION_URL].filter(Boolean);
  if (!BETTER_AUTH_SECRET || (!BETTER_AUTH_URL && !hosts.length)) {
    throw new Error("Account secret and URL must be configured");
  }
  return accountAuthOptions({
    database: getPool(),
    secret: BETTER_AUTH_SECRET,
    baseURL: BETTER_AUTH_URL || { allowedHosts: hosts, protocol: "https" },
  });
}

export function accountAuth() {
  ready ??= (async () => {
    await ensureSchema();
    return betterAuth(buildAccountAuthOptions());
  })().catch((error) => {
    ready = undefined;
    throw error;
  });
  return ready;
}

// 요청 쿠키로 로그인한 사용자를 찾는다. 로그인하지 않았으면 null.
// 세션 쿠키가 없으면 DB를 조회하지 않는다.
export async function sessionUser(headers) {
  if (!headers.get("cookie")?.includes("better-auth.session_token")) return null;
  const auth = await accountAuth();
  const session = await auth.api.getSession({ headers });
  return session?.user ?? null;
}
