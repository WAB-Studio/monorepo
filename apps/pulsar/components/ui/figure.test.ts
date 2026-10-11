import assert from "node:assert/strict";
import test from "node:test";

import { formatFigureValue } from "./format-figure";

// A goal's measure is a bare integer sum (RP-14): the mutation this guards
// against is `figure.tsx` going back to handing `value` straight to JSX,
// which reads `1000039` with nothing to break it into groups.
test("a large number reads with its groups separated, never as one run of digits", () => {
  const formatted = formatFigureValue(1_000_039);
  assert.equal(typeof formatted, "string");
  assert.notEqual(formatted, "1000039");
  // The exact string pins the locale: "en-US" groups in threes too.
  assert.equal(formatted, "1.000.039");
});

test("a small number still reads with no separator to insert", () => {
  assert.equal(formatFigureValue(7), "7");
});

test("zero reads as \"0\", not an empty string", () => {
  assert.equal(formatFigureValue(0), "0");
});

test("a value that is not a number — already-worded text a caller built — draws untouched", () => {
  assert.equal(formatFigureValue("55 búsquedas"), "55 búsquedas");
});

// The catalogue's own shape (`messages/es/units.json`), so the test needs no
// translator and still reads what the screen reads.
const words = {
  h: (h: string) => `${h} h`,
  min: (min: string) => `${min} min`,
  join: (h: string, min: string) => `${h} ${min}`,
};

test("750 in «minutos» comes back as 12 h and 30 min, each figure followed by its word (RP-35)", () => {
  assert.deepEqual(formatFigureValue(750, "minutos", words), {
    kind: "time",
    tokens: [
      { text: "12", figure: true },
      { text: "h", figure: false },
      { text: "30", figure: true },
      { text: "min", figure: false },
    ],
  });
});

test("an exact hour and an hour count past a thousand keep 145's own rules (RP-35)", () => {
  assert.deepEqual(formatFigureValue(120, "min", words), {
    kind: "time",
    tokens: [
      { text: "2", figure: true },
      { text: "h", figure: false },
    ],
  });
  assert.deepEqual(formatFigureValue(1234 * 60 + 5, "Minutos", words), {
    kind: "time",
    tokens: [
      { text: "1.234", figure: true },
      { text: "h", figure: false },
      { text: "05", figure: true },
      { text: "min", figure: false },
    ],
  });
});

test("750 in «páginas» reads «750», as before", () => {
  assert.equal(formatFigureValue(750, "páginas", words), "750");
});

test("a time unit with no words to print it in reads as a plain number", () => {
  assert.equal(formatFigureValue(750, "minutos"), "750");
});

test("a string value in a time unit passes through untouched", () => {
  assert.equal(formatFigureValue("12 h 30 min", "minutos", words), "12 h 30 min");
});
