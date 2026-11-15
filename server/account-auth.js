import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { betterAuth } from "better-auth";
import { getPool, usesLocalDatabase } from "./db.js";

const dataDirectory = new URL("../data/", import.meta.url);
let cachedPool;
let cachedAuth;

function useSecureCookies() {
  return Boolean(process.env.VERCEL || process.env.BETTER_AUTH_URL?.startsWith("https://"));
}

function localSecret() {
  mkdirSync(dataDirectory, { recursive: true });
  const file = new URL("account-secret", dataDirectory);
  try {
    writeFileSync(file, randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  return readFileSync(file, "utf8").trim();
}

function resolveBaseURL() {
  if (process.env.BETTER_AUTH_URL) return process.env.BETTER_AUTH_URL;
  const vercelHosts = [
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
  ].filter(Boolean);
  if (process.env.VERCEL) {
    if (!vercelHosts.length) {
      throw new Error("BETTER_AUTH_URL or Vercel host variables must be configured");
    }
    return { allowedHosts: vercelHosts, protocol: "https" };
  }
  const port = Number(process.env.PORT) || 3000;
  return {
    allowedHosts: [`localhost:${port}`, `127.0.0.1:${port}`, "localhost:*", "127.0.0.1:*"],
    protocol: "http",
  };
}

function resolveSecret() {
  if (process.env.BETTER_AUTH_SECRET) return process.env.BETTER_AUTH_SECRET;
  if (process.env.VERCEL) throw new Error("BETTER_AUTH_SECRET must be configured on Vercel");
  if (process.env.NODE_TEST_CONTEXT) {
    return "test-only-local-ephemeral-secret-not-for-deployment-0123456789";
  }
  return localSecret();
}

export function getEnabledSocialProviders(env = process.env) {
  return {
    kakao: Boolean(env.KAKAO_CLIENT_ID?.trim() && env.KAKAO_CLIENT_SECRET?.trim()),
    naver: Boolean(env.NAVER_CLIENT_ID?.trim() && env.NAVER_CLIENT_SECRET?.trim()),
  };
}

export function buildSocialProvidersConfig(env = process.env) {
  const providers = {};
  if (env.KAKAO_CLIENT_ID?.trim() && env.KAKAO_CLIENT_SECRET?.trim()) {
    providers.kakao = {
      clientId: env.KAKAO_CLIENT_ID.trim(),
      clientSecret: env.KAKAO_CLIENT_SECRET.trim(),
      mapProfileToUser: (profile) => {
        const account = profile?.kakao_account || {};
        const suffix = String(profile?.id ?? "user").slice(-6);
        return {
          name: `카카오회원_${suffix}`,
          email: account.email || `kakao_${profile?.id ?? "user"}@users.moa-farm.example.com`,
        };
      },
    };
  }
  if (env.NAVER_CLIENT_ID?.trim() && env.NAVER_CLIENT_SECRET?.trim()) {
    providers.naver = {
      clientId: env.NAVER_CLIENT_ID.trim(),
      clientSecret: env.NAVER_CLIENT_SECRET.trim(),
      mapProfileToUser: (profile) => {
        const res = profile?.response || profile || {};
        const suffix = String(res.id ?? "user").slice(-6);
        return {
          name: `네이버회원_${suffix}`,
          email: res.email || `naver_${res.id ?? "user"}@users.moa-farm.example.com`,
        };
      },
    };
  }
  return providers;
}

export function buildAccountAuthOptions({ database = getPool(), secret = resolveSecret(), baseURL = resolveBaseURL(), env = process.env } = {}) {
  const socialProviders = buildSocialProvidersConfig(env);
  return {
    appName: "모아농기계",
    database,
    secret,
    baseURL,
    emailAndPassword: { enabled: true, minPasswordLength: 8, maxPasswordLength: 128 },
    ...(Object.keys(socialProviders).length ? { socialProviders } : {}),
    session: { expiresIn: 7 * 24 * 60 * 60 },
    rateLimit: {
      enabled: !process.env.NODE_TEST_CONTEXT || process.env.ENABLE_AUTH_RATE_LIMIT === "1",
      storage: "database",
    },
    advanced: {
      useSecureCookies: useSecureCookies(),
      ipAddress: {
        ipAddressHeaders: process.env.VERCEL ? ["x-vercel-forwarded-for"] : ["x-moa-local-ip"],
      },
    },
  };
}

export function createAccountAuth({ database, secret, baseURL }) {
  return betterAuth(buildAccountAuthOptions({ database, secret, baseURL }));
}

export function postgresAuth() {
  if (!process.env.DATABASE_URL && usesLocalDatabase() && process.env.VERCEL) {
    throw new Error("Account database must be configured");
  }
  return createAccountAuth({
    database: getPool(),
    secret: resolveSecret(),
    baseURL: resolveBaseURL(),
  });
}

export function resetAuthCache() {
  cachedPool = undefined;
  cachedAuth = undefined;
}

export async function accountAuth() {
  const pool = getPool();
  if (!cachedAuth || cachedPool !== pool) {
    cachedPool = pool;
    cachedAuth = createAccountAuth({ database: pool });
  }
  return cachedAuth;
}

/**
 * Resolves the authenticated session user from Web/Node converted Headers, or null if guest.
 */
export async function sessionUser(headers) {
  const auth = await accountAuth();
  const session = await auth.api.getSession({ headers });
  return session?.user ?? null;
}
