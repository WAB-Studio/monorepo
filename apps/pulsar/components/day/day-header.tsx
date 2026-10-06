import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button, Face, Flex, IconButton, ScreenHeader, Text, ThemeToggle } from "@/components/ui";

type HeaderLink = { href: string; label: string };

// The day's own header (`ArmazonEncabezado.dc.html` case 4,
// `DiaPasadoEscritorio.dc.html`): the shared `ScreenHeader`, its eyebrow line
// holding the step back to the day before. Today's title is its `h1`, with the
// date on that line and the light/dark control at its end (RNP-08):
// docs/pulsar/DESIGN.md "Decisions taken here" puts it here and nowhere else —
// there is no `/cuenta` screen in this app. A past day's date is its `h1`, and
// «volver a hoy» takes the control's place.
export function DayHeader({
  date,
  title,
  back,
  forward,
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
  // A past day's step to the day after; the last one before today lands on Hoy.
  forward?: HeaderLink;
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
  // A past day (`DiaPasadoPasos.dc.html`): both steps are words with their
  // chevron, «volver a hoy» pushed to the end.
  const eyebrow = title === undefined ? (
    <Flex align="center" gap="1">
      {back ? (
        <Button asChild tap={44} variant="ghost">
          <Link href={back.href}>
            <ChevronLeft size={16} aria-hidden />
            <Text variant="meta" tone="accent">
              {back.label}
            </Text>
          </Link>
        </Button>
      ) : limitNote ? (
        <Flex width="14px" flexShrink="0" aria-hidden />
      ) : null}
      {forward ? (
        // A ghost button's own negative margin would lay it over the step back.
        <Flex ml="3">
          <Button asChild tap={44} variant="ghost">
            <Link href={forward.href}>
              <Text variant="meta" tone="accent">
                {forward.label}
              </Text>
              <ChevronRight size={16} aria-hidden />
            </Link>
          </Button>
        </Flex>
      ) : null}
      {toToday ? (
        <Flex ml="auto" pl="3">
          <Button asChild tap={44} variant="ghost">
            <Link href={toToday.href}>
              <Text variant="meta" tone="accent">
                {toToday.label}
              </Text>
            </Link>
          </Button>
        </Flex>
      ) : null}
    </Flex>
  ) : (
    <Flex justify="between" align="center" gap="2">
      <Flex align="center" gap="5">
        {back ? (
          <IconButton asChild tap={44} variant="ghost">
            <Link href={back.href} aria-label={back.label}>
              <ChevronLeft size={20} aria-hidden />
            </Link>
          </IconButton>
        ) : limitNote ? (
          <Flex width="14px" flexShrink="0" aria-hidden />
        ) : null}
        {title ? (
          <Text as="p" variant="meta" tone="muted">
            {date}
          </Text>
        ) : null}
        {toToday ? (
          <Button asChild tap={44} variant="ghost">
            <Link href={toToday.href}>
              <Text variant="meta" tone="accent">
                {toToday.label}
              </Text>
            </Link>
          </Button>
        ) : null}
      </Flex>
      {theme ? (
        <Face on="phone">
          <ThemeToggle toLightLabel={theme.toLightLabel} toDarkLabel={theme.toDarkLabel} />
        </Face>
      ) : null}
    </Flex>
  );

  return (
    <>
      <ScreenHeader title={title ?? date} eyebrow={eyebrow} meta={tally} />
      {limitNote ? (
        <Text as="p" variant="meta" tone="muted">
          {limitNote}
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
