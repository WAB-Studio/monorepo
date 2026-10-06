import assert from "node:assert/strict";
import test from "node:test";

import type { Task } from "./carry";
import { shiftPlan } from "./shift";
import { shiftOfferNow } from "./shift-offer";

const OCT = "2026-10-01";
const HORIZON = "2027-10-01";

function task(id: string, patch: Partial<Task> = {}): Task {
  return {
    id,
    parentId: null,
    name: id,
    plannedMonth: OCT,
    day: null,
    estimate: 60,
    doneOn: null,
    ...patch,
  };
}

// Seven hours planned in October; `undone` of them left undone.
function october(undone: number): Task[] {
  return Array.from({ length: 7 }, (_, i) =>
    task(`t${i}`, i < undone ? {} : { doneOn: "2026-10-10" }),
  );
}

const budgets = [
  { month: "2026-11-01", amount: 40 },
  { month: "2026-12-01", amount: 41 },
];
const phases = [
  { id: "begun", name: "Fundamentos", startsOn: "2026-10-01", endsOn: "2026-12-31" },
  { id: "next", name: "Proyecto", startsOn: "2027-01-01", endsOn: "2027-03-31" },
  { id: "open", name: "Abierta", startsOn: "2027-04-01", endsOn: null },
];

function offer(patch: Partial<Parameters<typeof shiftOfferNow>[0]> = {}) {
  return shiftOfferNow({
    today: "2026-11-13",
    horizon: HORIZON,
    budgets,
    phases,
    tasks: october(5),
    shifts: [],
    ...patch,
  });
}

test("offers the closed month, its share and the last day it can be taken", () => {
  const result = offer();
  assert.ok(result);
  assert.equal(result.closedMonth, OCT);
  assert.deepEqual(result.share, { carried: 300, planned: 420 });
  assert.equal(result.until, "2026-11-30");
  assert.deepEqual(
    result.plan,
    shiftPlan({
      closedMonth: OCT,
      today: "2026-11-13",
      horizon: HORIZON,
      budgets,
      phases: [
        { id: "begun", aim: "Fundamentos", startsOn: "2026-10-01", endsOn: "2026-12-31" },
        { id: "next", aim: "Proyecto", startsOn: "2027-01-01", endsOn: "2027-03-31" },
      ],
      tasks: october(5),
    }),
  );
});

test("exactly half is not offered", () => {
  assert.equal(
    offer({ tasks: [task("a", { estimate: 60 }), task("b", { estimate: 60, doneOn: "2026-10-02" })] }),
    null,
  );
});

test("a month already shifted is not offered", () => {
  assert.equal(offer({ shifts: [OCT] }), null);
});

test("a month with nothing planned is not offered", () => {
  assert.equal(offer({ tasks: [] }), null);
});

test("the offer is for the month right before today's, never two back", () => {
  const result = offer({ today: "2026-12-01" });
  assert.ok(result);
  assert.equal(result.closedMonth, "2026-11-01");
});

test("a month fully done at the next month is not offered", () => {
  const done = Array.from({ length: 7 }, (_, i) => task(`t${i}`, { doneOn: "2026-11-20" }));
  assert.equal(offer({ today: "2026-12-01", tasks: done }), null);
});

test("a phase with no end is left out of the plan", () => {
  const result = offer();
  assert.ok(result);
  assert.deepEqual(
    result.plan.phases.map((phase) => phase.id),
    ["next"],
  );
});
