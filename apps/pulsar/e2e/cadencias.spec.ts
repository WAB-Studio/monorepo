import type { Page } from "@playwright/test";
import type postgres from "postgres";

import { test, expect } from "./fixtures";

// `compromiso.spec.ts` already drives "daily" (the form's own default) and
// "weekdays" through the screen; this file drives the two RP-12 gave the
// form's board a chip for and this suite had not yet touched — "N veces a la
// semana" and "cada N días" — plus the one cadence the board never offers a
// chip for at all, "N veces al mes" (decided by the user 2026-09-27), proved
// by a row seeded under the spec's own identity rather than typed on screen.

type CommitmentRow = {
  id: string;
  cadence_kind: string;
  cadence_n: number | null;
};

async function commitmentByName(
  db: postgres.Sql,
  personId: string,
  name: string,
): Promise<CommitmentRow | null> {
  const [row] = await db<CommitmentRow[]>`
    select id, cadence_kind, cadence_n
    from goals.commitments
    where user_id = ${personId} and name = ${name}
  `;
  return row ?? null;
}

// Copied from `compromiso.spec.ts`: the least it takes to open a goal
// (RP-11), landing on the goal's own screen where `commitment-list.tsx`'s
// own button into `CompromisoNuevo.dc.html` lives.
async function createGoal(page: Page, name: string): Promise<string> {
  await page.goto("/metas/nueva");
  await page.getByLabel("nombre").fill(name);
  await page.getByRole("button", { name: "Abrirla" }).click();
  await page.waitForURL(/\/metas\/[0-9a-f-]{36}$/);
  return page.url().split("/metas/")[1];
}

async function openNewCommitmentForm(page: Page, goalId: string): Promise<void> {
  await page.goto(`/metas/${goalId}`);
  await page.getByRole("link", { name: "Añadir un compromiso" }).click();
  await page.waitForURL(`**/metas/${goalId}/compromisos/nuevo`);
}

// Same cascade `compromiso.spec.ts` relies on (`db/schema/goals.ts`,
// `commitments.ts`, `facts.ts`): one statement leaves no commitment, fact or
// seeded row of this spec's own behind.
async function deleteGoal(db: postgres.Sql, personId: string, goalId: string): Promise<void> {
  await db`delete from goals.goals where id = ${goalId} and user_id = ${personId}`;
}

test("a «N veces a la semana» commitment created through CompromisoNuevo lands in goals.commitments, reads on the goal with its cadence line, and asks on the day it was created (RP-12)", async ({
  page,
  db,
  personId,
}) => {
  const goalName = `Meta N por semana ${Date.now()}`;
  const commitmentName = `Compromiso N por semana ${Date.now()}`;
  const goalId = await createGoal(page, goalName);

  try {
    await openNewCommitmentForm(page, goalId);
    await page.getByLabel("qué es").fill(commitmentName);
    await page.getByRole("button", { name: "N por semana", exact: true }).click();
    await page.getByLabel("veces por semana").fill("3");
    await page.getByRole("button", { name: "Añadirlo" }).click();
    await page.waitForURL(`**/metas/${goalId}`);

    const commitment = await commitmentByName(db, personId, commitmentName);
    expect(commitment).not.toBeNull();
    expect(commitment!.cadence_kind).toBe("times_per_week");
    expect(commitment!.cadence_n).toBe(3);

    // The goal screen's own words for it (`commitment-list.tsx`'s
    // `cadenceWords`, `goal.cadence.timesPerWeek`): read back, never asserted
    // from the row alone.
    await expect(page.getByText("3 veces por semana")).toBeVisible();

    // Nothing done yet this week, so the quota is not met: today asks for it
    // (`asksOn`'s own "times_per_week" branch).
    await page.goto("/");
    await expect(page.locator("button", { hasText: commitmentName })).toBeVisible();
  } finally {
    await deleteGoal(db, personId, goalId);
  }
});

test("a «cada N días» commitment created through CompromisoNuevo lands in goals.commitments, reads on the goal with its cadence line, and asks on the day it was created (RP-12)", async ({
  page,
  db,
  personId,
}) => {
  const goalName = `Meta cada N días ${Date.now()}`;
  const commitmentName = `Compromiso cada N días ${Date.now()}`;
  const goalId = await createGoal(page, goalName);

  try {
    await openNewCommitmentForm(page, goalId);
    await page.getByLabel("qué es").fill(commitmentName);
    await page.getByRole("button", { name: "cada N días", exact: true }).click();
    await page.getByLabel("cada cuántos días").fill("4");
    await page.getByRole("button", { name: "Añadirlo" }).click();
    await page.waitForURL(`**/metas/${goalId}`);

    const commitment = await commitmentByName(db, personId, commitmentName);
    expect(commitment).not.toBeNull();
    expect(commitment!.cadence_kind).toBe("every_n_days");
    expect(commitment!.cadence_n).toBe(4);

    await expect(page.getByText("cada 4 días")).toBeVisible();

    // `commitments.created_at` is the anchor (RP-12); the day it was created
    // is the anchor day itself, and `asksOn`'s "every_n_days" branch asks on
    // the anchor no matter what `n` is.
    await page.goto("/");
    await expect(page.locator("button", { hasText: commitmentName })).toBeVisible();
  } finally {
    await deleteGoal(db, personId, goalId);
  }
});

test("«N veces al mes» offers no chip on CompromisoNuevo, and a commitment stored with that cadence still reads on the goal (RP-12, decided 2026-09-27)", async ({
  page,
  db,
  personId,
}) => {
  const goalName = `Meta N al mes ${Date.now()}`;
  const commitmentName = `Compromiso N al mes ${Date.now()}`;
  const goalId = await createGoal(page, goalName);

  try {
    await openNewCommitmentForm(page, goalId);

    // The board draws four cadence chips, never a fifth: scoped to the
    // "cada cuándo" section so a chip elsewhere on the form (the "doneBy"
    // section has none naming a month) can never be counted by accident.
    const cadenceSection = page.locator("section", { hasText: "cada cuándo" });
    await expect(cadenceSection.getByRole("button")).toHaveCount(4);
    await expect(cadenceSection.getByRole("button", { name: /mes/i })).toHaveCount(0);

    // No row from the screen — seeded directly, the only way a
    // `times_per_month` row is ever written today.
    await db`
      insert into goals.commitments (user_id, goal_id, name, cadence_kind, cadence_n, satisfaction)
      values (${personId}, ${goalId}, ${commitmentName}, 'times_per_month', 5, 'tap')
    `;

    await page.goto(`/metas/${goalId}`);
    await expect(page.getByText(commitmentName)).toBeVisible();
    // `commitment-list.tsx`'s `goal.cadence.timesPerMonth`: the stored count
    // reads back, not a placeholder.
    await expect(page.getByText("5 veces al mes")).toBeVisible();
  } finally {
    await deleteGoal(db, personId, goalId);
  }
});
