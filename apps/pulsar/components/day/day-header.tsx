import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { Button, Face, Flex, IconButton, Text, ThemeToggle } from "@/components/ui";

type HeaderLink = { href: string; label: string };

// The day's own header (`Hoy.dc.html`, `DiaPasado.dc.html`): a step back to
// the day before, then the date. Today carries its title under that line and
// the light/dark control beside it (RNP-08): docs/pulsar/DESIGN.md
// "Decisions taken here" puts it here and nowhere else — there is no
// `/cuenta` screen in this app. A past day's date is its whole title, and
// «volver a hoy» takes the control's place.
export function DayHeader({
  date,
  title,
  back,
  limitNote,
  toToday,
  theme,
}: {
  date: string;
  title?: string;
  // Absent on the oldest day a fact may still name (`PAST_DAY_LIMIT`).
  back?: HeaderLink;
  // Said in the step's place on that oldest day: why there is no way further.
  limitNote?: string;
  toToday?: HeaderLink;
  theme?: { toLightLabel: string; toDarkLabel: string };
}) {
  return (
    <>
      <Flex justify="between" align="center" gap="2">
        <Flex align="center" gap="1">
          {back ? (
            <IconButton asChild tap={44} variant="ghost">
              <Link href={back.href} aria-label={back.label}>
                <ChevronLeft size={20} aria-hidden />
              </Link>
            </IconButton>
          ) : limitNote ? (
            <Flex width="14px" flexShrink="0" aria-hidden />
          ) : null}
          <Text as="p" variant="meta" tone="muted">
            {date}
          </Text>
        </Flex>
        {toToday ? (
          <Button asChild tap={44} variant="ghost">
            <Link href={toToday.href}>
              <Text variant="meta" tone="accent">
                {toToday.label}
              </Text>
            </Link>
          </Button>
        ) : null}
        {theme ? (
          <Face on="phone">
            <ThemeToggle toLightLabel={theme.toLightLabel} toDarkLabel={theme.toDarkLabel} />
          </Face>
        ) : null}
      </Flex>
      {limitNote ? (
        <Text as="p" variant="meta" tone="muted">
          {limitNote}
        </Text>
      ) : null}
      {title ? (
        <Text as="p" variant="title">
          {title}
        </Text>
      ) : null}
    </>
  );
}
