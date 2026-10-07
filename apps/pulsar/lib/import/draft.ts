import { z } from "zod";

import { dayBefore } from "@/lib/day/weeks";
import { monthsOfSpan } from "@/lib/plan/months";
import { addCommitmentSchema, addPhaseSchema, createGoalSchema, phaseWithinHorizon, phasesOverlap } from "@/lib/validation/plan";
import { setMonthBudgetSchema } from "@/lib/validation/budget";
import { createOneOffSchema, noteSchema } from "@/lib/validation/one-off";

// The forms' own schemas judge what the import carries; the model's answer
// and the template are shaped around them, never a second set of rules.
const PLACEHOLDER_GOAL_ID = "00000000-0000-4000-8000-000000000000";

type Issue = { path: PropertyKey[]; message: string };

// Hands `value` to a form schema that wants a `goalId` the import has not got
// yet, and re-raises its issues here under their own keys.
function delegate<T>(
  form: z.ZodType,
  build: (value: T) => unknown,
): (value: T, ctx: z.core.$RefinementCtx<T>) => void {
  return (value, ctx) => {
    const parsed = form.safeParse(build(value));
    if (parsed.success) return;
    for (const issue of parsed.error.issues as Issue[]) {
      ctx.addIssue({ code: "custom", message: issue.message, path: issue.path.filter((p) => p !== "goalId") });
    }
  };
}

const unit = z
  .string({ error: "plan.errors.unitEmpty" })
  .trim()
  .min(1, { error: "plan.errors.unitEmpty" })
  .max(40, { error: "plan.errors.unitTooLong" });

const measure = z.strictObject({ name: createGoalSchema.shape.name, unit });

const phase = z
  .strictObject({
    aim: addPhaseSchema.shape.aim,
    startsOn: addPhaseSchema.shape.startsOn,
    endsOn: addPhaseSchema.shape.endsOn,
  })
  .superRefine(delegate(addPhaseSchema, (value) => ({ ...value, goalId: PLACEHOLDER_GOAL_ID })));

const month = z.strictObject({
  month: setMonthBudgetSchema.shape.month,
  // Minutes when the goal's unit is time (RP-35).
  amount: setMonthBudgetSchema.shape.amount,
});

// A model knows no evidence source: a commitment is a tap or a quantity.
// Absent parts are null rather than missing, so a strict model schema can
// name every field.
const commitment = z
  .strictObject({
    name: createGoalSchema.shape.name,
    cadenceKind: z.enum(["daily", "weekdays", "times_per_week", "every_n_days", "times_per_month"]),
    cadenceWeekdays: z.array(z.number().int()).nullable(),
    cadenceN: z.number().int().nullable(),
    satisfaction: z.enum(["tap", "quantity"]),
    targetQuantity: z.number().int().nullable(),
    unit: z.string().nullable(),
  })
  .superRefine(
    delegate(addCommitmentSchema, (value) => {
      const present = Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null));
      return { ...present, goalId: PLACEHOLDER_GOAL_ID };
    }),
  );

const estimate = createOneOffSchema.shape.estimate.nonoptional();

// The note is the template's alone (RP-45): the model is sent the draft
// without it, and a draft that carries none reads as it always did.
function draftSchema(withNote: boolean) {
  // Typed as present either way: the types are the template's, the model's schema just leaves the key out.
  const note = (withNote ? { note: noteSchema.optional() } : {}) as { note: ReturnType<typeof noteSchema.optional> };
  const task = z.strictObject({
    name: createOneOffSchema.shape.name,
    month: setMonthBudgetSchema.shape.month,
    estimate,
    ...note,
    children: z.array(z.strictObject({ name: createOneOffSchema.shape.name, estimate, ...note })),
  });

  const goal = z.strictObject({
    name: createGoalSchema.shape.name,
    horizon: createGoalSchema.shape.horizon,
    measure: measure.nullable(),
    phases: z.array(phase),
    months: z.array(month),
    commitments: z.array(commitment),
    tasks: z.array(task),
  });

  return z.strictObject({
    goals: z
      .array(goal)
      .min(1, { error: "import.errors.empty" })
      .max(12, { error: "import.errors.draftInvalid" }),
  });
}

export const importDraftSchema = draftSchema(true);

export type ImportDraft = z.infer<typeof importDraftSchema>;

// What 151 hands the model as its response format.
export const importDraftJsonSchema = z.toJSONSchema(draftSchema(false));

export type DraftRefusal = { path: string; key: string; values?: Record<string, string> };

// What the draft holds that cannot be written, and why. Pure: the schema
// above says what is well-formed, this says what the goal's own span refuses.
export function draftRefusals(draft: ImportDraft, today: string): DraftRefusal[] {
  const refusals: DraftRefusal[] = [];
  draft.goals.forEach((goal, g) => {
    const at = `goals.${g}`;
    const refuse = (path: string, key: string, values?: Record<string, string>) =>
      refusals.push({ path: `${at}.${path}`, key, ...(values ? { values } : {}) });

    const past = goal.horizon <= today;
    if (past) refuse("horizon", "import.errors.horizonPast");

    goal.phases.forEach((phase, p) => {
      if (!phaseWithinHorizon(phase, goal.horizon)) refuse(`phases.${p}`, "plan.errors.phasePastHorizon");
      else if (goal.phases.slice(0, p).some((earlier) => phasesOverlap(earlier, phase))) {
        refuse(`phases.${p}`, "plan.errors.phaseOverlap");
      }
    });

    // A goal whose end already passed has no span: it is refused whole.
    const span = past ? null : new Set(monthsOfSpan(today, goal.horizon));
    const lastDay = dayBefore(goal.horizon);
    // Which side of the span a month falls on: before today's month or after the goal's last.
    const outsideSpan = (path: string, m: string) => {
      if (span === null || span.has(`${m}-01`)) return;
      if (m < today.slice(0, 7)) refuse(path, "import.errors.monthBeforeStart", { first: today.slice(0, 7) });
      else refuse(path, "import.errors.monthAfterEnd", { last: lastDay });
    };

    const seen = new Set<string>();
    goal.months.forEach((entry, m) => {
      outsideSpan(`months.${m}`, entry.month);
      if (seen.has(entry.month)) refuse(`months.${m}`, "import.errors.duplicateMonth");
      seen.add(entry.month);
      if (goal.measure === null) refuse(`months.${m}`, "import.errors.amountNoMeasure");
    });

    // A quantity counts in the goal's unit: with no measure there is none.
    goal.commitments.forEach((commitment, c) => {
      if (commitment.satisfaction === "quantity" && goal.measure === null) {
        refuse(`commitments.${c}`, "import.errors.quantityNoMeasure");
      }
      // A tap counts nothing: the table refuses a target or a unit on one.
      if (commitment.satisfaction === "tap" && (commitment.targetQuantity !== null || commitment.unit !== null)) {
        refuse(`commitments.${c}`, "import.errors.tapWithAmount");
      }
    });

    goal.tasks.forEach((task, t) => {
      outsideSpan(`tasks.${t}`, task.month);
      // A parent is measured by its sub-tasks; the policy refuses one with an estimate.
      if (task.children.length > 0 && task.estimate !== null) refuse(`tasks.${t}`, "import.errors.parentWithAmount");
      if (goal.measure === null) {
        if (task.estimate !== null) refuse(`tasks.${t}`, "month.errors.noMeasure");
        task.children.forEach((child, c) => {
          if (child.estimate !== null) refuse(`tasks.${t}.children.${c}`, "month.errors.noMeasure");
        });
      }
    });
  });
  return refusals;
}

// The estimates a goal with no measure cannot keep: a task's or a sub-task's.
export function strayEstimates(draft: ImportDraft): DraftRefusal[] {
  const stray: DraftRefusal[] = [];
  const key = "import.notices.estimateDropped";
  draft.goals.forEach((goal, g) => {
    if (goal.measure !== null) return;
    goal.tasks.forEach((task, t) => {
      if (task.estimate !== null) stray.push({ path: `goals.${g}.tasks.${t}`, key });
      task.children.forEach((child, c) => {
        if (child.estimate !== null) stray.push({ path: `goals.${g}.tasks.${t}.children.${c}`, key });
      });
    });
  });
  return stray;
}

// The draft with those estimates nulled and nothing else changed: the task stays.
export function withoutStrayEstimates(draft: ImportDraft): ImportDraft {
  return {
    goals: draft.goals.map((goal) =>
      goal.measure !== null
        ? goal
        : {
            ...goal,
            tasks: goal.tasks.map((task) => ({
              ...task,
              estimate: null,
              children: task.children.map((child) => ({ ...child, estimate: null })),
            })),
          },
    ),
  };
}

// The phases that start before the goal opens (the day it is imported): each
// begins that day instead. One that ends before it is dropped, see `phaseDrops`.
export function phaseCuts(draft: ImportDraft, today: string): { path: string; aim: string; from: string }[] {
  const cuts: { path: string; aim: string; from: string }[] = [];
  draft.goals.forEach((goal, g) => {
    goal.phases.forEach((phase, p) => {
      if (phase.startsOn < today && phase.endsOn >= today) cuts.push({ path: `goals.${g}.phases.${p}`, aim: phase.aim, from: today });
    });
  });
  return cuts;
}

// The phases wholly before the day the goal opens: nothing is left of them to keep.
export function phaseDrops(draft: ImportDraft, today: string): { path: string; aim: string }[] {
  const drops: { path: string; aim: string }[] = [];
  draft.goals.forEach((goal, g) => {
    goal.phases.forEach((phase, p) => {
      if (phase.endsOn < today) drops.push({ path: `goals.${g}.phases.${p}`, aim: phase.aim });
    });
  });
  return drops;
}

// The draft with the cut phases starting `today` and the dropped ones gone; nothing else changes.
export function withCutPhases(draft: ImportDraft, today: string): ImportDraft {
  return {
    goals: draft.goals.map((goal) => ({
      ...goal,
      phases: goal.phases
        .filter((phase) => phase.endsOn >= today)
        .map((phase) => (phase.startsOn < today ? { ...phase, startsOn: today } : phase)),
    })),
  };
}
