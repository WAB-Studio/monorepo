"use server";

import { revalidatePath } from "next/cache";

import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { commitments, facts, oneOffs } from "@/db/schema";
import { getPerson, withGoalsDb } from "@/lib/session";
import {
  declareFactSchema,
  requireQuantityFor,
  undoFactSchema,
  type DeclareFactInput,
  type UndoFactInput,
} from "@/lib/validation/fact";
import { todayInZone } from "@/lib/zone";

export type DeclareFactResult = { ok: true; factId: string } | { ok: false; error: string };
export type UndoFactResult = { ok: true } | { ok: false; error: string };

// Carries a message key out of the transaction without collapsing every
// rejection into the same generic failure.
class NamedError extends Error {}

/**
 * Writes a fact in one gesture (RP-02, RP-03, RP-04). The day it happened is
 * decided here, from the person's own zone, never taken from the client
 * (RNP-06); the moment it was written is left to the column's own `now()`, so
 * the two are never the same value read twice.
 */
export async function declareFact(input: DeclareFactInput): Promise<DeclareFactResult> {
  const parsed = declareFactSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const person = await getPerson();
  if (!person) return { ok: false, error: "day.errors.signedOut" };

  const { commitmentId, oneOffId, quantity, note, replace } = parsed.data;

  try {
    const factId = await withGoalsDb(async (tx) => {
      let goalId: string | null = null;

      if (commitmentId != null) {
        const [commitment] = await tx
          .select({ satisfaction: commitments.satisfaction, goalId: commitments.goalId })
          .from(commitments)
          .where(eq(commitments.id, commitmentId));

        if (!commitment) throw new NamedError("day.errors.notFound");

        // RP-05: a fact for a commitment satisfied by evidence would have no
        // day of its own to explain — that day is drawn from the source, not
        // written here. Refused before the insert, not by a column that would
        // otherwise happily hold it.
        if (commitment.satisfaction === "evidence") {
          throw new NamedError("day.errors.evidenceOnly");
        }

        const quantityCheck = z
          .custom<{ quantity?: number | null }>()
          .superRefine(requireQuantityFor(commitment.satisfaction))
          .safeParse({ quantity });
        if (!quantityCheck.success) {
          throw new NamedError(quantityCheck.error.issues[0].message);
        }

        goalId = commitment.goalId;
      } else if (oneOffId != null) {
        const [oneOff] = await tx
          .select({ goalId: oneOffs.goalId })
          .from(oneOffs)
          .where(eq(oneOffs.id, oneOffId));

        if (!oneOff) throw new NamedError("day.errors.notFound");
        goalId = oneOff.goalId;
      }

      // "Cambiar" (`quantity-sheet.tsx`), never "Anotar": a row that already
      // carries a fact today is replaced whole, in the same transaction as
      // the insert below — delete-then-insert, never an UPDATE (`facts`
      // grants none), and never two separate calls a client could interleave
      // with someone else's read. Scoped by commitment and day, not by one
      // factId, so it also clears an old accumulation from before this
      // guard existed.
      if (replace && commitmentId != null) {
        await tx.execute(sql`
          delete from ${facts}
          where user_id = ${person.id}
            and commitment_id = ${commitmentId}
            and day = ${todayInZone()}::date
        `);
      }

      // Named columns only, never the builder's `.insert()`: it lists every
      // column of the table and fills the rest with `default`, and Postgres
      // checks the grant on a column named that way too — `written_at` is
      // deliberately withheld from `authenticated`, left to the column's own
      // `now()` (RP-06).
      const [inserted] = await tx.execute<{ id: string }>(sql`
        insert into ${facts}
          (user_id, commitment_id, one_off_id, goal_id, day, quantity, note)
        values
          (${person.id}, ${commitmentId ?? null}, ${oneOffId ?? null}, ${goalId},
           ${todayInZone()}, ${quantity ?? null}, ${note ?? null})
        returning id
      `);

      return inserted.id;
    });

    revalidatePath("/");
    return { ok: true, factId };
  } catch (error) {
    if (error instanceof NamedError) return { ok: false, error: error.message };
    // `declareFactSchema`'s own `.max()` (`lib/validation/fact.ts`) refuses a
    // quantity this large before the insert ever runs; this is the second
    // line, not the first — a number the schema missed for any reason still
    // meets Postgres's own `integer` ceiling as a message, never a 500.
    if (isNumericRangeError(error)) return { ok: false, error: "day.errors.quantityInvalid" };
    throw error;
  }
}

function isNumericRangeError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "22003"
  );
}

/**
 * Takes a declared fact back (RP-05). Scoped by `(id, userId)` in the query
 * itself, not the policy alone: a fact belonging to someone else, or one that
 * never existed, deletes nothing and reports exactly the same way. A fact
 * whose commitment is satisfied by evidence was never inserted in the first
 * place, so there is no extra case here to refuse it — there is no row.
 */
export async function undoFact(input: UndoFactInput): Promise<UndoFactResult> {
  const parsed = undoFactSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const person = await getPerson();
  if (!person) return { ok: false, error: "day.errors.signedOut" };

  const deleted = await withGoalsDb((tx) =>
    tx
      .delete(facts)
      .where(and(eq(facts.id, parsed.data.factId), eq(facts.userId, person.id)))
      .returning({ id: facts.id }),
  );

  if (deleted.length === 0) return { ok: false, error: "day.errors.notFound" };

  revalidatePath("/");
  return { ok: true };
}
