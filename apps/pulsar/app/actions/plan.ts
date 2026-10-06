"use server";

import { revalidatePath } from "next/cache";

import { and, eq, isNull, max, sql } from "drizzle-orm";

import { commitments, evidenceSources, goals, phases } from "@/db/schema";
import { pgCode } from "@/lib/db-error";
import { getPerson, withGoalsDb } from "@/lib/session";
import { isClosed } from "@/lib/validation/closed";
import { horizonRefusal, moveHorizonSchema, type MoveHorizonInput } from "@/lib/validation/horizon";
import { todayInZone } from "@/lib/zone";
import {
  addCommitmentSchema,
  addPhaseSchema,
  archiveGoalSchema,
  createGoalSchema,
  phasesOverlap,
  phaseWithinHorizon,
  renameGoalSchema,
  reopenGoalSchema,
  retireCommitmentSchema,
  type AddCommitmentInput,
  type AddPhaseInput,
  type ArchiveGoalInput,
  type CreateGoalInput,
  type RenameGoalInput,
  type ReopenGoalInput,
  type RetireCommitmentInput,
} from "@/lib/validation/plan";
import { messageKey, type MessageKey } from "@/i18n/translator";

export type CreateGoalResult = { ok: true; goalId: string } | { ok: false; error: MessageKey };
export type AddPhaseResult = { ok: true; phaseId: string } | { ok: false; error: MessageKey };
export type AddCommitmentResult =
  | { ok: true; commitmentId: string }
  | { ok: false; error: MessageKey };
export type RetireCommitmentResult = { ok: true } | { ok: false; error: MessageKey };
export type RenameGoalResult = { ok: true } | { ok: false; error: MessageKey };
export type ArchiveGoalResult = { ok: true } | { ok: false; error: MessageKey };
export type ReopenGoalResult = { ok: true } | { ok: false; error: MessageKey };
export type MoveHorizonResult = { ok: true } | { ok: false; error: MessageKey };

// Carries a message key out of the transaction without collapsing every
// rejection into the same generic failure.
class NamedError extends Error {}

// Never a bare array parameter — drizzle expands a JS array inside a `sql`
// template into a parenthesised comma list, not a Postgres array literal
// (docs/TRAPS.md, "An array binding is not an array"). Built as an explicit
// `ARRAY[...]::smallint[]` instead, the way `writeCachedAnswer` builds one
// for `text[]`.
function weekdaysArraySql(days: number[]) {
  return sql`ARRAY[${sql.join(
    days.map((day) => sql`${day}`),
    sql`, `,
  )}]::smallint[]`;
}

/**
 * Opens a goal with a name and a horizon alone (§0.3, 3; RP-11). The measure
 * columns are never named in this INSERT, so they land null by the shape of
 * the statement — `goals`' INSERT grant does not even list them. Named
 * columns only (docs/TRAPS.md, "Drizzle's insert builder names every
 * column"): `.insert(goals).values()` would name every column of the table
 * and fill `measure_name`/`measure_unit` with the bare word `default`, which
 * the grant refuses just as surely as a real value.
 */
export async function createGoal(input: CreateGoalInput): Promise<CreateGoalResult> {
  const parsed = createGoalSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: messageKey(parsed.error.issues[0].message) };

  const person = await getPerson();
  if (!person) return { ok: false, error: "plan.errors.signedOut" };

  const { name, horizon } = parsed.data;

  const goalId = await withGoalsDb(async (tx) => {
    const [inserted] = await tx.execute<{ id: string }>(sql`
      insert into ${goals} (user_id, name, horizon)
      values (${person.id}, ${name}, ${horizon})
      returning id
    `);

    return inserted.id;
  });

  revalidatePath("/");
  return { ok: true, goalId };
}

/**
 * Gives a goal a phase (RP-15). The goal is read back before the insert
 * rather than trusted by id: `phases_insert_self` only checks that the new
 * row's own `user_id` is the caller, never that `goal_id` names one of
 * theirs, so a foreign id would otherwise attach silently. The read runs
 * inside the same settled transaction, so `goals_select_self` — not a `where`
 * this function writes — is what actually hides someone else's goal.
 *
 * The very first statement of the transaction is a `pg_advisory_xact_lock`
 * keyed on this goal's own id (never a migration, an extension or a grant —
 * both functions are built in and callable by any role). Without it, two
 * concurrent `addPhase` calls on the same goal each read "no overlap yet"
 * under `READ COMMITTED` and both insert — driven live, two overlapping spans
 * both landed. The lock serialises every call for one goal: the second one
 * blocks until the first commits or rolls back, then re-reads the phases the
 * first one just wrote and is refused if it overlaps. Released automatically
 * at commit or rollback, never held past this function's own return.
 */
export async function addPhase(input: AddPhaseInput): Promise<AddPhaseResult> {
  const parsed = addPhaseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: messageKey(parsed.error.issues[0].message) };

  const person = await getPerson();
  if (!person) return { ok: false, error: "plan.errors.signedOut" };

  const { goalId, aim, startsOn, endsOn } = parsed.data;

  try {
    const phaseId = await withGoalsDb(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${goalId}::text, 0))`);

      const [goal] = await tx
        .select({ id: goals.id, horizon: goals.horizon, archivedAt: goals.archivedAt })
        .from(goals)
        .where(eq(goals.id, goalId));
      // Closed reads as not there: `compromisos/nuevo` answers it with a 404.
      if (!goal || isClosed(goal)) throw new NamedError("plan.errors.goalNotFound");

      // A goal names one horizon; a phase is a span of it, never past it.
      if (!phaseWithinHorizon({ startsOn, endsOn }, goal.horizon)) {
        throw new NamedError("plan.errors.phasePastHorizon");
      }

      // Refused here, not by a CHECK: two spans covering one day would make
      // `phaseOn` (lib/day/derive.ts) guess which one a day belongs to.
      const existing = await tx
        .select({ startsOn: phases.startsOn, endsOn: phases.endsOn })
        .from(phases)
        .where(eq(phases.goalId, goalId));
      if (existing.some((phase) => phasesOverlap({ startsOn, endsOn }, phase))) {
        throw new NamedError("plan.errors.phaseOverlap");
      }

      const [inserted] = await tx.execute<{ id: string }>(sql`
        insert into ${phases} (user_id, goal_id, aim, starts_on, ends_on)
        values (${person.id}, ${goalId}, ${aim}, ${startsOn}, ${endsOn})
        returning id
      `);

      return inserted.id;
    });

    revalidatePath("/");
    return { ok: true, phaseId };
  } catch (error) {
    if (error instanceof NamedError) return { ok: false, error: messageKey(error.message) };
    throw error;
  }
}

/**
 * Gives a goal a commitment (RP-12). Like `addPhase`, the goal is read back
 * before the insert so `goals_select_self` — not this function — refuses a
 * foreign id. `sourceKey` is resolved to `evidence_sources.id` inside this
 * same transaction, never a second round trip a caller could race between.
 *
 * When this is the goal's first `quantity` commitment, the same transaction
 * names the goal's measure after it: `goals`' grant permits
 * `UPDATE (measure_name, measure_unit)` alone, and the `WHERE measure_name IS
 * NULL` is what leaves a later quantity commitment's measure untouched — the
 * row is simply not matched a second time (RP-14).
 */
export async function addCommitment(input: AddCommitmentInput): Promise<AddCommitmentResult> {
  const parsed = addCommitmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: messageKey(parsed.error.issues[0].message) };

  const person = await getPerson();
  if (!person) return { ok: false, error: "plan.errors.signedOut" };

  const data = parsed.data;

  try {
    const commitmentId = await withGoalsDb(async (tx) => {
      const [goal] = await tx
        .select({ id: goals.id, horizon: goals.horizon, archivedAt: goals.archivedAt })
        .from(goals)
        .where(eq(goals.id, data.goalId));
      // Closed reads as not there: `compromisos/nuevo` answers it with a 404.
      if (!goal || isClosed(goal)) throw new NamedError("plan.errors.goalNotFound");

      let sourceId: string | null = null;
      if (data.satisfaction === "evidence") {
        const [source] = await tx
          .select({ id: evidenceSources.id })
          .from(evidenceSources)
          .where(eq(evidenceSources.key, data.sourceKey));
        if (!source) throw new NamedError("plan.errors.sourceNotFound");
        sourceId = source.id;
      }

      const cadenceN = "cadenceN" in data ? data.cadenceN : null;
      const cadenceWeekdays = "cadenceWeekdays" in data ? weekdaysArraySql(data.cadenceWeekdays) : sql`null`;
      const targetQuantity = "targetQuantity" in data ? data.targetQuantity : null;
      const unit = "unit" in data ? data.unit : null;
      const threshold = "threshold" in data ? data.threshold : null;

      const [inserted] = await tx.execute<{ id: string }>(sql`
        insert into ${commitments}
          (user_id, goal_id, name, cadence_kind, cadence_n, cadence_weekdays,
           satisfaction, target_quantity, unit, source_id, threshold)
        values
          (${person.id}, ${data.goalId}, ${data.name}, ${data.cadenceKind}, ${cadenceN},
           ${cadenceWeekdays}, ${data.satisfaction}, ${targetQuantity}, ${unit},
           ${sourceId}, ${threshold})
        returning id
      `);

      if (data.satisfaction === "quantity") {
        await tx
          .update(goals)
          .set({ measureName: data.name, measureUnit: data.unit })
          .where(and(eq(goals.id, data.goalId), isNull(goals.measureName)));
      }

      return inserted.id;
    });

    revalidatePath("/");
    return { ok: true, commitmentId };
  } catch (error) {
    if (error instanceof NamedError) return { ok: false, error: messageKey(error.message) };
    // `addCommitmentSchema`'s own `.max()`s refuse an oversized cadenceN,
    // targetQuantity or threshold before the insert runs; this is the second
    // line, the way `declareFact` catches the same code — a number the schema
    // missed for any reason still meets `integer`'s ceiling as a message,
    // never a 500. `pgCode`, not a bare `error.code`: drizzle-orm wraps the
    // driver's error in `DrizzleQueryError` and hangs the real one off
    // `.cause`, so the bare check this used to be never fired (module 38's
    // own bug in `declareFact`, measured again here by module 37's validator —
    // `lib/db-error.test.ts` proves the difference).
    if (pgCode(error) === "22003") return { ok: false, error: "plan.errors.valueOutOfRange" };
    throw error;
  }
}

/**
 * Retires a commitment (RP-13). One UPDATE of `retired_at` alone — the grant
 * lets nothing else move, so there is no `deleteCommitment` to write in the
 * first place. Scoped by `(id, userId)` in the query itself, the way
 * `undoFact` scopes its delete: a commitment belonging to someone else
 * retires nothing and is reported exactly the way a missing one would be.
 */
export async function retireCommitment(
  input: RetireCommitmentInput,
): Promise<RetireCommitmentResult> {
  const parsed = retireCommitmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: messageKey(parsed.error.issues[0].message) };

  const person = await getPerson();
  if (!person) return { ok: false, error: "plan.errors.signedOut" };

  const retired = await withGoalsDb((tx) =>
    tx
      .update(commitments)
      .set({ retiredAt: sql`now()` })
      .where(
        and(eq(commitments.id, parsed.data.commitmentId), eq(commitments.userId, person.id)),
      )
      .returning({ id: commitments.id }),
  );

  if (retired.length === 0) return { ok: false, error: "plan.errors.notFound" };

  revalidatePath("/");
  return { ok: true };
}

// Every screen a goal's own name or its open/archived state can change what
// it draws on: the day, the week, the list and the goal's own screen.
function revalidateGoalScreens(goalId: string): void {
  revalidatePath("/");
  revalidatePath("/semana");
  revalidatePath("/metas");
  revalidatePath(`/metas/${goalId}`);
}

/**
 * Renames a goal (RP-23). One UPDATE of `name` alone, scoped by `(id,
 * userId)` in the query itself, the same shape `retireCommitment` and
 * `undoFact` already take — a foreign id renames nothing and is reported the
 * way a missing one would be. Facts, weeks and commitments never move: `name`
 * is the one column this statement ever names.
 */
export async function renameGoal(input: RenameGoalInput): Promise<RenameGoalResult> {
  const parsed = renameGoalSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: messageKey(parsed.error.issues[0].message) };

  const person = await getPerson();
  if (!person) return { ok: false, error: "plan.errors.signedOut" };

  const renamed = await withGoalsDb((tx) =>
    tx
      .update(goals)
      .set({ name: parsed.data.name })
      .where(and(eq(goals.id, parsed.data.goalId), eq(goals.userId, person.id)))
      .returning({ id: goals.id }),
  );

  if (renamed.length === 0) return { ok: false, error: "plan.errors.notFound" };

  revalidateGoalScreens(parsed.data.goalId);
  return { ok: true };
}

/**
 * Archives a goal (RP-24). One UPDATE of `archived_at` alone — nothing here
 * is deleted: `goals.facts`, `goals.phases` and `goals.commitments` all keep
 * every row they had. Archiving only takes the goal out of `loadDay`'s and
 * `loadWeek`'s own "open goals" queries (`lib/queries/day.ts`, `lib/queries/
 * week.ts`) and off `listGoals`'s own list — `listGoalsForMetas` (`lib/
 * queries/goal.ts`) is what still finds it, under "Archivadas".
 */
export async function archiveGoal(input: ArchiveGoalInput): Promise<ArchiveGoalResult> {
  const parsed = archiveGoalSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: messageKey(parsed.error.issues[0].message) };

  const person = await getPerson();
  if (!person) return { ok: false, error: "plan.errors.signedOut" };

  const archived = await withGoalsDb((tx) =>
    tx
      .update(goals)
      .set({ archivedAt: sql`now()` })
      .where(and(eq(goals.id, parsed.data.goalId), eq(goals.userId, person.id)))
      .returning({ id: goals.id }),
  );

  if (archived.length === 0) return { ok: false, error: "plan.errors.notFound" };

  revalidateGoalScreens(parsed.data.goalId);
  return { ok: true };
}

/**
 * Reopens an archived goal (RP-24): the same UPDATE as `archiveGoal`, with
 * `archived_at` set back to null. No sheet asks first (`docs/pulsar/
 * DESIGN.md` "Decisions taken here") — the same way undoing a tap needs
 * none (RP-05).
 */
export async function reopenGoal(input: ReopenGoalInput): Promise<ReopenGoalResult> {
  const parsed = reopenGoalSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: messageKey(parsed.error.issues[0].message) };

  const person = await getPerson();
  if (!person) return { ok: false, error: "plan.errors.signedOut" };

  const reopened = await withGoalsDb((tx) =>
    tx
      .update(goals)
      .set({ archivedAt: null })
      .where(and(eq(goals.id, parsed.data.goalId), eq(goals.userId, person.id)))
      .returning({ id: goals.id }),
  );

  if (reopened.length === 0) return { ok: false, error: "plan.errors.notFound" };

  revalidateGoalScreens(parsed.data.goalId);
  return { ok: true };
}

/**
 * Moves a goal's horizon (RP-25). One transaction reads the goal and the last
 * day of its phases, so a horizon that would strand a phase is refused with the
 * data it was judged on. The UPDATE names `horizon` alone, scoped by `(id,
 * userId)`; a foreign id matches nothing and is reported as a missing goal.
 */
export async function moveHorizon(input: MoveHorizonInput): Promise<MoveHorizonResult> {
  const parsed = moveHorizonSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: messageKey(parsed.error.issues[0].message) };

  const person = await getPerson();
  if (!person) return { ok: false, error: "plan.errors.signedOut" };

  const { goalId, horizon } = parsed.data;

  try {
    await withGoalsDb(async (tx) => {
      const [goal] = await tx.select({ id: goals.id }).from(goals).where(eq(goals.id, goalId));
      if (!goal) throw new NamedError("plan.errors.notFound");

      const [last] = await tx
        .select({ endsOn: max(phases.endsOn) })
        .from(phases)
        .where(eq(phases.goalId, goalId));

      const refusal = horizonRefusal({
        horizon,
        today: todayInZone(),
        lastPhaseEndsOn: last?.endsOn ?? null,
      });
      if (refusal) throw new NamedError(refusal);

      const moved = await tx
        .update(goals)
        .set({ horizon })
        .where(and(eq(goals.id, goalId), eq(goals.userId, person.id)))
        .returning({ id: goals.id });
      if (moved.length === 0) throw new NamedError("plan.errors.notFound");
    });
  } catch (error) {
    if (error instanceof NamedError) return { ok: false, error: messageKey(error.message) };
    throw error;
  }

  revalidateGoalScreens(goalId);
  revalidatePath(`/metas/${goalId}/revision`);
  return { ok: true };
}
