const VERCEL_REQ_CONTEXT_SYMBOL = Symbol.for("@vercel/request-context");

function hasActiveVercelWaitUntil() {
  return typeof globalThis[VERCEL_REQ_CONTEXT_SYMBOL]?.get?.()?.waitUntil === "function";
}

/**
 * Schedules a background task via Vercel `waitUntil` when an active request
 * context exists, falling back to awaiting on serverless or detaching locally.
 */
export async function scheduleWaitUntil(task, { awaitFallback = Boolean(process.env.VERCEL) } = {}) {
  if (hasActiveVercelWaitUntil()) {
    const vf = await import("@vercel/functions").catch(() => null);
    if (typeof vf?.waitUntil === "function") {
      try {
        vf.waitUntil(task);
        return "waitUntil";
      } catch {
        // Fall through to fallback handling if waitUntil throws.
      }
    }
  }
  if (awaitFallback) {
    await task;
    return "awaited";
  }
  return "detached";
}
