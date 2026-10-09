import assert from "node:assert/strict";
import test from "node:test";

import { scan, type Allowed } from "./check-e2e-static";

const lines = (...l: string[]) => [{ name: "x.spec.ts", text: ["test(\"a\", async ({ page }) => {", ...l, "});"].join("\n") }];
const run = (l: string[], allowed: Allowed[] = []) => scan(lines(...l), allowed);

const MEASURE = "  const b = await page.locator(\"h1\").boundingBox();";

// campo-chip.spec.ts:44-52 with `visit(` swapped for a bare `goto`.
const CAMPO_CHIP = [
  "  await page.goto(goalUrl.replace(/\\/metas\\/.*/, \"/conexiones\"));",
  "  const gap = await page.evaluate(() => {",
  "    const hint = [...document.querySelectorAll(\"span\")].find((s) => /para reconocerla/i.test(s.textContent ?? \"\"));",
  "    const next = hint?.closest(\"form, div\")?.nextElementSibling ?? hint?.parentElement?.nextElementSibling;",
  "    if (!hint || !next) return null;",
  "    return next.getBoundingClientRect().top - hint.getBoundingClientRect().bottom;",
  "  });",
  "  expect(gap).not.toBeNull();",
];

test("campo-chip's hint gap without its anchor fails; with visit it passes", () => {
  assert.equal(run(CAMPO_CHIP).violations.length, 1);
  assert.equal(run(CAMPO_CHIP).violations[0].line, 7);
  const anchored = [...CAMPO_CHIP];
  anchored[0] = "  await visit(page, \"/conexiones\");";
  assert.equal(run(anchored).violations.length, 0);
});

for (const nav of ["await page.goto(\"/hoy\");", "await page.waitForURL(/\\/metas$/);", "await page.reload();"]) {
  test(`${nav.split("(")[0]} arms the check`, () => {
    assert.equal(run([`  ${nav}`, MEASURE]).violations.length, 1);
  });
}

for (const anchor of [
  "await expect(page.locator(\"main\")).toBeVisible();",
  "await settled(page);",
  "await visit(page, \"/hoy\");",
]) {
  test(`${anchor.split("(")[0]} clears it`, () => {
    assert.equal(run(["  await page.goto(\"/hoy\");", `  ${anchor}`, MEASURE]).violations.length, 0);
  });
}

test("a read with no navigation before it is fine", () => {
  assert.equal(run([MEASURE]).violations.length, 0);
});

test("a new test starts unarmed", () => {
  const text = ["test(\"a\", async () => {", "  await page.goto(\"/\");", "});", "test(\"b\", async () => {", MEASURE, "});"].join("\n");
  assert.equal(scan([{ name: "x.spec.ts", text }], []).violations.length, 0);
});

test("a comment is not a read", () => {
  assert.equal(run(["  await page.goto(\"/\");", "  // getBoundingClientRect comes later"]).violations.length, 0);
});

test("an allowlist entry hides the violation it names", () => {
  const allowed = [{ file: "x.spec.ts", line: 3, why: "reason" }];
  const out = run(["  await page.goto(\"/\");", MEASURE], allowed);
  assert.equal(out.violations.length, 0);
  assert.equal(out.stale.length, 0);
});

test("an allowlist entry that matches nothing is stale", () => {
  const allowed = [{ file: "x.spec.ts", line: 99, why: "reason" }];
  const out = run(["  await page.goto(\"/\");", MEASURE], allowed);
  assert.equal(out.violations.length, 1);
  assert.deepEqual(out.stale, allowed);
});
