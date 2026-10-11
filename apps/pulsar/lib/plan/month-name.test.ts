import assert from "node:assert/strict";
import test from "node:test";

import { monthName } from "./month-name";

test("monthName: this year's month is bare, another year's carries its year", () => {
  assert.equal(monthName("2026-12-01", "2026"), "diciembre");
  assert.equal(monthName("2027-12-01", "2026"), "diciembre de 2027");
  assert.equal(monthName("2025-03", "2026"), "marzo de 2025");
});
