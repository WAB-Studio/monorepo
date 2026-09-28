import type { Page } from "@playwright/test";
import type postgres from "postgres";

import { test, expect } from "./fixtures";

// Opens `/metas/nueva`, the least it takes to open a goal (RP-11) — the same
// helper `compromiso.spec.ts` and `varias-metas.spec.ts` each keep their own
// copy of, never a shared import: an e2e file owns its own fixtures.
async function createGoal(page: Page, name: string): Promise<string> {
  await page.goto("/metas/nueva");
  await page.getByLabel("nombre").fill(name);
  await page.getByRole("button", { name: "Abrirla" }).click();
  await page.waitForURL(/\/metas\/[0-9a-f-]{36}$/);
  return page.url().split("/metas/")[1];
}

// The goal's own way into a phase (docs/pulsar/DESIGN.md "A goal adds a
// commitment from its own screen" — the same pattern, a phase): a real tap
// on the goal's own button, never a bare `page.goto`.
async function openNewPhaseForm(page: Page, goalId: string): Promise<void> {
  await page.goto(`/metas/${goalId}`);
  await page.getByRole("link", { name: "Añadir una fase" }).click();
  await page.waitForURL(`**/metas/${goalId}/fases/nueva`);
}

async function openNewCommitmentForm(page: Page, goalId: string): Promise<void> {
  await page.goto(`/metas/${goalId}`);
  await page.getByRole("link", { name: "Añadir un compromiso" }).click();
  await page.waitForURL(`**/metas/${goalId}/compromisos/nuevo`);
}

async function phaseCount(db: postgres.Sql, goalId: string): Promise<number> {
  const [row] = await db<{ count: string }[]>`
    select count(*)::text as count from goals.phases where goal_id = ${goalId}
  `;
  return Number(row.count);
}

// `goals.phases` grants no DELETE (`scripts/check-policies.ts`'s own P38):
// every phase this spec writes stays forever, so this goal is created and
// left standing, never deleted — unlike every other spec's own `deleteGoal`,
// which would otherwise cascade a delete this app can never undo through its
// own doors. Dates are relative to this goal's own opening (today, for a
// goal just created), so a rerun's own fresh goal never collides with a past
// run's phases: each run's weeks are counted from its own goal, never a
// shared one.
test("a goal gains its phases one span at a time: none, then one, a second prefilled after it, and a third refused for overlapping", async ({
  page,
  db,
}) => {
  const goalName = `Meta fases ${Date.now()}`;
  const firstAim = `Primer objetivo ${Date.now()}`;
  const secondAim = `Segundo objetivo ${Date.now()}`;
  const goalId = await createGoal(page, goalName);

  // No phase yet: the way in is solid, the only thing this screen asks for.
  const addPhaseLink = page.getByRole("link", { name: "Añadir una fase" });
  await expect(addPhaseLink).toBeVisible();
  await expect(addPhaseLink).toHaveClass(/\bsolid\b/);

  // A goal just opened has nothing before it: the first span defaults to
  // weeks 1–4, counted from its own opening (today).
  await openNewPhaseForm(page, goalId);
  await expect(page.getByLabel("desde la semana")).toHaveValue("1");
  await expect(page.getByLabel("hasta la semana")).toHaveValue("4");
  await page.getByLabel("qué busca").fill(firstAim);
  await page.getByRole("button", { name: "Añadirla" }).click();
  await page.waitForURL(`**/metas/${goalId}`);

  await expect(page.getByText(firstAim)).toBeVisible();
  await expect(page.getByText("semanas 1–4")).toBeVisible();
  expect(await phaseCount(db, goalId)).toBe(1);

  // The day this phase covers names it (RP-15): a goal's own opening day
  // falls in week 1, so today's screen reads this phase's own aim.
  await page.goto("/");
  await expect(page.getByText(firstAim)).toBeVisible();

  // With one phase in effect, the way in is no longer the only thing this
  // screen asks for.
  await page.goto(`/metas/${goalId}`);
  await expect(addPhaseLink).toHaveClass(/\boutline\b/);

  // A second phase prefills right after the first one's own end — week 5,
  // four weeks long — never a week the first phase already covers.
  await openNewPhaseForm(page, goalId);
  await expect(page.getByLabel("desde la semana")).toHaveValue("5");
  await expect(page.getByLabel("hasta la semana")).toHaveValue("8");
  await page.getByLabel("qué busca").fill(secondAim);
  await page.getByRole("button", { name: "Añadirla" }).click();
  await page.waitForURL(`**/metas/${goalId}`);

  await expect(page.getByText(secondAim)).toBeVisible();
  await expect(page.getByText("semanas 5–8")).toBeVisible();
  expect(await phaseCount(db, goalId)).toBe(2);

  // Weeks 3–6 share days with both spans already on the goal (1–4 and
  // 5–8): the day would no longer name a single phase, so this is refused
  // on screen, with no navigation and no third row written.
  await openNewPhaseForm(page, goalId);
  await page.getByLabel("qué busca").fill(`Objetivo rechazado ${Date.now()}`);
  await page.getByLabel("desde la semana").fill("3");
  await page.getByLabel("hasta la semana").fill("6");
  await page.getByRole("button", { name: "Añadirla" }).click();

  await expect(page.getByText("Esas semanas ya tienen una fase. Elige otras.")).toBeVisible();
  expect(page.url()).toContain(`/metas/${goalId}/fases/nueva`);
  expect(await phaseCount(db, goalId)).toBe(2);
});

// The goal's own header (`commitment-list.tsx`'s section label) counts what
// is still active, never the whole history the list itself keeps (RP-13):
// no phase involved, so this goal is deleted at the end like `compromiso.
// spec.ts`'s own commitment specs.
test("the goal's own commitment count drops when one is retired, though the row itself stays in the list", async ({
  page,
  db,
  personId,
}) => {
  const goalName = `Meta conteo ${Date.now()}`;
  const commitmentName = `Compromiso a contar ${Date.now()}`;
  const goalId = await createGoal(page, goalName);

  try {
    await openNewCommitmentForm(page, goalId);
    await page.getByLabel("qué es").fill(commitmentName);
    await page.getByRole("button", { name: "Añadirlo" }).click();
    await page.waitForURL(`**/metas/${goalId}`);

    await expect(page.getByText("un compromiso", { exact: true })).toBeVisible();

    const row = page.locator("button", { hasText: commitmentName });
    await row.click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("button", { name: "Retirarlo" }).click();
    await expect(sheet).toBeHidden();

    await expect(page.getByText("cero compromisos", { exact: true })).toBeVisible();
    await expect(page.getByText("un compromiso", { exact: true })).not.toBeVisible();
    // Retired, never hidden (RP-13): the row itself stays, marked, out of
    // the count above it.
    await expect(row).toContainText("retirado");
  } finally {
    await db`delete from goals.goals where id = ${goalId} and user_id = ${personId}`;
  }
});
