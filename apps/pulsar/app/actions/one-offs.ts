"use server";

import { revalidatePath } from "next/cache";

import { and, eq, isNull, sql } from "drizzle-orm";

import { facts, goals, oneOffs } from "@/db/schema";
import { getPerson, withGoalsDb } from "@/lib/session";
import {
  createOneOffSchema,
  completeOneOffSchema,
  deleteOneOffSchema,
  scheduleOneOffSchema,
  type ScheduleOneOffInput,
  type CreateOneOffInput,
  type CompleteOneOffInput,
  type DeleteOneOffInput,
} from "@/lib/validation/one-off";

import { declareFact, type DeclareFactResult } from "./facts";

export type CreateOneOffResult = { ok: true; oneOffId: string } | { ok: false; error: string };
export type CompleteOneOffResult = DeclareFactResult;
export type ScheduleOneOffResult = { ok: true } | { ok: false; error: string };
export type DeleteOneOffResult = { ok: true } | { ok: false; error: string };

// Carries a message key out of the transaction without collapsing every
// rejection into the same generic failure.
class NamedError extends Error {}

/**
 * Writes something to do once (RP-19, RP-20). `goalId`, when given, is read
 * back before the insert the way `addPhase` reads its own goal back:
 * `one_offs_insert_self` only checks that the new row's `user_id` is the
 * caller, never that `goal_id` names one of theirs, so `goals_select_self` —
 * not this function's own `where` — is what actually hides a foreign goal.
 */
export async function createOneOff(input: CreateOneOffInput): Promise<CreateOneOffResult> {
  const parsed = createOneOffSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const person = await getPerson();
  if (!person) return { ok: false, error: "day.errors.signedOut" };

  const { name, day, goalId } = parsed.data;

  try {
    const oneOffId = await withGoalsDb(async (tx) => {
      if (goalId != null) {
        const [goal] = await tx.select({ id: goals.id }).from(goals).where(eq(goals.id, goalId));
        if (!goal) throw new NamedError("plan.errors.goalNotFound");
      }

      // Named columns only, never the builder's `.insert()` (docs/TRAPS.md,
      // "Drizzle's insert builder names every column"): `id` and `created_at`
      // are left off, and the grant does not even list `created_at`.
      const [inserted] = await tx.execute<{ id: string }>(sql`
        insert into ${oneOffs} (user_id, goal_id, name, day)
        values (${person.id}, ${goalId ?? null}, ${name}, ${day})
        returning id
      `);

      return inserted.id;
    });

    revalidatePath("/");
    revalidatePath("/sueltas");
    return { ok: true, oneOffId };
  } catch (error) {
    if (error instanceof NamedError) return { ok: false, error: error.message };
    throw error;
  }
}

/**
 * Gives a dayless one-off a day (RP-21). The row is read first only to name
 * the refusal; the enforcement is `day is null` in the UPDATE and
 * `one_offs_update_self`, so a fact landing between the two statements still
 * writes nothing — 0 rows is reported as `oneOffHasFact`.
 */
export async function scheduleOneOff(input: ScheduleOneOffInput): Promise<ScheduleOneOffResult> {
  const parsed = scheduleOneOffSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const person = await getPerson();
  if (!person) return { ok: false, error: "day.errors.signedOut" };

  const { oneOffId, day } = parsed.data;

  try {
    await withGoalsDb(async (tx) => {
      const [row] = await tx
        .select({ id: oneOffs.id, day: oneOffs.day })
        .from(oneOffs)
        .where(eq(oneOffs.id, oneOffId));
      if (!row) throw new NamedError("day.errors.notFound");
      if (row.day != null) throw new NamedError("day.errors.oneOffAlreadyDated");

      const [existingFact] = await tx
        .select({ id: facts.id })
        .from(facts)
        .where(eq(facts.oneOffId, oneOffId));
      if (existingFact) throw new NamedError("day.errors.oneOffHasFact");

      const updated = await tx
        .update(oneOffs)
        .set({ day })
        .where(
          and(eq(oneOffs.id, oneOffId), eq(oneOffs.userId, person.id), isNull(oneOffs.day)),
        )
        .returning({ id: oneOffs.id });
      if (updated.length === 0) throw new NamedError("day.errors.oneOffHasFact");
    });

    revalidatePath("/");
    revalidatePath("/sueltas");
    return { ok: true };
  } catch (error) {
    if (error instanceof NamedError) return { ok: false, error: error.message };
    throw error;
  }
}

/**
 * Takes a one-off off the day's list by writing the fact it produces
 * (RP-19). This is the fact path itself, not a second one: `declareFact`
 * already knows a bare `oneOffId` is one whole subject
 * (`declareFactSchema`'s `requireOneSubject`), reads no commitment and asks
 * no quantity, so calling it here is the entire act. Nothing here inserts
 * into `goals.facts` on its own.
 */
export async function completeOneOff(input: CompleteOneOffInput): Promise<CompleteOneOffResult> {
  const parsed = completeOneOffSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  return declareFact({ oneOffId: parsed.data.oneOffId });
}

/**
 * Deletes a one-off written by mistake (RP-22): it never happened, so there
 * is no fact to keep. This check is a courtesy, not the enforcement — round
 * 2, 2026-09-28: driven bare, under a settled session with no server action
 * in the way, the old policy let an own one-off with a fact go and the fact
 * cascaded away with it (`facts.one_off_id`'s own FK is `ON DELETE cascade`,
 * `db/schema/facts.ts`, not `restrict` — changing that risks a person's own
 * cascade elsewhere and is out of this module's own migration). The real
 * guard is `one_offs_delete_self` (`db/schema/one-offs.ts`, migration 0002):
 * its own `USING` now refuses a row that carries a fact, so even a write
 * that skips this function entirely — or a fact landing between this check
 * and the statement below — never deletes one. This check only ever buys
 * the sheet its named message before the round trip; the delete itself is
 * the same statement either way.
 */
export async function deleteOneOff(input: DeleteOneOffInput): Promise<DeleteOneOffResult> {
  const parsed = deleteOneOffSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const person = await getPerson();
  if (!person) return { ok: false, error: "day.errors.signedOut" };

  const { oneOffId } = parsed.data;

  try {
    const deleted = await withGoalsDb(async (tx) => {
      const [existingFact] = await tx
        .select({ id: facts.id })
        .from(facts)
        .where(eq(facts.oneOffId, oneOffId));
      if (existingFact) throw new NamedError("day.errors.oneOffHasFact");

      return tx
        .delete(oneOffs)
        .where(and(eq(oneOffs.id, oneOffId), eq(oneOffs.userId, person.id)))
        .returning({ id: oneOffs.id });
    });

    // A fact this check never saw, written after it and before the
    // statement above: the policy is what actually refused the row, and
    // `deleted.length === 0` is the only sign of that reaching this
    // function — reported as the same refusal, never "not found", since a
    // sheet only ever opens for a one-off the person can already see.
    if (deleted.length === 0) return { ok: false, error: "day.errors.oneOffHasFact" };

    revalidatePath("/");
    return { ok: true };
  } catch (error) {
    if (error instanceof NamedError) return { ok: false, error: error.message };
    throw error;
  }
}
