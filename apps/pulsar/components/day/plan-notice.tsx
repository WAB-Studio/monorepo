"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { dismissPlanNotice } from "@/app/actions/roadmap";
import { Button, Flex, Panel, Text, TextLink } from "@/components/ui";
import { useTimeWords } from "@/components/ui/figure";
import type { MessageKey } from "@/i18n/translator";
import type { PlanNotice as Notice } from "@/lib/plan/roadmap-read";
import { formatQuantity } from "@/lib/units/time";

const DAYS_IN_WEEK = 7;

/**
 * `RoadmapHoyMovido.dc.html`, `RoadmapHoyMovidoDias.dc.html` (RP-52): the card
 * a goal draws on Hoy when its last month closed short. Under a week it says
 * the days and drops the sentence about the rest running behind. «Entendido»
 * writes `plan_seen`; the refresh `dismissPlanNotice` revalidates removes it.
 */
export function PlanNotice({
  goalId,
  goalName,
  unit,
  notice,
  closedMonthName,
  nextMonthName,
  endDay,
  endMonthName,
}: {
  goalId: string;
  goalName: string;
  unit: string;
  notice: Notice;
  closedMonthName: string;
  nextMonthName: string;
  endDay: number;
  endMonthName: string;
}) {
  const t = useTranslations();
  const words = useTimeWords();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<MessageKey | null>(null);

  const short = notice.movedDays < DAYS_IN_WEEK;
  const weeks = Math.max(1, Math.round(notice.movedDays / DAYS_IN_WEEK));
  const month = closedMonthName.charAt(0).toUpperCase() + closedMonthName.slice(1);
  const values = {
    month,
    done: formatQuantity(notice.closedDone, unit, words),
    amount: formatQuantity(notice.closedAmount, unit, words),
    next: nextMonthName,
    date: t("roadmap.hoyMovido.endDate", { day: endDay, month: endMonthName }),
  };

  function handleDismiss() {
    if (pending) return;
    setError(null);

    startTransition(() => {
      void dismissPlanNotice({ goalId, month: notice.closedMonth.slice(0, 7) }).then((result) => {
        if (!result.ok) setError(result.error);
      });
    });
  }

  return (
    <Panel as="div" bordered>
      <Flex direction="column" gap="3">
        <Text as="p" variant="title">
          {short
            ? t("roadmap.hoyMovido.titleDays", { goal: goalName, days: notice.movedDays })
            : t("roadmap.hoyMovido.title", { goal: goalName, weeks })}
        </Text>
        <Text as="p" variant="sentence">
          {t(short ? "roadmap.hoyMovido.bodyShort" : "roadmap.hoyMovido.body", values)}
        </Text>
        <Flex align="center" gap="4" wrap="wrap">
          <TextLink href={`/metas/${goalId}/plan`}>{t("roadmap.hoyMovido.seePlan")}</TextLink>
          <Button variant="ghost" onClick={handleDismiss} disabled={pending}>
            {t("roadmap.hoyMovido.dismiss")}
          </Button>
        </Flex>
        {error ? (
          <Text as="p" variant="sentence">
            {t(error)}
          </Text>
        ) : null}
      </Flex>
    </Panel>
  );
}
