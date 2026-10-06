// The words for a minute. A unit named any other way is not time and prints
// as it always has.
const TIME_UNITS = new Set(["minutos", "minuto", "min", "mins"]);

// `useGrouping: "always"`: "es" leaves four digits bare by default, and a
// total of 1.234 h has to read as grouped as the figures beside it.
const grouped = new Intl.NumberFormat("es", { useGrouping: "always" });

// The words come from the caller's translator; this file never names one.
export type TimeWords = {
  h: (h: string) => string;
  min: (min: string) => string;
  join: (h: string, min: string) => string;
  // A unit word agreeing with the number; absent where a caller prints raw.
  unit?: (unit: string, n: number) => string;
};

export function isTimeUnit(unit: string | null): boolean {
  return unit !== null && TIME_UNITS.has(unit.trim().toLowerCase());
}

export function splitMinutes(n: number): { h: number; min: number } {
  return { h: Math.floor(n / 60), min: n % 60 };
}

export function formatTime(n: number, words: TimeWords): string {
  const { h, min } = splitMinutes(n);
  if (h === 0) return words.min(grouped.format(min));
  if (min === 0) return words.h(grouped.format(h));
  return words.join(words.h(grouped.format(h)), words.min(grouped.format(min)));
}

export function formatQuantity(n: number, unit: string, words: TimeWords): string {
  return isTimeUnit(unit) ? formatTime(n, words) : `${grouped.format(n)} ${words.unit?.(unit, n) ?? unit}`;
}

const NUMBER = String.raw`(\d+(?:[.,]\d+)?)`;
const PATTERN = new RegExp(
  String.raw`^(?:${NUMBER}\s*h(?:oras?)?(?:\s*(\d+)\s*(?:min|mins|minutos?))?|(\d+)\s*(?:min|mins|minutos?))$`,
  "i",
);

// Minutes from «12 h», «1,5 h», «12 h 30 min», «90 min». A fraction of an
// hour is read in integers (hundredths of an hour) so no float is ever held.
export function parseTime(text: string): number | null {
  const match = PATTERN.exec(text.trim());
  if (!match) return null;
  const [, hours, minutes, onlyMinutes] = match;
  if (onlyMinutes !== undefined) return Number(onlyMinutes);
  const [whole, fraction = ""] = hours.replace(",", ".").split(".");
  if (fraction !== "" && minutes !== undefined) return null;
  // fraction / 10^k hours -> minutes = whole*60 + fraction*60 / 10^k, exact or null.
  const scaled = Number(fraction || "0") * 60;
  const unit = 10 ** fraction.length;
  if (scaled % unit !== 0) return null;
  return Number(whole) * 60 + scaled / unit + Number(minutes ?? 0);
}
