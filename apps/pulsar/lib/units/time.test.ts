import assert from "node:assert/strict";
import test from "node:test";

import { formatQuantity, formatTime, isTimeUnit, parseTime, splitMinutes } from "./time";

const words = {
  h: (h: string) => `${h} h`,
  min: (min: string) => `${min} min`,
  join: (h: string, min: string) => `${h} ${min}`,
};

test("the four words for a minute are time, trimmed and in any case", () => {
  for (const u of ["minutos", "minuto", "min", "mins", " Min ", "MINUTOS"]) {
    assert.equal(isTimeUnit(u), true, u);
  }
});

test("any other word, and null, is not time", () => {
  for (const u of ["horas", "páginas", "búsquedas", "", "m"]) {
    assert.equal(isTimeUnit(u), false, u);
  }
  assert.equal(isTimeUnit(null), false);
});

test("minutes split into whole hours and the rest", () => {
  assert.deepEqual(splitMinutes(90), { h: 1, min: 30 });
  assert.deepEqual(splitMinutes(59), { h: 0, min: 59 });
});

test("minutes print as the words say", () => {
  const cases: [number, string][] = [
    [0, "0 min"],
    [45, "45 min"],
    [60, "1 h"],
    [90, "1 h 30 min"],
    [720, "12 h"],
    [750, "12 h 30 min"],
    [74040, "1.234 h"],
  ];
  for (const [n, out] of cases) assert.equal(formatTime(n, words), out, String(n));
});

test("hours are floored, never a decimal", () => {
  assert.equal(formatTime(90, words), "1 h 30 min");
});

test("a quantity in a time unit prints in hours, any other as today", () => {
  assert.equal(formatQuantity(750, "minutos", words), "12 h 30 min");
  assert.equal(formatQuantity(12, "páginas", words), "12 páginas");
  assert.equal(formatQuantity(1234, "páginas", words), "1.234 páginas");
});

test("a text of hours and minutes reads back into minutes", () => {
  const cases: [string, number][] = [
    ["12 h", 720],
    ["1,5 h", 90],
    ["1.5 h", 90],
    ["1,25 h", 75],
    ["12 h 30 min", 750],
    ["90 min", 90],
    ["2h", 120],
    ["0 h", 0],
  ];
  for (const [text, n] of cases) assert.equal(parseTime(text), n, text);
});

test("a fraction that is not whole minutes, and anything else, is null", () => {
  for (const t of ["1,33 h", "hola", "", "12", "h", "1,5 h 30 min", "-2 h"]) {
    assert.equal(parseTime(t), null, t);
  }
});
