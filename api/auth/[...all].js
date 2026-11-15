import { fromNodeHeaders } from "better-auth/node";
import { accountAuth } from "../../server/account-auth.js";

const maxBodyBytes = 16384;

async function readRawBody(request) {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  if (Number(request.headers["content-length"]) > maxBodyBytes) return null;
  if (request.body !== undefined) {
    return typeof request.body === "string" ? request.body : JSON.stringify(request.body);
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
  return chunks.length ? Buffer.concat(chunks).toString("utf8") : undefined;
}

export default async function betterAuthHandler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  const https = process.env.VERCEL || process.env.BETTER_AUTH_URL?.startsWith("https://");
  const host = request.headers.host || "localhost:3000";
  const origin = `${https ? "https" : "http"}://${host}`;
  const headers = fromNodeHeaders(request.headers);
  if (!process.env.VERCEL) {
    headers.set("x-moa-local-ip", request.socket?.remoteAddress || "127.0.0.1");
  }
  headers.delete("content-length");

  const body = await readRawBody(request);
  if (body === null) {
    response.writeHead(413, { "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify({ code: "PAYLOAD_TOO_LARGE" }));
    return;
  }

  try {
    const auth = await accountAuth();
    const webRequest = new Request(`${origin}${request.url}`, {
      method: request.method,
      headers,
      ...(body !== undefined ? { body } : {}),
    });
    const result = await auth.handler(webRequest);

    const outHeaders = {};
    for (const [key, value] of result.headers.entries()) {
      if (key.toLowerCase() !== "set-cookie") {
        outHeaders[key] = value;
      }
    }
    const cookies = result.headers.getSetCookie?.() ?? [];
    if (cookies.length) {
      response.setHeader("Set-Cookie", cookies);
    }
    const buffer = Buffer.from(await result.arrayBuffer());
    response.writeHead(result.status, outHeaders).end(buffer);
  } catch (error) {
    console.error("auth catch-all failed", error instanceof Error ? error.message : "unknown");
    response.writeHead(503, { "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify({ code: "ACCOUNT_UNAVAILABLE" }));
  }
}
