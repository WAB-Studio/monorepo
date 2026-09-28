import { z } from "zod";

// Exactly one subject, mirroring the database's own `facts_one_subject`
// check: a fact explains a commitment or a one-off, never both and never
// neither (§2 «Invariants»).
function requireOneSubject(
  data: { commitmentId?: string | null; oneOffId?: string | null },
  ctx: z.RefinementCtx,
) {
  if ((data.commitmentId != null) === (data.oneOffId != null)) {
    ctx.addIssue({
      code: "custom",
      message: "day.errors.subjectInvalid",
      path: ["commitmentId"],
    });
  }
}

// The commitment's own unit, never typed twice (RP-03): shared by the server
// action and by the sheet's own "escribir otra cantidad" field, so a number
// the client refuses is a number the server would have refused too, and
// nothing types past the schema on either side. Bounded well under
// Postgres's `integer` column's own ceiling (2,147,483,647) — no quantity a
// person types in one day, in any of RP-03's units, plausibly reaches into
// the millions, and a value that large is a mistyped digit, not a real one.
// Left unbounded, that mistyped digit used to reach the insert and come back
// as a raw `value out of range for type integer` — a 500, not a message.
export const quantitySchema = z
  .number({ error: "day.errors.quantityInvalid" })
  .int({ error: "day.errors.quantityInvalid" })
  .positive({ error: "day.errors.quantityInvalid" })
  .max(1_000_000, { error: "day.errors.quantityInvalid" });

export const declareFactSchema = z
  .object({
    commitmentId: z.uuid({ error: "day.errors.subjectInvalid" }).nullish(),
    oneOffId: z.uuid({ error: "day.errors.subjectInvalid" }).nullish(),
    // Whether this is required at all depends on the commitment's
    // `satisfaction`, which the shape below cannot see — `requireQuantityFor`
    // runs that check on the same schema, once the action has read the
    // commitment it names.
    quantity: quantitySchema.nullish(),
    // The two mistakes from today's monologue (RP-04): offered, never required.
    note: z
      .string()
      .trim()
      .min(1, { error: "day.errors.noteEmpty" })
      .max(280, { error: "day.errors.noteTooLong" })
      .nullish(),
    // Set by `quantity-sheet.tsx`'s own "Cambiar", never by "Anotar": a row
    // that already carries a fact today is replaced whole — that
    // commitment's facts for today deleted, the new one inserted, one
    // transaction — rather than added beside it (RP-03's "one gesture",
    // read back rather than accumulated).
    replace: z.boolean().optional(),
  })
  .superRefine(requireOneSubject);

export type DeclareFactInput = z.infer<typeof declareFactSchema>;

/**
 * A commitment satisfied by `quantity` has nothing else that satisfies it
 * (RP-03): the number is the whole gesture. Read the commitment's own
 * `satisfaction` first — never guess it from the payload — then run this
 * refinement on the very schema the form used, so a call the form could never
 * produce is refused before it reaches the database's columns, which allow a
 * null quantity on every kind of fact.
 */
export function requireQuantityFor(satisfaction: "tap" | "quantity" | "evidence") {
  return function refine(data: { quantity?: number | null }, ctx: z.RefinementCtx) {
    if (satisfaction === "quantity" && data.quantity == null) {
      ctx.addIssue({
        code: "custom",
        message: "day.errors.quantityRequired",
        path: ["quantity"],
      });
    }
  };
}

export const undoFactSchema = z.object({
  factId: z.uuid({ error: "day.errors.invalid" }),
});

export type UndoFactInput = z.infer<typeof undoFactSchema>;
