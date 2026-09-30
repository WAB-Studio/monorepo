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
  tally,
  ended,
}: {
  date: string;
  title?: string;
  // Absent on the oldest day a fact may still name (`PAST_DAY_LIMIT`).
  back?: HeaderLink;
  // Said in the step's place on that oldest day: why there is no way further.
  limitNote?: string;
  toToday?: HeaderLink;
  theme?: { toLightLabel: string; toDarkLabel: string };
  // «hechos 3 de 5»: mono, under the title (a past day's, under its date),
  // absent when the day counts nothing.
  tally?: string;
  // One quiet line per goal that ended this week, under the title.
  ended?: { id: string; text: string; href: string; see: string; seeLabel: string }[];
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
      {tally ? (
        <Text as="p" variant="meta" tone="muted">
          {tally}
        </Text>
      ) : null}
      {ended?.map((line) => (
        <Flex key={line.id} align="center" gap="1" wrap="wrap">
          <Text as="p" variant="meta" tone="muted">
            {line.text}
          </Text>
          <Button asChild tap={44} variant="ghost">
            <Link href={line.href} aria-label={line.seeLabel}>
              <Text variant="meta" tone="accent">
                {line.see}
              </Text>
            </Link>
          </Button>
        </Flex>
      ))}
    </>
  );
}
