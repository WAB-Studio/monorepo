import assert from "node:assert/strict";
import test from "node:test";

// `next.config.ts` runs its guard at import, so each case loads a fresh copy.
async function load(env: Record<string, string | undefined>): Promise<unknown> {
  const saved = { seam: process.env.PULSAR_FAULT_SEAM, vercel: process.env.VERCEL };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await import(`../next.config?case=${Math.random()}`);
  } finally {
    for (const [key, value] of [
      ["PULSAR_FAULT_SEAM", saved.seam],
      ["VERCEL", saved.vercel],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("a Vercel build that carries the fault seam is refused", async () => {
  await assert.rejects(
    () => load({ VERCEL: "1", PULSAR_FAULT_SEAM: "reading_lookups" }),
    /PULSAR_FAULT_SEAM is set on Vercel/,
  );
});

test("the seam alone, or Vercel alone, builds", async () => {
  await load({ VERCEL: undefined, PULSAR_FAULT_SEAM: "reading_lookups" });
  await load({ VERCEL: "1", PULSAR_FAULT_SEAM: undefined });
});
