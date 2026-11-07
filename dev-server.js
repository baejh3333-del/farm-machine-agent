import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import accountHandler from "./api/account.js";
import conversationsHandler from "./api/conversations.js";
import listingsHandler from "./api/listings.js";
import meHandler from "./api/me.js";
import recommendHandler, { MAX_BODY_BYTES } from "./api/recommend.js";
import requestsHandler from "./api/requests.js";
import { ensureSchema } from "./server/schema.js";

const root = fileURLToPath(new URL(".", import.meta.url));
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg" };
const allowed = /^\/(?:$|index\.html$|src\/[\w./-]+\.(?:js|css|svg|png|jpg)$)/;

// api/*.js를 Vercel과 똑같이 실행한다. /api/account는 본문을 직접 읽으므로 그대로 넘긴다.
const handlers = new Map([
  ["/api/conversations", conversationsHandler],
  ["/api/listings", listingsHandler],
  ["/api/me", meHandler],
  ["/api/recommend", recommendHandler],
  ["/api/requests", requestsHandler],
]);

// Vercel이 붙여 주는 response.status()/json()만 흉내 낸다.
function withVercelHelpers(response) {
  response.status = (code) => {
    response.statusCode = code;
    return response;
  };
  response.json = (body) => {
    if (!response.hasHeader("content-type")) response.setHeader("content-type", "application/json; charset=utf-8");
    response.end(JSON.stringify(body));
    return response;
  };
  return response;
}

async function readBody(request, limit) {
  if (Number(request.headers["content-length"]) > limit) return null;
  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > limit) {
      request.resume();
      return null;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function createDevServer() {
  return createServer(async (request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    if (path === "/api/account") return accountHandler(request, response);
    const handler = handlers.get(path);
    if (handler) {
      withVercelHelpers(response);
      if (request.method === "POST") {
        const body = await readBody(request, MAX_BODY_BYTES);
        if (body === null) return response.status(413).json({ error: "요청이 너무 큽니다." });
        request.body = body;
      }
      return handler(request, response);
    }
    // 화면은 HEAD 요청의 Date 헤더로 서버 시간을 맞춘다(Vercel 정적 파일과 같게).
    if (!["GET", "HEAD"].includes(request.method) || !allowed.test(path) || path.includes("..")) { response.writeHead(404).end(); return; }
    const file = resolve(join(root, path === "/" ? "index.html" : path.slice(1)));
    if (!file.startsWith(root)) { response.writeHead(404).end(); return; }
    try {
      const content = await readFile(file);
      response.writeHead(200, { "content-type": mime[extname(file)] || "application/octet-stream" }).end(request.method === "HEAD" ? undefined : content);
    } catch { response.writeHead(404).end(); }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // 첫 요청을 기다리지 않고 미리 DB를 준비해 설정 오류를 바로 보여 준다.
  ensureSchema().catch((error) => console.error("데이터베이스를 준비하지 못했습니다:", error.message));
  const port = Number(process.env.PORT) || 3000;
  createDevServer().listen(port, "127.0.0.1", () => console.log(`모아농기계: http://localhost:${port}`));
}
