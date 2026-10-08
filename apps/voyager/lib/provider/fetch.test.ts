// providerFetch with a simulated `fetch`: no network, no key.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { providerFetch } from "./fetch";

const realFetch = globalThis.fetch;
const realError = console.error;
afterEach(() => {
  globalThis.fetch = realFetch;
  console.error = realError;
});

function captureLogs(): string[] {
  const lines: string[] = [];
  console.error = (...args: unknown[]) => void lines.push(args.join(" "));
  return lines;
}

test("a fetch that never resolves returns null within the timeout", async () => {
  globalThis.fetch = ((_url: unknown, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    })) as typeof fetch;
  const lines = captureLogs();
  const started = Date.now();
  // AbortSignal.timeout's timer is unref'd: hold the loop open until it fires.
  const keepAlive = setInterval(() => {}, 10);
  const result = await providerFetch("https://x.invalid", {}, { name: "openai-text", timeoutMs: 50 });
  clearInterval(keepAlive);
  assert.equal(result, null);
  assert.ok(Date.now() - started < 1000);
  assert.deepEqual(lines, ["[provider] openai-text timeout"]);
});

test("a non-OK status returns null and logs the name and status", async () => {
  globalThis.fetch = (async () => new Response("secret body", { status: 429 })) as typeof fetch;
  const lines = captureLogs();
  const result = await providerFetch("https://x.invalid", {}, { name: "openai-text" });
  assert.equal(result, null);
  assert.deepEqual(lines, ["[provider] openai-text 429"]);
});

test("the log never carries the key or the request body", async () => {
  globalThis.fetch = (async () => new Response("", { status: 401 })) as typeof fetch;
  const lines = captureLogs();
  await providerFetch(
    "https://x.invalid",
    { method: "POST", headers: { authorization: "Bearer sk-secret" }, body: "reader text" },
    { name: "openai-notes" },
  );
  const logged = lines.join("\n");
  assert.ok(!logged.includes("sk-secret"));
  assert.ok(!logged.includes("reader text"));
});

test("a dropped network returns null and logs network", async () => {
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  const lines = captureLogs();
  assert.equal(await providerFetch("https://x.invalid", {}, { name: "openai-unlisted" }), null);
  assert.deepEqual(lines, ["[provider] openai-unlisted network"]);
});

test("an OK response passes through as the same Response", async () => {
  const ok = new Response("{}", { status: 200 });
  globalThis.fetch = (async () => ok) as typeof fetch;
  const lines = captureLogs();
  assert.equal(await providerFetch("https://x.invalid", {}, { name: "openai-text" }), ok);
  assert.deepEqual(lines, []);
});
