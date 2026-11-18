import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, usesLocalDatabase } from "./server/db.js";
import { ensureLocalDevReady } from "./server/migrator.js";

const rootDir = resolve(fileURLToPath(new URL(".", import.meta.url)));
const allowedStaticDirs = [resolve(rootDir, "src"), resolve(rootDir, "assets"), resolve(rootDir, "public")];
const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "application/javascript; charset=utf-8"],
  [".mjs", "application/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
]);

const apiRouteLoaders = new Map([
  ["/api/account", () => import("./api/account.js")],
  ["/api/listings", () => import("./api/listings.js")],
  ["/api/recommend", () => import("./api/recommend.js")],
  ["/api/agent", () => import("./api/agent.js")],
  ["/api/me", () => import("./api/me.js")],
  ["/api/requests", () => import("./api/requests.js")],
  ["/api/conversations", () => import("./api/conversations.js")],
  ["/api/agent-chat-reply", () => import("./api/agent-chat-reply.js")],
  ["/api/photos", () => import("./api/photos.js")],
  ["/api/weather", () => import("./api/weather.js")],
  ["/api/voice", () => import("./server/voice-api.js")],
  ["/api/integrations", () => import("./api/integrations.js")],
  ["/api/delegation-jobs", () => import("./api/delegation-jobs.js")],
]);

/**
 * 로컬 개발 서버용 대리 응대 큐 소비자. 배포 환경의 Vercel Cron(/api/delegation-jobs)과 같은
 * processDelegationJobs를 주기적으로 실행해, 브라우저를 닫아도 대기·재시도 작업이 처리되게 한다.
 * DELEGATION_SWEEP_INTERVAL_MS=0 이면 끈다. 기본 30초.
 */
export function startLocalDelegationSweeper({ intervalMs = Number(process.env.DELEGATION_SWEEP_INTERVAL_MS ?? 30_000) } = {}) {
  if (process.env.VERCEL || !Number.isFinite(intervalMs) || intervalMs <= 0) return null;
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const { processDelegationJobs } = await import("./server/delegation-queue.js");
      await processDelegationJobs({ limit: 10, concurrency: 2, budgetMs: 25_000, backfill: true });
    } catch (error) {
      console.warn("local delegation sweep failed", error instanceof Error ? error.name : "unknown");
    } finally {
      running = false;
    }
  }, Math.max(5_000, intervalMs));
  timer.unref?.();
  return timer;
}

function patchResponse(response) {
  let pendingStatus = 200;
  response.status = (code) => {
    pendingStatus = code;
    return response;
  };
  response.json = (payload) => {
    if (!response.headersSent) {
      response.writeHead(pendingStatus, { "Content-Type": "application/json; charset=utf-8" });
    }
    response.end(JSON.stringify(payload));
    return response;
  };
  return response;
}

function resolveStaticPath(pathname) {
  if (pathname === "/" || pathname === "/index.html") {
    return resolve(rootDir, "index.html");
  }
  const cleanRel = pathname.replace(/^\/+/, "");
  if (!cleanRel || cleanRel.includes("\0")) return null;
  const candidate = resolve(rootDir, cleanRel);
  const inAllowed = allowedStaticDirs.some(
    (dir) => candidate === dir || candidate.startsWith(`${dir}${sep}`)
  );
  return inAllowed ? candidate : null;
}

async function serveStatic(request, response, pathname) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  const filePath = resolveStaticPath(pathname);
  if (!filePath) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
    return;
  }
  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
      return;
    }
    const contentType = mimeTypes.get(extname(filePath).toLowerCase()) || "application/octet-stream";
    if (request.method === "HEAD") {
      response.writeHead(200, { "Content-Type": contentType, "Content-Length": String(info.size) }).end();
      return;
    }
    const body = await readFile(filePath);
    response.writeHead(200, { "Content-Type": contentType, "Content-Length": String(body.length) }).end(body);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
      return;
    }
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" }).end("Server error");
  }
}

export async function createAppServer() {
  if (!process.env.VERCEL && usesLocalDatabase()) {
    await ensureLocalDevReady();
  }

  return createServer(async (request, response) => {
    patchResponse(response);
    const { pathname } = new URL(request.url || "/", "http://localhost");
    const loader = apiRouteLoaders.get(pathname)
      || (pathname.startsWith("/api/auth/") ? () => import("./api/auth/[...all].js") : null);
    if (loader) {
      try {
        const mod = await loader();
        await mod.default(request, response);
      } catch (error) {
        console.error("dev-server route error", pathname, error instanceof Error ? error.message : "unknown");
        if (!response.headersSent) {
          response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        }
        if (!response.writableEnded) {
          response.end(JSON.stringify({ code: "SERVER_ERROR", error: "요청을 처리하지 못했습니다." }));
        }
      }
      return;
    }
    await serveStatic(request, response, pathname);
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const host = process.env.HOST || "127.0.0.1";
  const requestedPort = Number.isFinite(Number(process.env.PORT)) ? Number(process.env.PORT) : 3000;
  const server = await createAppServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(requestedPort, host, resolveListen);
  });
  const addr = server.address();
  const actualPort = typeof addr === "object" && addr ? addr.port : requestedPort;
  console.log(`moa dev-server listening on http://${host}:${actualPort}`);
  const sweeper = startLocalDelegationSweeper();

  const shutdown = async () => {
    if (sweeper) clearInterval(sweeper);
    await new Promise((r) => server.close(r));
    await closePool();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
