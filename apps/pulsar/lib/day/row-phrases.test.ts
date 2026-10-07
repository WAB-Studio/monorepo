import assert from "node:assert/strict";
import test from "node:test";

import { cadencePhrase, flexibleWords, metPhrase, phaseLine, partialPair, phasePositions, rowMeta, type RowMetaPart } from "./row-phrases";

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

test("metPhrase: a met flexible says its count, and its times once past the quota", () => {
  const say = (key: string, values?: Record<string, string | number>) => `${key}:${values?.done}/${values?.total}`;
  const week = { kind: "times_per_week", count: 1 } as const;
  assert.equal(metPhrase(say, { cadence: week, periodDone: 1 }), "day.met.week:1/1");
  assert.equal(metPhrase(say, { cadence: week, periodDone: 2 }), "day.met.weekOver:2/1");
  assert.equal(metPhrase(say, { cadence: week, periodDone: 0 }), null);
  assert.equal(metPhrase(say, { cadence: week, periodDone: undefined }), null);
  assert.equal(metPhrase(say, { cadence: { kind: "times_per_month", count: 2 }, periodDone: 2 }), "day.met.month:2/2");
  assert.equal(metPhrase(say, { cadence: { kind: "daily" }, periodDone: 5 }), null);
});

test("phaseLine counts a goal with exactly two phases", () => {
  assert.equal(phaseLine(translate, "empujar", { ordinal: 1, total: 2 }), "fase 1 de 2 · empujar");
  assert.equal(phaseLine(translate, "empujar", { ordinal: 2, total: 2 }), "fase 2 de 2 · empujar");
});

test("flexibleWords: weekly speaks of the week, monthly of the month, an unknown count reads 0", () => {
  const flexible = {
    "week.flexible.week": "{count} veces por semana",
    "week.flexible.month": "{count} al mes",
    "week.flexible.weekProgress": "{done} de {total} esta semana",
    "week.flexible.monthProgress": "{done} de {total} este mes",
  } as Record<string, string>;
  const say = (key: string, values: Record<string, string | number> = {}) =>
    flexible[key].replace(/\{(\w+)\}/g, (_, name: string) => String(values[name]));

  assert.deepEqual(flexibleWords({ cadence: { kind: "times_per_week", count: 3 }, periodDone: 1 }, say), {
    cadence: "3 veces por semana",
    progress: "1 de 3 esta semana",
  });
  assert.deepEqual(flexibleWords({ cadence: { kind: "times_per_month", count: 4 }, periodDone: 3 }, say), {
    cadence: "4 al mes",
    progress: "3 de 4 este mes",
  });
  assert.equal(
    flexibleWords({ cadence: { kind: "times_per_week", count: 3 }, periodDone: null }, say)?.progress,
    "0 de 3 esta semana",
  );
  assert.equal(
    flexibleWords({ cadence: { kind: "times_per_month", count: 4 }, periodDone: null }, say)?.progress,
    "0 de 4 este mes",
  );
  assert.equal(flexibleWords({ cadence: { kind: "daily" }, periodDone: null }, say), null);
});

const rowCatalogue: Record<string, string> = {
  "day.row.saidByYou": "lo dijiste tú",
  "day.row.asksNumber": "pide el número",
  "day.row.partialAmount": "{logged} de {target}",
};
const rowTranslate = (key: string, values: Record<string, string | number> = {}) =>
  rowCatalogue[key].replace(/\{(\w+)\}/g, (_, name: string) => String(values[name]));
const line = (parts: RowMetaPart[] | undefined) => parts?.map((part) => ("figure" in part ? part.figure : part.text)).join("");
const figures = (parts: RowMetaPart[] | undefined) => parts?.flatMap((part) => ("figure" in part ? [part.figure] : []));
const base = {
  kind: "tap" as const,
  done: false,
  quiet: false,
  cadenceText: null,
  amount: "10 min",
  status: null,
  writtenTime: undefined,
  writtenLabel: undefined,
};

test("a done tap or quantity row says «lo dijiste tú» after its hour", () => {
  assert.equal(line(rowMeta(rowTranslate, { ...base, done: true, writtenTime: "07:40" })), "10 min · 07:40 · lo dijiste tú");
  assert.equal(
    line(rowMeta(rowTranslate, { ...base, kind: "quantity", done: true, amount: "25 minutos", writtenTime: "07:40", writtenLabel: "anotado el lunes 21" })),
    "25 minutos · 07:40 · lo dijiste tú · anotado el lunes 21",
  );
});

test("an unmarked quantity row says «pide el número» right after its target, before progress", () => {
  assert.equal(line(rowMeta(rowTranslate, { ...base, kind: "quantity", amount: "3 min" })), "3 min · pide el número");
  assert.equal(
    line(rowMeta(rowTranslate, { ...base, kind: "quantity", amount: "3 min", status: "0 de 3 esta semana" })),
    "3 min · pide el número · 0 de 3 esta semana",
  );
});

test("an unmarked tap row says neither", () => {
  assert.equal(line(rowMeta(rowTranslate, base)), "10 min");
});

test("an evidence row says neither, done or not", () => {
  assert.equal(line(rowMeta(rowTranslate, { ...base, kind: "evidence", amount: "Anki", done: true, writtenTime: "07:40" })), "Anki · 07:40");
  assert.equal(line(rowMeta(rowTranslate, { ...base, kind: "evidence", amount: "Anki" })), "Anki");
});

test("a quiet row says neither", () => {
  assert.equal(line(rowMeta(rowTranslate, { ...base, quiet: true, done: true, status: "cumplida esta semana · 1 de 1" })), "10 min · cumplida esta semana · 1 de 1");
  assert.equal(line(rowMeta(rowTranslate, { ...base, kind: "quantity", quiet: true })), "10 min");
});

const partial = { logged: "1 min", target: "3 min" };

test("a quantity row logged under its target reads what it holds, its hour and «lo dijiste tú»", () => {
  const row = { ...base, kind: "quantity" as const, amount: "3 min", writtenTime: "09:22", partial };
  assert.equal(line(rowMeta(rowTranslate, row)), "1 min de 3 min · 09:22 · lo dijiste tú");
  assert.equal(
    line(rowMeta(rowTranslate, { ...row, writtenLabel: "anotado el lunes 21" })),
    "1 min de 3 min · 09:22 · lo dijiste tú · anotado el lunes 21",
  );
});

test("a partial row never asks for the number again", () => {
  const meta = line(rowMeta(rowTranslate, { ...base, kind: "quantity", amount: "3 min", writtenTime: "09:22", partial }));
  assert.equal(meta?.includes("pide el número"), false);
});

test("a partial quiet or evidence row keeps its own line", () => {
  assert.equal(line(rowMeta(rowTranslate, { ...base, kind: "quantity", quiet: true, partial })), "10 min");
  assert.equal(line(rowMeta(rowTranslate, { ...base, kind: "evidence", amount: "Anki", partial })), "Anki");
});

test("a partial row sets only its figures and times apart: the words stay text", () => {
  const row = { ...base, kind: "quantity" as const, amount: "10 min", writtenTime: "17:15", partial: { logged: "5", target: "10 min" } };
  const parts = rowMeta(rowTranslate, row);
  assert.deepEqual(figures(parts), ["5", "10 min", "17:15"]);
  assert.equal(line(parts), "5 de 10 min · 17:15 · lo dijiste tú");
  assert.deepEqual(parts?.filter((part) => "text" in part).map((part) => (part as { text: string }).text), [
    " de ",
    " · ",
    " · ",
    "lo dijiste tú",
  ]);
});

test("an unmarked quantity row draws its target as a figure and «pide el número» as text", () => {
  const parts = rowMeta(rowTranslate, { ...base, kind: "quantity", amount: "3 min" });
  assert.deepEqual(figures(parts), ["3 min"]);
});

test("an evidence source and a status are text, never a figure", () => {
  assert.deepEqual(figures(rowMeta(rowTranslate, { ...base, kind: "evidence", amount: "Anki", status: "1 de 3 esta semana" })), []);
});

test("a partial in kilometres says the unit once; a time pair is as it was", () => {
  assert.deepEqual(partialPair("7 kilómetros", "90 kilómetros", "kilómetros"), { logged: "7", target: "90 kilómetros" });
  assert.deepEqual(partialPair("1 kilómetro", "90 kilómetros", "kilómetros"), { logged: "1", target: "90 kilómetros" });
  assert.deepEqual(partialPair("5 min", "10 min", "min"), { logged: "5", target: "10 min" });
  assert.deepEqual(partialPair("1 h 05 min", "2 h", "min"), { logged: "1 h 05 min", target: "2 h" });
});
