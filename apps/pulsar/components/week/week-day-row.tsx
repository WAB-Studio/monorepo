import { Flex, Mark, Row, Text, type MarkState } from "@/components/ui";

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
  // Present only on a past day the person may still open (`/dia/<day>`),
  // with the name a reader hears for it; absent, the label is plain text.
  link?: { href: string; label: string };
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
 *
 * Composed from `Row` at its own default height rather than a bare `Flex`:
 * `Semana.dc.html`'s own 54px floor is already cleared by `Row`'s own 56px
 * minimum (`row.module.css`, unedited here), so no new size variant is
 * needed. The day label leads, the dots stand in for the row's own `name`,
 * and the note trails — the same hairline and button shape every other row
 * in this app draws (docs/pulsar/DESIGN.md "a row is a real button, never a
 * div"). Each dot is `Mark` at `size="dot"` (`Meta.dc.html`'s own 8px phase
 * mark, module 16), 6px apart — `gap="6px"` is a plain CSS string, a value
 * `Flex`'s own `gap` prop already accepts, not a new class.
 */
export function WeekDayRow({ label, isToday, link, dots, note, rule = true }: WeekDayRowProps) {
  return (
    <Row
      rule={rule}
      leadingHref={link?.href}
      leadingLabel={link?.label}
      leading={
        <Text as="span" variant="meta" tone={link ? "accent" : isToday ? "ink" : "muted"}>
          {label}
        </Text>
      }
      name={
        // `Row` wraps `name` in a `<Text as="span">` (`row.tsx`): `as="span"`
        // here keeps this flex inline, never a `<div>` nested in a `<span>`.
        <Flex as="span" gap="6px" wrap="wrap">
          {dots.map((dot, index) => (
            <Mark key={index} state={dot.state} label={dot.label} size="dot" />
          ))}
        </Flex>
      }
      trailing={
        note ? (
          <Text as="span" variant="meta" tone="muted">
            {note}
          </Text>
        ) : undefined
      }
    />
  );
}
