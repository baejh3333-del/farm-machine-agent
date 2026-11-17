import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { waitUntil as vercelWaitUntil } from "@vercel/functions";
import { scheduleDelegatedReply } from "../server/delegated-chat.js";
import { scheduleWaitUntil } from "../server/wait-until.js";

const REQ_CONTEXT_SYMBOL = Symbol.for("@vercel/request-context");

function withMockedVercelEnv(vercelValue, contextGetter, fn) {
  const prevVercel = process.env.VERCEL;
  const hadSymbol = Object.prototype.hasOwnProperty.call(globalThis, REQ_CONTEXT_SYMBOL);
  const prevContext = globalThis[REQ_CONTEXT_SYMBOL];

  if (vercelValue === undefined) {
    delete process.env.VERCEL;
  } else {
    process.env.VERCEL = vercelValue;
  }
  if (contextGetter === undefined) {
    delete globalThis[REQ_CONTEXT_SYMBOL];
  } else {
    globalThis[REQ_CONTEXT_SYMBOL] = { get: contextGetter };
  }

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (prevVercel === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = prevVercel;
      if (hadSymbol) globalThis[REQ_CONTEXT_SYMBOL] = prevContext;
      else delete globalThis[REQ_CONTEXT_SYMBOL];
    });
}

test("@vercel/functions package is installed and exports waitUntil", () => {
  assert.equal(typeof vercelWaitUntil, "function");
});

test("scheduleWaitUntil uses @vercel/functions waitUntil when request context is active", async () => {
  const registered = [];
  let resolved = false;
  const task = new Promise((resolve) => {
    setTimeout(() => {
      resolved = true;
      resolve("done");
    }, 20);
  });

  await withMockedVercelEnv("1", () => ({ waitUntil: (p) => registered.push(p) }), async () => {
    const mode = await scheduleWaitUntil(task);
    assert.equal(mode, "waitUntil");
    assert.equal(registered.length, 1);
    assert.equal(registered[0], task);
    assert.equal(resolved, false);
  });

  assert.equal(await task, "done");
  assert.equal(resolved, true);
});

test("scheduleWaitUntil awaits task on VERCEL when request context waitUntil is missing", async () => {
  let resolved = false;
  const task = new Promise((resolve) => {
    setTimeout(() => {
      resolved = true;
      resolve("fallback-done");
    }, 15);
  });

  await withMockedVercelEnv("1", undefined, async () => {
    const mode = await scheduleWaitUntil(task);
    assert.equal(mode, "awaited");
    assert.equal(resolved, true);
  });
});

test("scheduleWaitUntil falls back to awaiting when waitUntil throws", async () => {
  let resolved = false;
  const task = new Promise((resolve) => {
    setTimeout(() => {
      resolved = true;
      resolve("recovered");
    }, 15);
  });

  await withMockedVercelEnv(
    "1",
    () => ({
      waitUntil: () => {
        throw new Error("waitUntil unavailable");
      },
    }),
    async () => {
      const mode = await scheduleWaitUntil(task);
      assert.equal(mode, "awaited");
      assert.equal(resolved, true);
    },
  );
});

test("scheduleWaitUntil detaches locally when not on VERCEL and no request context", async () => {
  let resolved = false;
  const task = new Promise((resolve) => {
    setTimeout(() => {
      resolved = true;
      resolve("local-done");
    }, 15);
  });

  await withMockedVercelEnv(undefined, undefined, async () => {
    const mode = await scheduleWaitUntil(task);
    assert.equal(mode, "detached");
    assert.equal(resolved, false);
  });

  assert.equal(await task, "local-done");
});

test("scheduleDelegatedReply registers task with waitUntil when active and awaits on fallback", async () => {
  const registered = [];
  await withMockedVercelEnv("1", () => ({ waitUntil: (p) => registered.push(p) }), async () => {
    const { task } = await scheduleDelegatedReply({
      conversationId: randomUUID(),
      triggerSeq: 1,
      targetRole: "owner",
    });
    assert.equal(registered.length, 1);
    assert.equal(registered[0], task);
    await task;
  });

  await withMockedVercelEnv("1", undefined, async () => {
    let settled = false;
    const { task } = await scheduleDelegatedReply({
      conversationId: randomUUID(),
      triggerSeq: 1,
      targetRole: "owner",
    });
    void task.then(() => {
      settled = true;
    });
    await Promise.resolve();
    assert.equal(settled, true);
  });
});
