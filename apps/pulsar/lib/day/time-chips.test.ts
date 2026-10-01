import assert from "node:assert/strict";
import test from "node:test";

import { timeChipsAround } from "./time-chips";

test("a 90-minute target is the board's spread, target included", () => {
  assert.deepEqual(timeChipsAround(90), [30, 45, 60, 75, 90, 120, 150, 180]);
});

test("a 15-minute target keeps every chip above zero", () => {
  assert.deepEqual(timeChipsAround(15), [15, 45, 75, 105]);
});

test("a target under 15 minutes offers itself and the steps above", () => {
  assert.deepEqual(timeChipsAround(10), [10, 40, 70, 100]);
});

test("a 4-hour target stays at eight whole, ascending chips", () => {
  assert.deepEqual(timeChipsAround(240), [180, 195, 210, 225, 240, 270, 300, 330]);
});

test("every spread is ascending, distinct, whole and positive", () => {
  for (let target = 1; target <= 600; target++) {
    const chips = timeChipsAround(target);
    assert.ok(chips.includes(target));
    assert.ok(chips.length <= 8);
    chips.forEach((chip, i) => {
      assert.ok(Number.isInteger(chip) && chip > 0);
      if (i > 0) assert.ok(chip > chips[i - 1]);
    });
  }
});
