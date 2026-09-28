"use server";

import { revalidatePath } from "next/cache";

import { and, eq, sql } from "drizzle-orm";

import { facts, goals, oneOffs } from "@/db/schema";
import { getPerson, withGoalsDb } from "@/lib/session";
import {
  createOneOffSchema,
  completeOneOffSchema,
  deleteOneOffSchema,
  type CreateOneOffInput,
  type CompleteOneOffInput,
  type DeleteOneOffInput,
} from "@/lib/validation/one-off";

import { declareFact, type DeclareFactResult } from "./facts";

export type CreateOneOffResult = { ok: true; oneOffId: string } | { ok: false; error: string };
export type CompleteOneOffResult = DeclareFactResult;
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
    return { ok: true, oneOffId };
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
 * is no fact to keep. `facts.one_off_id`'s own FK is `ON DELETE cascade`
 * (`db/schema/facts.ts`), not `restrict` — changing that would be a second
 * migration this module does not carry — so the refusal below is an
 * application check, read before the delete, never the FK's own error code:
 * unchecked, the statement would succeed and silently take the fact with it,
 * which is exactly what RP-22 says must not happen to a day that did occur.
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

    if (deleted.length === 0) return { ok: false, error: "day.errors.notFound" };

    revalidatePath("/");
    return { ok: true };
  } catch (error) {
    if (error instanceof NamedError) return { ok: false, error: error.message };
    throw error;
  }
}
