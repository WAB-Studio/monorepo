import assert from "node:assert/strict";
import test from "node:test";

import { readFileSync } from "node:fs";
import { parseTemplate } from "./template";
import { draftRefusals, importDraftJsonSchema, importDraftSchema, strayEstimates, withoutStrayEstimates, type ImportDraft } from "./draft";

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
    tasks: [{ name: "Leer", month: "2026-10", estimate: null, children: [{ name: "Cap. 1", estimate: 60 }] }],
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
    { path: "goals.0.months.0", key: "import.errors.monthBeforeStart", values: { first: "2026-10" } },
    { path: "goals.0.months.3", key: "import.errors.monthAfterEnd", values: { last: "2026-12-31" } },
    { path: "goals.0.tasks.0", key: "import.errors.monthAfterEnd", values: { last: "2026-12-31" } },
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
    { path: "goals.0.months.0", key: "import.errors.amountNoMeasure" },
    { path: "goals.0.tasks.0", key: "import.errors.parentWithAmount" },
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

const exampleDraft = (): ImportDraft => {
  const example = JSON.parse(readFileSync(new URL("../../messages/es/import.json", import.meta.url), "utf8")).template.example;
  const result = parseTemplate(example);
  assert.ok(result.matched && "draft" in result);
  return result.draft;
};

test("draftRefusals: the catalogue's example, a month after October, refuses October's month and both its tasks", () => {
  assert.deepEqual(draftRefusals(exampleDraft(), "2026-11-15"), [
    { path: "goals.0.months.0", key: "import.errors.monthBeforeStart", values: { first: "2026-11" } },
    { path: "goals.0.tasks.0", key: "import.errors.monthBeforeStart", values: { first: "2026-11" } },
    { path: "goals.0.tasks.1", key: "import.errors.monthBeforeStart", values: { first: "2026-11" } },
  ]);
});

test("draftRefusals: the catalogue's example, the day before October ends, refuses nothing", () => {
  assert.deepEqual(draftRefusals(exampleDraft(), "2026-09-30"), []);
});

test("importDraftSchema: a measure unit of 41 characters and an empty one are refused", () => {
  const withUnit = (unit: string) => errorsOf(draft(goal({ measure: { name: "horas", unit } })));
  assert.deepEqual(withUnit("x".repeat(41)), ["plan.errors.unitTooLong"]);
  assert.deepEqual(withUnit("x".repeat(40)), []);
  assert.deepEqual(withUnit("  "), ["plan.errors.unitEmpty"]);
});

test("importDraftSchema: an unknown key inside a measure is refused", () => {
  assert.notDeepEqual(errorsOf(draft(goal({ measure: { name: "horas", unit: "min", extra: 1 } as never }))), []);
});

test("importDraftSchema: issues of a nested phase and commitment carry no goalId segment", () => {
  const paths = (g: ImportDraft["goals"][number]) => {
    const parsed = importDraftSchema.safeParse(draft(g));
    return parsed.success ? [] : parsed.error.issues.map((i) => i.path);
  };
  assert.deepEqual(paths(goal({ phases: [{ aim: "x", startsOn: "2026-12-31", endsOn: "2026-10-01" }] })), [
    ["goals", 0, "phases", 0, "endsOn"],
  ]);
  const bad = { name: "x", cadenceKind: "times_per_week" as const, cadenceWeekdays: null, cadenceN: 8, satisfaction: "tap" as const, targetQuantity: null, unit: null };
  assert.deepEqual(paths(goal({ commitments: [bad] })), [["goals", 0, "commitments", 0, "cadenceN"]]);
});

test("draftRefusals: a phase that overlaps and also passes the horizon reports only the horizon", () => {
  const g = goal({
    horizon: "2027-01-01",
    phases: [
      { aim: "a", startsOn: "2026-10-01", endsOn: "2026-12-01" },
      { aim: "b", startsOn: "2026-11-01", endsOn: "2027-02-01" },
    ],
  });
  assert.deepEqual(draftRefusals(draft(g), TODAY), [{ path: "goals.0.phases.1", key: "plan.errors.phasePastHorizon" }]);
});

test("draftRefusals: a quantity commitment on a goal with no measure, and a tap, which needs none", () => {
  const quantity = { name: "q", cadenceKind: "daily" as const, cadenceWeekdays: null, cadenceN: null, satisfaction: "quantity" as const, targetQuantity: 5, unit: "min" };
  const tap = { ...quantity, name: "t", satisfaction: "tap" as const, targetQuantity: null, unit: null };
  assert.deepEqual(draftRefusals(draft(goal({ measure: null, months: [], tasks: [], commitments: [tap, quantity] })), TODAY), [
    { path: "goals.0.commitments.1", key: "import.errors.quantityNoMeasure" },
  ]);
  assert.deepEqual(draftRefusals(draft(goal({ commitments: [quantity] })), TODAY), []);
});

test("draftRefusals: a task with sub-tasks and an estimate of its own, at the parent", () => {
  const g = goal({ tasks: [{ name: "Leer", month: "2026-10", estimate: 240, children: [{ name: "Cap. 1", estimate: 60 }] }] });
  assert.deepEqual(draftRefusals(draft(g), TODAY), [{ path: "goals.0.tasks.0", key: "import.errors.parentWithAmount" }]);
  const clean = goal({ tasks: [{ name: "Leer", month: "2026-10", estimate: null, children: [{ name: "Cap. 1", estimate: 60 }] }] });
  assert.deepEqual(draftRefusals(draft(clean), TODAY), []);
});

test("draftRefusals: a tap commitment carrying a target or a unit, at the commitment", () => {
  const tap = { name: "Inglés", cadenceKind: "daily", cadenceWeekdays: null, cadenceN: null, satisfaction: "tap" } as const;
  const withTarget = goal({ commitments: [{ ...tap, targetQuantity: 5, unit: null }] });
  const withUnit = goal({ commitments: [{ ...tap, targetQuantity: null, unit: "minutos" }] });
  for (const g of [withTarget, withUnit]) {
    assert.deepEqual(draftRefusals(draft(g), TODAY), [{ path: "goals.0.commitments.0", key: "import.errors.tapWithAmount" }]);
  }
});

test("draftRefusals: a goal ending 2027-03-31 names the months after it with its last day", () => {
  const g = goal({ horizon: "2027-04-01", phases: [], months: [{ month: "2027-04", amount: 1 }, { month: "2027-05", amount: 1 }], tasks: [] });
  assert.deepEqual(draftRefusals(draft(g), TODAY), [
    { path: "goals.0.months.0", key: "import.errors.monthAfterEnd", values: { last: "2027-03-31" } },
    { path: "goals.0.months.1", key: "import.errors.monthAfterEnd", values: { last: "2027-03-31" } },
  ]);
});

const unmeasured = () =>
  goal({
    measure: null,
    months: [],
    commitments: [],
    tasks: [
      { name: "a", month: "2026-10", estimate: 120, children: [{ name: "c", estimate: 60 }] },
      { name: "b", month: "2026-10", estimate: null, children: [] },
    ],
  });

test("strayEstimates and withoutStrayEstimates: only the estimates go, the tasks stay", () => {
  const raw = draft(unmeasured());
  const key = "import.notices.estimateDropped";
  assert.deepEqual(strayEstimates(raw), [
    { path: "goals.0.tasks.0", key },
    { path: "goals.0.tasks.0.children.0", key },
  ]);
  const kept = withoutStrayEstimates(raw);
  const expected = structuredClone(raw);
  expected.goals[0].tasks[0].estimate = null;
  expected.goals[0].tasks[0].children[0].estimate = null;
  assert.deepEqual(kept, expected);
  assert.deepEqual(strayEstimates(kept), []);
  assert.deepEqual(draftRefusals(kept, TODAY), []);
  assert.deepEqual(
    draftRefusals(raw, TODAY).filter((r) => r.key === "month.errors.noMeasure").map((r) => r.path),
    ["goals.0.tasks.0", "goals.0.tasks.0.children.0"],
  );
});

test("strayEstimates: a goal with a measure drops nothing", () => {
  assert.deepEqual(strayEstimates(draft(goal())), []);
});

test("importDraftSchema: a task and a sub-task take a note judged by the note's own rule; a draft with none still passes", () => {
  const task = { name: "T", month: "2026-10", estimate: null, children: [{ name: "c", estimate: 60 }] };
  const parse = (over: object, child: object = {}) =>
    importDraftSchema.safeParse(draft(goal({ tasks: [{ ...task, ...over, children: [{ ...task.children[0], ...child }] }] })));
  assert.equal(parse({}).success, true);
  const ok = parse({ note: "  hola \n" }, { note: "  " });
  assert.ok(ok.success);
  assert.equal(ok.data.goals[0].tasks[0].note, "hola");
  assert.equal(ok.data.goals[0].tasks[0].children[0].note, null);
  const long = parse({}, { note: "x".repeat(2001) });
  assert.ok(!long.success);
  assert.deepEqual(long.error.issues.map((i) => [i.path.join("."), i.message]), [["goals.0.tasks.0.children.0.note", "day.errors.oneOffNoteTooLong"]]);
});

test("importDraftJsonSchema: holds no note key, so the model proposes none", () => {
  assert.equal(JSON.stringify(importDraftJsonSchema).includes('"note"'), false);
});
