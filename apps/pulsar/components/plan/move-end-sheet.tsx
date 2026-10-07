"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { moveHorizon } from "@/app/actions/plan";
import { Button, Sheet, SheetActions, Text } from "@/components/ui";
import { civilDateLabel, todayInZone } from "@/lib/zone";

// The year shows only when it is not the current one.
function dateOf(day: string): string {
  const year = day.slice(0, 4);
  return year === todayInZone().slice(0, 4) ? civilDateLabel(day) : `${civilDateLabel(day)} de ${year}`;
}

/**
 * `RoadmapMoverFinalHoja`: «Mover el final» names both ends and asks before
 * it writes; a refusal keeps the sheet open with `RoadmapMoverFinalFallo`.
 */
export function MoveEndSheet({
  goalId,
  from,
  to,
  moveTo,
  open,
  onOpenChange,
}: {
  goalId: string;
  // The goal's last day today, and the day the plan ends.
  from: string;
  to: string;
  // The horizon that holds the plan.
  moveTo: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  function close(next: boolean) {
    if (pending) return;
    setFailed(false);
    onOpenChange(next);
  }

  function move() {
    if (pending) return;
    setFailed(false);
    startTransition(async () => {
      try {
        const result = await moveHorizon({ goalId, horizon: moveTo });
        if (result.ok) {
          onOpenChange(false);
          router.refresh();
        } else setFailed(true);
      } catch {
        setFailed(true);
      }
    });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={close}
      title={t("roadmap.moverFinal.title")}
      description={t("roadmap.moverFinal.body", { from: dateOf(from), to: dateOf(to) })}
    >
      {failed ? (
        <Text as="p" variant="sentence" role="alert">
          {t("roadmap.moverFinal.failed")}
        </Text>
      ) : null}
      <SheetActions>
        <Button block onClick={move} disabled={pending}>
          {pending ? t("roadmap.moverFinal.pending") : t("roadmap.moverFinal.move")}
        </Button>
        <Button block variant="outline" onClick={() => close(false)} disabled={pending}>
          {t("roadmap.moverFinal.cancel")}
        </Button>
      </SheetActions>
    </Sheet>
  );
}
