import assert from "node:assert/strict";
import test from "node:test";

import { civilDateShort, timeInZone } from "./zone";

test("an instant at 23:30 Bogotá reads 23:30 whatever the process zone", () => {
  assert.equal(timeInZone("2026-09-29T04:30:00Z"), "23:30");
});

test("04:59 UTC reads the Bogotá hour before midnight", () => {
  assert.equal(timeInZone("2026-09-29T04:59:00Z"), "23:59");
});

test("midnight Bogotá reads 00:00, never 24:00", () => {
  assert.equal(timeInZone("2026-09-29T05:05:00Z"), "00:05");
});

test("a civil day reads as weekday, day and three-letter month whatever the process zone", () => {
  assert.equal(civilDateShort("2026-09-22"), "martes 22 sep");
  assert.equal(civilDateShort("2026-01-01"), "jueves 1 ene");
  assert.equal(civilDateShort("2026-12-31"), "jueves 31 dic");
});
