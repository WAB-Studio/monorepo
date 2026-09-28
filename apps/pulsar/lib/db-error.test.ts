import assert from "node:assert/strict";
import test from "node:test";

import { pgCode } from "./db-error";

// The shape `DrizzleQueryError` actually throws (`errors.js`'s own
// constructor): the driver's `PostgresError` — the only object that ever
// carries `.code` — sits on `.cause`, not on the thrown error itself.
function wrappedError(code: string): unknown {
  return { message: "Failed query", cause: { code, message: "duplicate key value" } };
}

test("pgCode reads the SQLSTATE off a DrizzleQueryError's own .cause", () => {
  assert.equal(pgCode(wrappedError("23505")), "23505");
});

test("pgCode reads a bare error that already carries .code, no .cause to walk", () => {
  assert.equal(pgCode({ code: "22003" }), "22003");
});

test("pgCode returns undefined for an error with neither .code nor .cause", () => {
  assert.equal(pgCode(new Error("plain")), undefined);
});

test("pgCode returns undefined for a non-object, a string thrown as an error", () => {
  assert.equal(pgCode("not an error object"), undefined);
});

test("pgCode returns undefined for null", () => {
  assert.equal(pgCode(null), undefined);
});

// The bug module 38's round 2 found: `declareFact` used to check
// `error.code === "22003"` directly, which is `undefined` behind a wrapped
// error and never fires. Encodes both halves in one test so a regression to
// the old shape turns this red again, not just the tests above.
test("a bare .code check misses a wrapped 22003 the way declareFact used to; pgCode does not", () => {
  const wrapped = wrappedError("22003");
  const oldCheck =
    typeof wrapped === "object" &&
    wrapped !== null &&
    "code" in wrapped &&
    (wrapped as { code?: unknown }).code === "22003";

  assert.equal(oldCheck, false);
  assert.equal(pgCode(wrapped), "22003");
});

// Module 37: `app/actions/plan.ts`'s own `addCommitment` carried the exact
// same bug — a private `isNumericRangeError` reading `error.code` bare —
// moved onto `pgCode` the same way `declareFact` was. Not proved by
// importing `plan.ts` itself: it is `"use server"` and its top-level imports
// reach `lib/session.ts`, which needs a live `DATABASE_URL` `check:unit`
// never sets. The fix is the identical one-line change, so this is the same
// red/green as the test above, named for its own caller.
test("addCommitment's own 22003 catch reads pgCode, not the bare .code that left it unreachable", () => {
  const wrapped = wrappedError("22003");
  const bareCheck =
    typeof wrapped === "object" &&
    wrapped !== null &&
    "code" in wrapped &&
    (wrapped as { code?: unknown }).code === "22003";

  assert.equal(bareCheck, false);
  assert.equal(pgCode(wrapped), "22003");
});
