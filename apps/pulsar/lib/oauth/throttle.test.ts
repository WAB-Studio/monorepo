import assert from "node:assert/strict";
import test, { before, mock } from "node:test";

// `@/db/client` imports `server-only`, which throws outside Next.
mock.module("@/db/client", { namedExports: { db: {} } });

let callerAddress: typeof import("./throttle").callerAddress;
let tooMany: typeof import("./throttle").tooMany;

before(async () => {
  ({ callerAddress, tooMany } = await import("./throttle"));
});

const from = (forwarded?: string) =>
  new Request("http://x.test/", forwarded === undefined ? {} : { headers: { "x-forwarded-for": forwarded } });

test("the first value of the list is the caller, an IPv4 address kept whole", () => {
  assert.equal(callerAddress(from("203.0.113.7, 10.0.0.1")), "203.0.113.7");
});

test("two addresses in one /64 give one key, another /64 gives another", () => {
  const a = callerAddress(from("2001:db8:1:2::1"));
  assert.equal(callerAddress(from("2001:db8:1:2:aaaa:bbbb:cccc:dddd")), a);
  assert.notEqual(callerAddress(from("2001:db8:1:3::1")), a);
});

test("a missing header and a value that is no address give unknown", () => {
  assert.equal(callerAddress(from()), "unknown");
  assert.equal(callerAddress(from("not-an-ip")), "unknown");
  assert.equal(callerAddress(from("999.1.1.1")), "unknown");
  assert.equal(callerAddress(from("")), "unknown");
});

test("the refusal is a 429 with the wait, the route's CORS and no caching", async () => {
  const response = tooMany(42, { "Access-Control-Allow-Origin": "*" });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "42");
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("access-control-expose-headers"), "Retry-After");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { error: "too_many_requests" });
});
