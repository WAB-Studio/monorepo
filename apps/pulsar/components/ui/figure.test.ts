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
  // The separator itself is `Intl`'s own call for "es" (a period, not a
  // literal space) — asserting the digits and their grouping is what proves
  // the fix; asserting one exact punctuation mark would pin an ICU detail
  // this file does not own.
  assert.match(formatted as string, /^1\D000\D039$/);
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
