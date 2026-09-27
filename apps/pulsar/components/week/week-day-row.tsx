import { Flex, Mark, Separator, Text, type MarkState } from "@/components/ui";

export type WeekDot = {
  state: MarkState;
  // Names the mark when it stands on its own, in this grid of days — the
  // exact use `components/ui/mark.tsx`'s own comment names and a row's
  // running text never needs to (`day-row.tsx` reads that text itself).
  label: string;
};

export type WeekDayRowProps = {
  // Mono, e.g. "lun 21" — today's own label is drawn in a stronger tone by
  // the caller, everyone else's in muted (`Semana.dc.html`).
  label: string;
  isToday: boolean;
  dots: WeekDot[];
  // "5 de 6" on a day already lived, "hoy" on today, absent on a day yet to
  // come or on the last row of a group — `rule` below drops its own hairline
  // there the same way `Row` does.
  note?: string;
  rule?: boolean;
};

/**
 * One day of the week, drawn as it was (RP-16): a day with no dot at all is
 * an absence, never a mark of its own — `dots` is simply empty for it, and no
 * word here says "nothing happened". No streak, no score, no colour outside
 * `Mark`'s own three states, none of them red.
 */
export function WeekDayRow({ label, isToday, dots, note, rule = true }: WeekDayRowProps) {
  return (
    <>
      <Flex justify="between" align="center" gap="3" py="2">
        <Text as="span" variant="meta" tone={isToday ? "ink" : "muted"}>
          {label}
        </Text>
        <Flex gap="1" wrap="wrap" justify="center" flexGrow="1">
          {dots.map((dot, index) => (
            <Mark key={index} state={dot.state} label={dot.label} />
          ))}
        </Flex>
        <Text as="span" variant="meta" tone="muted">
          {note}
        </Text>
      </Flex>
      {rule ? <Separator /> : null}
    </>
  );
}
