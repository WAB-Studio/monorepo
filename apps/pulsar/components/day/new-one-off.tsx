"use client";

import { type FormEvent, useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { createOneOff } from "@/app/actions/one-offs";
import { createOneOffSchema } from "@/lib/validation/one-off";
import { Field, Flex, Mark, Text } from "@/components/ui";
import { todayInZone } from "@/lib/zone";

export type NewOneOffProps = {
  // Absent, the one-off written here belongs to nothing (RP-20); given, it is
  // written from that goal's own group, the same gesture either way — there
  // is no second form for the goal-scoped case.
  goalId?: string;
};

/**
 * The field at the foot of the day (RP-19), permanently visible under the
 * one-offs it feeds: type a name, submit, and it lands on today with no
 * sheet and no screen of its own (docs/pulsar/DESIGN.md "Decisions taken
 * here"). The mark beside it is the design's one dashed stroke, drawn empty
 * because this is the one row nothing has written yet.
 */
export function NewOneOff({ goalId }: NewOneOffProps) {
  const t = useTranslations();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Guards a second submit fired while the first is still in flight
    // (a fast double tap on a virtual keyboard's "go") from landing a
    // second row: the field stays disabled for the same span.
    if (pending) return;

    // The same schema the server runs (`createOneOff`, `app/actions/one-
    // offs.ts`), run here first: a name this refuses never reaches the
    // network, the same discipline `QuantitySheet` already holds for a
    // quantity (`lib/validation/fact.ts`'s `quantitySchema`).
    const parsed = createOneOffSchema.safeParse({ name, day: todayInZone(), goalId });
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    setError(null);

    startTransition(() => {
      void createOneOff(parsed.data).then((result) => {
        if (result.ok) setName("");
        else setError(result.error);
      });
    });
  }

  return (
    <form onSubmit={handleSubmit}>
      <Flex align="center" gap="2">
        <Mark state="empty" dashed />
        <Field
          label={t("day.newOneOff.label")}
          hideLabel
          placeholder={t("day.newOneOff.placeholder")}
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={pending}
        />
      </Flex>
      {error ? (
        <Text as="p" tone="muted" variant="meta">
          {t(error)}
        </Text>
      ) : null}
    </form>
  );
}
