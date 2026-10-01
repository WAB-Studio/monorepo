import assert from "node:assert/strict";
import test from "node:test";

import type { ShiftPlan } from "./shift";
import { shiftRows } from "./shift-rows";

const plan: ShiftPlan = {
  budgets: [
    { month: "2026-12-01", to: "2027-01-01", amount: 20 },
    { month: "2027-09-01", to: "2027-10-01", amount: 30 },
  ],
  phases: [
    {
      id: "p",
      aim: "Observabilidad",
      startsOn: "2027-01-04",
      endsOn: "2027-03-28",
      toStartsOn: "2027-02-04",
      toEndsOn: "2027-04-28",
    },
  ],
  tasks: [
    { id: "a", name: "a", from: "2027-01-01", to: "2027-02-01" },
    { id: "b", name: "b", from: "2026-12-01", to: "2027-01-01" },
  ],
  horizon: { from: "2027-10-01", to: "2027-11-01" },
  emptied: "2026-12-01",
};

test("the amounts are one grouped row, short month names", () => {
  assert.deepEqual(shiftRows(plan).budgets, { from: "dic", to: "sep", next: "ene" });
});

test("tasks count and name the earliest month they move from", () => {
  assert.deepEqual(shiftRows(plan).tasks, { count: 2, month: "dic" });
});

test("a phase reads as its month span before and after", () => {
  assert.deepEqual(shiftRows(plan).phases, [{ name: "Observabilidad", from: "ene–mar", to: "feb–abr" }]);
});

test("the end names the last day, not the exclusive horizon", () => {
  assert.deepEqual(shiftRows(plan).end, { from: "30 sep", to: "31 oct 2027" });
});

test("nothing to move leaves no row, and the emptied month opens a sentence", () => {
  const rows = shiftRows({ ...plan, budgets: [], phases: [], tasks: [], horizon: null });
  assert.equal(rows.budgets, null);
  assert.equal(rows.tasks, null);
  assert.deepEqual(rows.phases, []);
  assert.equal(rows.end, null);
  assert.equal(rows.emptied, "Diciembre");
});
