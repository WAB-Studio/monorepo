"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { completeOneOff } from "@/app/actions/one-offs";
import { Button, Flex, Mark, Text } from "@/components/ui";
import { useTimeWords } from "@/components/ui/figure";
import type { MessageKey } from "@/i18n/translator";
import { formatQuantity } from "@/lib/units/time";

/**
 * `HoyTareaMes.dc.html`: the goal's next task of the month under its figures,
 * with the mark that completes it. The refresh `completeOneOff` revalidates
 * is what brings the following task in; nothing is advanced here.
 */
export function MonthTaskLine({
  oneOffId,
  name,
  estimate,
  unit,
}: {
  oneOffId: string;
  name: string;
  estimate: number | null;
  unit: string;
}) {
  const t = useTranslations();
  const words = useTimeWords();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<MessageKey | null>(null);

  function handleComplete() {
    if (pending) return;
    setError(null);

    startTransition(() => {
      void completeOneOff({ oneOffId }).then((result) => {
        if (!result.ok) setError(result.error);
      });
    });
  }

  return (
    <>
      <Flex align="center" gap="2">
        <Flex ml="-3" asChild>
          <Button
            tap={44}
            variant="ghost"
            onClick={handleComplete}
            disabled={pending}
            aria-label={t("day.monthLine.markTask", { name })}
          >
            <Mark state="empty" />
          </Button>
        </Flex>
        <Text variant="name">{name}</Text>
        {estimate !== null ? (
          <Text variant="meta" tone="muted" end>
            {formatQuantity(estimate, unit, words)}
          </Text>
        ) : null}
      </Flex>
      {error ? (
        <Text as="p" tone="muted" variant="meta">
          {t(error)}
        </Text>
      ) : null}
    </>
  );
}
