import assert from "node:assert/strict";
import test from "node:test";

import { cadencePhrase, phaseLine, phasePositions } from "./row-phrases";

const names = {
  weekdayShort: ["L", "M", "X", "J", "V", "S", "D"],
  weekdayPlural: ["lunes", "martes", "miércoles", "jueves", "viernes", "sábados", "domingos"],
};
const catalogue: Record<string, string> = {
  "day.cadence.onlyWeekday": "solo los {weekday}",
  "day.cadence.timesPerWeek": "{count} veces por semana",
  "day.cadence.timesPerMonth": "{count} veces al mes",
  "day.cadence.everyNDays": "cada {n} días",
  "day.phase.of": "fase {ordinal} de {total} · {name}",
};
function translate(key: string, values: Record<string, string | number> = {}): string {
  return catalogue[key].replace(/\{(\w+)\}/g, (_, name: string) => String(values[name]));
}

test("a daily cadence and every 1 day say nothing", () => {
  assert.equal(cadencePhrase(translate, { kind: "daily" }, names), null);
  assert.equal(cadencePhrase(translate, { kind: "every_n_days", n: 1, anchor: "2026-09-01" }, names), null);
});

test("one weekday reads «solo los martes», several read their letters", () => {
  assert.equal(cadencePhrase(translate, { kind: "weekdays", days: [2] }, names), "solo los martes");
  assert.equal(cadencePhrase(translate, { kind: "weekdays", days: [6] }, names), "solo los sábados");
  assert.equal(cadencePhrase(translate, { kind: "weekdays", days: [1, 4] }, names), "L, J");
});

test("a weekly, monthly and every-n-days cadence name their count", () => {
  assert.equal(cadencePhrase(translate, { kind: "times_per_week", count: 3 }, names), "3 veces por semana");
  assert.equal(cadencePhrase(translate, { kind: "times_per_month", count: 4 }, names), "4 veces al mes");
  assert.equal(cadencePhrase(translate, { kind: "every_n_days", n: 3, anchor: "2026-09-01" }, names), "cada 3 días");
});

test("phasePositions orders each goal's phases by start, apart from other goals", () => {
  const positions = phasePositions([
    { id: "b", goalId: "g1", startsOn: "2026-10-01" },
    { id: "a", goalId: "g1", startsOn: "2026-09-01" },
    { id: "c", goalId: "g1", startsOn: "2026-11-01" },
    { id: "x", goalId: "g2", startsOn: "2026-09-15" },
  ]);
  assert.deepEqual(positions.a, { ordinal: 1, total: 3 });
  assert.deepEqual(positions.b, { ordinal: 2, total: 3 });
  assert.deepEqual(positions.c, { ordinal: 3, total: 3 });
  assert.deepEqual(positions.x, { ordinal: 1, total: 1 });
});

test("phaseLine counts phases when there are several and names alone when there is one", () => {
  assert.equal(phaseLine(translate, "desbloquear la boca", { ordinal: 1, total: 3 }), "fase 1 de 3 · desbloquear la boca");
  assert.equal(phaseLine(translate, "desbloquear la boca", { ordinal: 1, total: 1 }), "desbloquear la boca");
});
