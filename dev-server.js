import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import recommendHandler from "./api/recommend.js";
import accountHandler from "./api/account.js";
import { initListingsDb, listListings, localDatabase } from "./server/listings-db.js";

initListingsDb(localDatabase);

const root = fileURLToPath(new URL(".", import.meta.url));
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg" };
const allowed = /^\/(?:$|index\.html$|src\/[\w./-]+\.(?:js|css|svg|png|jpg)$)/;

const server = createServer(async (request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  if (path === "/api/account") return accountHandler(request, response);
  if (path === "/api/listings") {
    if (request.method !== "GET") { response.writeHead(405, { allow: "GET" }).end(); return; }
    const headers = { "content-type": "application/json; charset=utf-8" };
    try {
      const body = JSON.stringify({ listings: listListings() });
      response.writeHead(200, headers).end(body);
    } catch (error) {
      console.error("listings failed", error.message);
      response.writeHead(500, headers).end(JSON.stringify({ error: "매물을 불러오지 못했습니다." }));
    }
    return;
  }
  if (path === "/api/recommend") return recommendHandler(request, response);
  if (request.method !== "GET" || !allowed.test(path) || path.includes("..")) { response.writeHead(404).end(); return; }
  const file = resolve(join(root, path === "/" ? "index.html" : path.slice(1)));
  if (!file.startsWith(root)) { response.writeHead(404).end(); return; }
  try { const content = await readFile(file); response.writeHead(200, { "content-type": mime[extname(file)] || "application/octet-stream" }).end(content); }
  catch { response.writeHead(404).end(); }
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, "127.0.0.1", () => console.log(`모아농기계: http://localhost:${port}`));
