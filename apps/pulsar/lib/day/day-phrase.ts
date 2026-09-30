import { civilDateToDate, dateToCivilDate } from "@/lib/zone";
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

// Hoy's «terminó» line for a goal whose last day was `lastDay`: «ayer» the day
// after, the named day later, with its month once it falls outside the week.
export function endedPhrase(
  translate: (key: string, values: Record<string, string | number>) => string,
  goal: string,
  lastDay: string,
  today: string,
  names: DayNames,
): string {
  const date = civilDateToDate(today);
  date.setUTCDate(date.getUTCDate() - 1);
  if (lastDay === dateToCivilDate(date)) return translate("day.ended.yesterday", { goal });
  return dayPhrase(translate, "day.ended.on", lastDay, today, names, { goal });
}
