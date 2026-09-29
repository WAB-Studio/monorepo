import { dayWords } from "@/lib/day/day-words";

export type DayNames = { weekdays: string[]; months: string[] };

// The parts a phrase names a day with: `far` says the month is in them, so the
// caller reads the `…Far` catalogue key.
export function farDayParts(day: string, today: string, names: DayNames) {
  const words = dayWords(day, today);
  return {
    far: words.month !== null,
    parts: {
      weekday: names.weekdays[words.weekday],
      day: words.day,
      month: words.month === null ? "" : names.months[words.month],
    },
  };
}

// `key` names the phrase without its month; a day outside the week of `today`
// reads `${key}Far` instead.
export function dayPhrase(
  translate: (key: string, values: Record<string, string | number>) => string,
  key: string,
  day: string,
  today: string,
  names: DayNames,
  extra: Record<string, string> = {},
): string {
  const { far, parts } = farDayParts(day, today, names);
  return translate(far ? `${key}Far` : key, { ...parts, ...extra });
}
