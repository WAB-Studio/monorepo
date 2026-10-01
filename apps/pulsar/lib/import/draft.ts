import { z } from "zod";

import { monthsOfSpan } from "@/lib/plan/months";
import { addCommitmentSchema, addPhaseSchema, createGoalSchema, phaseWithinHorizon, phasesOverlap } from "@/lib/validation/plan";
import { setMonthBudgetSchema } from "@/lib/validation/budget";
import { createOneOffSchema } from "@/lib/validation/one-off";

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

const task = z.strictObject({
  name: createOneOffSchema.shape.name,
  month: setMonthBudgetSchema.shape.month,
  estimate,
  children: z.array(z.strictObject({ name: createOneOffSchema.shape.name, estimate })),
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

export const importDraftSchema = z.strictObject({
  goals: z
    .array(goal)
    .min(1, { error: "import.errors.empty" })
    .max(12, { error: "import.errors.draftInvalid" }),
});

export type ImportDraft = z.infer<typeof importDraftSchema>;

// What 151 hands the model as its response format.
export const importDraftJsonSchema = z.toJSONSchema(importDraftSchema);

export type DraftRefusal = { path: string; key: string };

// What the draft holds that cannot be written, and why. Pure: the schema
// above says what is well-formed, this says what the goal's own span refuses.
export function draftRefusals(draft: ImportDraft, today: string): DraftRefusal[] {
  const refusals: DraftRefusal[] = [];
  draft.goals.forEach((goal, g) => {
    const at = `goals.${g}`;
    const refuse = (path: string, key: string) => refusals.push({ path: `${at}.${path}`, key });

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
    const outside = (m: string) => span !== null && !span.has(`${m}-01`);

    const seen = new Set<string>();
    goal.months.forEach((entry, m) => {
      if (outside(entry.month)) refuse(`months.${m}`, "month.errors.outsideSpan");
      if (seen.has(entry.month)) refuse(`months.${m}`, "import.errors.duplicateMonth");
      seen.add(entry.month);
      if (goal.measure === null) refuse(`months.${m}`, "month.errors.noMeasure");
    });

    goal.tasks.forEach((task, t) => {
      if (outside(task.month)) refuse(`tasks.${t}`, "month.errors.outsideSpan");
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
