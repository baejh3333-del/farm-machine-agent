import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import pg from "pg";

const dataDirectory = new URL("../data/", import.meta.url);
const secure = Boolean(process.env.VERCEL || process.env.BETTER_AUTH_URL?.startsWith("https://"));
let ready;

function localSecret() {
  const file = new URL("account-secret", dataDirectory);
  try {
    writeFileSync(file, randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  return readFileSync(file, "utf8");
}

export function createAccountAuth({ database, secret, baseURL }) {
  return betterAuth({
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
  });
}

export function postgresAuth() {
  const { DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL, VERCEL_URL, VERCEL_BRANCH_URL, VERCEL_PROJECT_PRODUCTION_URL } = process.env;
  const hosts = [VERCEL_URL, VERCEL_BRANCH_URL, VERCEL_PROJECT_PRODUCTION_URL].filter(Boolean);
  const baseURL = BETTER_AUTH_URL || { allowedHosts: hosts, protocol: "https" };
  if (!DATABASE_URL || !BETTER_AUTH_SECRET || (!BETTER_AUTH_URL && !hosts.length)) {
    throw new Error("Account database, secret and URL must be configured");
  }
  const database = new pg.Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 5000 });
  return createAccountAuth({ database, secret: BETTER_AUTH_SECRET, baseURL });
}

export function accountAuth() {
  ready ??= (async () => {
    if (process.env.VERCEL || process.env.DATABASE_URL) return postgresAuth();
    mkdirSync(dataDirectory, { recursive: true });
    const database = new DatabaseSync(new URL("accounts.sqlite", dataDirectory), { timeout: 5000 });
    try {
      const port = Number(process.env.PORT) || 3000;
      const auth = createAccountAuth({
        database,
        secret: process.env.BETTER_AUTH_SECRET || localSecret(),
        baseURL: {
          allowedHosts: [`localhost:${port}`, `127.0.0.1:${port}`],
          protocol: "http",
        },
      });
      const { runMigrations } = await getMigrations(auth.options);
      await runMigrations();
      return auth;
    } catch (error) {
      database.close();
      throw error;
    }
  })().catch((error) => {
    ready = undefined;
    throw error;
  });
  return ready;
}
