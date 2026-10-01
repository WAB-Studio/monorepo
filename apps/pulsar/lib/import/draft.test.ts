import assert from "node:assert/strict";
import test from "node:test";

import { draftRefusals, importDraftJsonSchema, importDraftSchema, type ImportDraft } from "./draft";

const TODAY = "2026-10-15";

function goal(over: Partial<ImportDraft["goals"][number]> = {}): ImportDraft["goals"][number] {
  return {
    name: "IA aplicada",
    horizon: "2027-10-01",
    measure: { name: "horas de estudio", unit: "minutos" },
    phases: [{ aim: "Evals", startsOn: "2026-10-01", endsOn: "2026-12-31" }],
    months: [{ month: "2026-10", amount: 720 }],
    commitments: [
      { name: "Inglés", cadenceKind: "daily", cadenceWeekdays: null, cadenceN: null, satisfaction: "tap", targetQuantity: null, unit: null },
    ],
    tasks: [{ name: "Leer", month: "2026-10", estimate: 240, children: [{ name: "Cap. 1", estimate: 60 }] }],
    ...over,
  };
}

const draft = (...goals: ImportDraft["goals"]): ImportDraft => ({ goals });

function errorsOf(input: unknown): string[] {
  const parsed = importDraftSchema.safeParse(input);
  return parsed.success ? [] : parsed.error.issues.map((i) => i.message);
}

test("importDraftSchema: a whole draft passes", () => {
  assert.deepEqual(errorsOf(draft(goal())), []);
});

test("importDraftSchema: 0 goals and 13 goals are refused, 12 pass", () => {
  assert.deepEqual(errorsOf(draft()), ["import.errors.empty"]);
  assert.deepEqual(errorsOf(draft(...Array.from({ length: 13 }, () => goal()))), ["import.errors.draftInvalid"]);
  assert.deepEqual(errorsOf(draft(...Array.from({ length: 12 }, () => goal()))), []);
});

test("importDraftSchema: an unknown key is refused at the top, in a goal and in a child", () => {
  assert.notDeepEqual(errorsOf({ ...draft(goal()), extra: 1 }), []);
  assert.notDeepEqual(errorsOf(draft({ ...goal(), extra: 1 } as never)), []);
  const nested = goal({ tasks: [{ name: "Leer", month: "2026-10", estimate: null, children: [{ name: "a", estimate: null, extra: 1 } as never] }] });
  assert.notDeepEqual(errorsOf(draft(nested)), []);
});

test("importDraftSchema: each field answers with its form's own key", () => {
  assert.deepEqual(errorsOf(draft(goal({ name: "  " }))), ["plan.errors.nameEmpty"]);
  assert.deepEqual(errorsOf(draft(goal({ horizon: "2027-02-31" }))), ["plan.errors.horizonInvalid"]);
  assert.deepEqual(errorsOf(draft(goal({ months: [{ month: "2026-13", amount: 1 }] }))), ["month.errors.monthInvalid"]);
  assert.deepEqual(errorsOf(draft(goal({ months: [{ month: "2026-10", amount: -1 }] }))), ["month.errors.amountInvalid"]);
  assert.deepEqual(errorsOf(draft(goal({ months: [{ month: "2026-10", amount: 1_000_001 }] }))), ["month.errors.amountInvalid"]);
  assert.deepEqual(
    errorsOf(draft(goal({ tasks: [{ name: "x", month: "2026-10", estimate: 0, children: [] }] }))),
    ["month.errors.estimateInvalid"],
  );
  assert.deepEqual(
    errorsOf(draft(goal({ phases: [{ aim: "x", startsOn: "2026-12-31", endsOn: "2026-10-01" }] }))),
    ["plan.errors.phaseBackwards"],
  );
});

test("importDraftSchema: a commitment answers as the commitment form does", () => {
  const base = { name: "x", cadenceKind: "daily" as const, cadenceWeekdays: null, cadenceN: null, satisfaction: "tap" as const, targetQuantity: null, unit: null };
  const only = (c: object) => errorsOf(draft(goal({ commitments: [{ ...base, ...c }] })));
  assert.deepEqual(only({ cadenceKind: "times_per_week", cadenceN: 8 }), ["plan.errors.timesPerWeekInvalid"]);
  assert.deepEqual(only({ cadenceKind: "weekdays", cadenceWeekdays: [] }), ["plan.errors.weekdaysEmpty"]);
  assert.deepEqual(only({ satisfaction: "quantity", targetQuantity: 120, unit: "min" }), []);
  assert.deepEqual(only({ satisfaction: "evidence" }).length > 0, true);
});

test("importDraftJsonSchema: closes every object and names the goals", () => {
  const json = JSON.stringify(importDraftJsonSchema);
  assert.equal((importDraftJsonSchema as { properties: Record<string, unknown> }).properties.goals !== undefined, true);
  assert.equal(json.includes('"additionalProperties":false'), true);
});

test("draftRefusals: a clean draft refuses nothing", () => {
  assert.deepEqual(draftRefusals(draft(goal()), TODAY), []);
});

test("draftRefusals: a horizon on or before today, and the goal's months are not also refused", () => {
  assert.deepEqual(draftRefusals(draft(goal({ horizon: TODAY, phases: [] })), TODAY), [
    { path: "goals.0.horizon", key: "import.errors.horizonPast" },
  ]);
  const past = draftRefusals(draft(goal({ horizon: "2026-01-01" })), TODAY);
  assert.deepEqual(past.map((r) => r.key), ["import.errors.horizonPast", "plan.errors.phasePastHorizon"]);
  assert.deepEqual(draftRefusals(draft(goal({ horizon: "2026-10-16" })), TODAY).map((r) => r.key), ["plan.errors.phasePastHorizon"]);
});

test("draftRefusals: a phase past the horizon", () => {
  const g = goal({ horizon: "2027-01-01", phases: [{ aim: "x", startsOn: "2026-12-01", endsOn: "2027-01-02" }] });
  assert.deepEqual(draftRefusals(draft(g), TODAY), [{ path: "goals.0.phases.0", key: "plan.errors.phasePastHorizon" }]);
  const edge = goal({ horizon: "2027-01-01", phases: [{ aim: "x", startsOn: "2026-12-01", endsOn: "2027-01-01" }] });
  assert.deepEqual(draftRefusals(draft(edge), TODAY), []);
});

test("draftRefusals: two phases sharing a day", () => {
  const g = goal({
    phases: [
      { aim: "a", startsOn: "2026-10-01", endsOn: "2026-11-30" },
      { aim: "b", startsOn: "2026-11-30", endsOn: "2026-12-31" },
    ],
  });
  assert.deepEqual(draftRefusals(draft(g), TODAY), [{ path: "goals.0.phases.1", key: "plan.errors.phaseOverlap" }]);
});

test("draftRefusals: a month or a task outside the span from today's month to the horizon's last day", () => {
  const g = goal({
    horizon: "2027-01-01",
    months: [
      { month: "2026-09", amount: 1 },
      { month: "2026-10", amount: 1 },
      { month: "2026-12", amount: 1 },
      { month: "2027-01", amount: 1 },
    ],
    tasks: [
      { name: "a", month: "2027-01", estimate: null, children: [] },
      { name: "b", month: "2026-12", estimate: null, children: [] },
    ],
    phases: [],
  });
  assert.deepEqual(draftRefusals(draft(g), TODAY), [
    { path: "goals.0.months.0", key: "month.errors.outsideSpan" },
    { path: "goals.0.months.3", key: "month.errors.outsideSpan" },
    { path: "goals.0.tasks.0", key: "month.errors.outsideSpan" },
  ]);
});

test("draftRefusals: an amount or an estimate on a goal with no measure", () => {
  const g = goal({
    measure: null,
    months: [{ month: "2026-10", amount: 5 }],
    tasks: [
      { name: "a", month: "2026-10", estimate: 5, children: [{ name: "c", estimate: 1 }, { name: "d", estimate: null }] },
      { name: "b", month: "2026-10", estimate: null, children: [] },
    ],
  });
  assert.deepEqual(draftRefusals(draft(g), TODAY), [
    { path: "goals.0.months.0", key: "month.errors.noMeasure" },
    { path: "goals.0.tasks.0", key: "month.errors.noMeasure" },
    { path: "goals.0.tasks.0.children.0", key: "month.errors.noMeasure" },
  ]);
});

test("draftRefusals: two amounts for one month name the second", () => {
  const g = goal({ months: [{ month: "2026-10", amount: 1 }, { month: "2026-11", amount: 1 }, { month: "2026-10", amount: 2 }] });
  assert.deepEqual(draftRefusals(draft(g), TODAY), [{ path: "goals.0.months.2", key: "import.errors.duplicateMonth" }]);
});

test("draftRefusals: each goal is judged on its own and paths name it", () => {
  const refusals = draftRefusals(draft(goal(), goal({ horizon: "2026-10-01" })), TODAY);
  assert.equal(refusals.every((r) => r.path.startsWith("goals.1.")), true);
  assert.equal(refusals.length > 0, true);
});
