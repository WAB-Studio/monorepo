import { isTimeUnit } from "@/lib/units/time";

// The name to print before «, en {unit}», or null when it only repeats the unit:
// the unit itself, one of its words, or any word for time.
export function distinctMeasureName(
  name: string | null,
  unit: string,
  unitWords: readonly string[],
): string | null {
  if (name === null) return null;
  const clean = name.trim().toLowerCase();
  if (clean === "") return null;
  const same = [unit, ...unitWords].some((word) => word.trim().toLowerCase() === clean);
  return same || isTimeUnit(clean) ? null : name;
}
