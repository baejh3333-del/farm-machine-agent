import { fromNodeHeaders } from "better-auth/node";
import { accountAuth } from "../server/account-auth.js";
import { DEMO_ACCOUNT_EMAIL, assignDemoOwnership } from "../server/schema.js";

const routes = new Map([
  ["session", ["GET", "/get-session"]],
  ["signup", ["POST", "/sign-up/email"]],
  ["login", ["POST", "/sign-in/email"]],
  ["logout", ["POST", "/sign-out"]],
]);
const maxBodyBytes = 4096;

function json(response, status, code) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify({ code }));
}

async function readBody(request) {
  if (Number(request.headers["content-length"]) > maxBodyBytes) return null;
  if (request.body !== undefined) {
    const body = typeof request.body === "string" ? request.body : JSON.stringify(request.body);
    return Buffer.byteLength(body) <= maxBodyBytes ? JSON.parse(body) : null;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      request.resume();
      return null;
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export default async function accountHandler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  const action = new URL(request.url, "http://localhost").searchParams.get("action");
  const route = routes.get(action);
  if (!route) return json(response, 404, "UNKNOWN_ACTION");
  const [method, path] = route;
  if (request.method !== method) {
    response.setHeader("Allow", method);
    return json(response, 405, "METHOD_NOT_ALLOWED");
  }

  const https = process.env.VERCEL || process.env.BETTER_AUTH_URL?.startsWith("https://");
  const origin = `${https ? "https" : "http"}://${request.headers.host}`;
  const headers = fromNodeHeaders(request.headers);
  if (!process.env.VERCEL) headers.set("x-moa-local-ip", request.socket.remoteAddress || "127.0.0.1");
  let body;
  if (method === "POST") {
    if (headers.get("origin") !== origin) return json(response, 403, "INVALID_ORIGIN");
    if (headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      return json(response, 415, "INVALID_CONTENT_TYPE");
    }
    let data;
    try { data = await readBody(request); }
    catch { return json(response, 400, "INVALID_BODY"); }
    if (!data || typeof data !== "object" || Array.isArray(data)) return json(response, 400, "INVALID_BODY");
    if (action !== "logout") {
      const username = typeof data.username === "string" ? data.username.trim().toLowerCase() : "";
      const password = data.password;
      if (!/^[a-z0-9_-]{3,30}$/.test(username)) return json(response, 400, "INVALID_USERNAME");
      // Better Auth uses an email identifier internally; no user email is collected.
      const email = `${username}@users.moa-farm.example.com`;
      if (typeof password !== "string" || !password || password.length > 128) return json(response, 400, "INVALID_PASSWORD");
      const name = typeof data.name === "string" ? data.name.trim() : "";
      if (action === "signup" && (!name || name.length > 40)) return json(response, 400, "INVALID_NAME");
      body = JSON.stringify(action === "signup" ? { email, password, name } : { email, password });
    } else {
      body = "{}";
    }
    headers.delete("content-length");
  }

  try {
    const auth = await accountAuth();
    const result = await auth.handler(new Request(`${origin}/api/auth${path}`, { method, headers, body }));
    const data = await result.json();
    // 시연 계정(10jo)을 새로 만들면 시드에서 그 계정 소유였던 매물을 바로 넘겨준다.
    if (result.ok && action === "signup" && data?.user?.email === DEMO_ACCOUNT_EMAIL) await assignDemoOwnership();
    const cookies = result.headers.getSetCookie();
    if (cookies.length) response.setHeader("Set-Cookie", cookies);
    response.writeHead(result.status, { "Content-Type": "application/json; charset=utf-8" })
      .end(JSON.stringify(result.ok ? { user: data?.user ?? null } : { code: data?.code }));
  } catch (error) {
    console.error("account failed", error.message);
    return json(response, 503, "ACCOUNT_UNAVAILABLE");
  }
}
