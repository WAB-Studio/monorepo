import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test, { before, mock } from "node:test";

// `@/db/client` imports `server-only`, which throws outside Next.
mock.module("@/db/client", { namedExports: { db: {} } });

let bearerOf: typeof import("./tokens").bearerOf;
let fingerprint: typeof import("./tokens").fingerprint;
let mintKey: typeof import("./tokens").mintKey;

before(async () => {
  ({ bearerOf, fingerprint, mintKey } = await import("./tokens"));
});

test("a minted key is pls_ and 43 base64url characters", () => {
  assert.match(mintKey().key, /^pls_[A-Za-z0-9_-]{43}$/);
});

test("two mints differ", () => {
  assert.notEqual(mintKey().key, mintKey().key);
});

test("the hint is the key's last four characters", () => {
  const { key, hint } = mintKey();
  assert.equal(hint.length, 4);
  assert.equal(key.endsWith(hint), true);
});

test("the hash is the SHA-256 of the whole key, prefix included", () => {
  const { key, hash } = mintKey();
  assert.equal(hash.length, 32);
  assert.equal(hash.toString("hex"), createHash("sha256").update(key).digest("hex"));
});

test("fingerprint is 32 bytes and deterministic", () => {
  assert.equal(fingerprint("abc").length, 32);
  assert.deepEqual(fingerprint("abc"), fingerprint("abc"));
  assert.notDeepEqual(fingerprint("abc"), fingerprint("abd"));
});

test("bearerOf takes the token after Bearer, any case", () => {
  assert.equal(bearerOf("Bearer x"), "x");
  assert.equal(bearerOf("bearer x"), "x");
  assert.equal(bearerOf("BEARER x"), "x");
});

test("bearerOf refuses another scheme, a bare scheme and null", () => {
  assert.equal(bearerOf("Basic x"), null);
  assert.equal(bearerOf("Bearer"), null);
  assert.equal(bearerOf("Bearer "), null);
  assert.equal(bearerOf(null), null);
  assert.equal(bearerOf(""), null);
});
