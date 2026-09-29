import type { Page } from "@playwright/test";
import type postgres from "postgres";

import { weekSpan } from "@/lib/day/weeks";
import { civilDateInZone, civilDateToDate, dateToCivilDate, todayInZone, weekOf } from "@/lib/zone";

import { test, expect, laneNumber } from "./fixtures";

// The civil day `days` after `openedOn`, in the same midday-UTC arithmetic
// `weekSpan` itself runs (`lib/day/weeks.ts`) — never a second, independent
// calculation of what a week's own start day is.
function dayAfter(openedOn: string, days: number): string {
  const date = civilDateToDate(openedOn);
  date.setUTCDate(date.getUTCDate() + days);
  return dateToCivilDate(date);
}

// The Wednesday of the week two Mondays back: `today` always sits in week 3
// (RP-17), whatever weekday the spec runs on, and week 1 is partial. Every
// week's own start comes from `weekSpan`, never a fixed count of days.
const OPENED_WEEKDAY_OFFSET = 2;
const WEEK1_TOTAL = 12;
const WEEK2_TOTAL = 9;
// Week 3 (today's own) gets no fact at all: the zero `measureByWeek` must
// still draw, on the same row `current` marks.

async function createGoal(page: Page, name: string): Promise<string> {
  await page.goto("/metas/nueva");
  await page.getByLabel("nombre").fill(name);
  await page.getByRole("button", { name: "Abrirla" }).click();
  await page.waitForURL(/\/metas\/[0-9a-f-]{36}$/);
  return page.url().split("/metas/")[1];
}

// The goal's own way in (docs/pulsar/DESIGN.md "A goal adds a commitment
// from its own screen"): a real tap on the list's own link, never a bare
// `page.goto` to the form's route.
async function addQuantityCommitment(
  page: Page,
  goalId: string,
  name: string,
  unit: string,
  target: number,
): Promise<void> {
  await page.goto(`/metas/${goalId}`);
  await page.getByRole("link", { name: "Añadir un compromiso" }).click();
  await page.waitForURL(`**/metas/${goalId}/compromisos/nuevo`);

  await page.getByLabel("qué es").fill(name);
  await page.getByRole("button", { name: "un número", exact: true }).click();
  await page.getByLabel("cantidad").fill(String(target));
  await page.getByLabel("unidad").fill(unit);
  await page.getByRole("button", { name: "Añadirlo" }).click();
  await page.waitForURL(`**/metas/${goalId}`);
}

async function commitmentId(db: postgres.Sql, personId: string, name: string): Promise<string> {
  const [row] = await db<{ id: string }[]>`
    select id from goals.commitments where user_id = ${personId} and name = ${name}
  `;
  if (!row) throw new Error(`no commitment named "${name}" for ${personId}`);
  return row.id;
}

async function deleteGoal(db: postgres.Sql, personId: string, goalId: string): Promise<void> {
  await db`delete from goals.goals where id = ${goalId} and user_id = ${personId}`;
}

test("a goal opened on a Wednesday two weeks back draws its measure week by week, the current week's zero included (RP-17)", async ({
  page,
  db,
  personId,
}) => {
  const lane = laneNumber();
  const goalName = `Meta revisión ${lane} ${Date.now()}`;
  const measureName = `Medida revisión ${lane} ${Date.now()}`;
  const unit = "minutos";
  const goalId = await createGoal(page, goalName);

  try {
    await addQuantityCommitment(page, goalId, measureName, unit, 5);

    // The way in (`Meta.dc.html` draws none, the coordinator's own decision):
    // a ghost link under the measure figure, only once the goal has one.
    await page.goto(`/metas/${goalId}`);
    const wayIn = page.getByRole("link", { name: "Ver por semana" });
    await expect(wayIn).toBeVisible();
    await expect(wayIn).toHaveClass(/\bghost\b/);
    await expect(wayIn).toHaveAttribute("href", `/metas/${goalId}/revision`);

    const id = await commitmentId(db, personId, measureName);

    // `created_at` carries no grant to `authenticated` at all
    // (`db/schema/goals.ts`): the session pooler is the only door onto it,
    // the same one `scripts/check-goal.ts`'s own `runWeeksCheck` uses.
    const openedOn = dayAfter(weekOf(todayInZone())[0], -14 + OPENED_WEEKDAY_OFFSET);
    const openedDaysBack =
      (civilDateToDate(todayInZone()).getTime() - civilDateToDate(openedOn).getTime()) / 86_400_000;
    const backdatedAt = new Date(Date.now() - openedDaysBack * 86_400_000);
    await db`update goals.goals set created_at = ${backdatedAt} where id = ${goalId} and user_id = ${personId}`;
    expect(civilDateInZone(backdatedAt)).toBe(openedOn);

    // Facts in two of the three weeks (week 1's own opening day, week 2's
    // own opening day); week 3, today's own, gets none.
    await db`
      insert into goals.facts (user_id, commitment_id, goal_id, day, quantity)
      values
        (${personId}, ${id}, ${goalId}, ${openedOn}, ${WEEK1_TOTAL}),
        (${personId}, ${id}, ${goalId}, ${weekSpan(openedOn, 2, 2).startsOn}, ${WEEK2_TOTAL})
    `;

    await page.goto(`/metas/${goalId}/revision`);

    // Header: the goal's own name as the kicker, the measure's unit as the
    // one heading — a `<p>` each, so the wide table's own `<th>` repeating
    // the same string never collides with this lookup.
    await expect(page.locator("p", { hasText: goalName })).toHaveCount(1);
    await expect(page.locator("p", { hasText: unit })).toHaveCount(1);
    await expect(page.getByText("la única cifra que predice el progreso")).toHaveCount(0);

    // The phone face, `Revision.dc.html`: three rows, the lead figure and
    // the note alone, «0» drawn rather than hidden, «en curso» on the one
    // row with nothing.
    const items = page.getByRole("listitem");
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toContainText("semana 1");
    await expect(items.nth(0)).toContainText(String(WEEK1_TOTAL));
    await expect(items.nth(1)).toContainText("semana 2");
    await expect(items.nth(1)).toContainText(String(WEEK2_TOTAL));
    await expect(items.nth(2)).toContainText("semana 3");
    await expect(items.nth(2)).toContainText("0");
    await expect(items.nth(2)).toContainText("en curso");
    await expect(items.nth(0)).not.toContainText("en curso");
    await expect(items.nth(1)).not.toContainText("en curso");
    await expect(page.locator("li[data-current]")).toHaveCount(1);
    await expect(items.nth(2)).toHaveAttribute("data-current", "");

    // RNP-07: nothing overflows the 360px viewport this project already runs.
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(360);

    // `RevisionEscritorio.dc.html`: the same rows, a real `<table>`, widened
    // past the kit's usual 640px cap.
    await page.setViewportSize({ width: 1280, height: 900 });
    const table = page.getByRole("table");
    await expect(table).toBeVisible();
    const rows = table.getByRole("row");
    await expect(rows).toHaveCount(4); // the header row plus three weeks

    const week1Row = rows.nth(1);
    await expect(week1Row.getByRole("cell").nth(0)).toContainText("semana 1");
    await expect(week1Row.getByRole("cell").nth(1)).toHaveText(String(WEEK1_TOTAL));
    await expect(week1Row).not.toHaveAttribute("data-current", "");

    const week3Row = rows.nth(3);
    await expect(week3Row.getByRole("cell").nth(0)).toContainText("semana 3");
    await expect(week3Row.getByRole("cell").nth(1)).toHaveText("0");
    await expect(week3Row.getByRole("cell").nth(3)).toHaveText("en curso");
    await expect(week3Row).toHaveAttribute("data-current", "");

    const pageWidth = await page.evaluate(() => document.querySelector("main")?.getBoundingClientRect().width);
    expect(pageWidth).toBeGreaterThan(640);
  } finally {
    await deleteGoal(db, personId, goalId);
  }
});

test("a goal with no measure yet says so on its review, with no way in and no table (RP-17, §0.3 3)", async ({
  page,
  db,
  personId,
}) => {
  const lane = laneNumber();
  const goalName = `Meta revisión sin medida ${lane} ${Date.now()}`;
  const goalId = await createGoal(page, goalName);

  try {
    await page.goto(`/metas/${goalId}`);
    await expect(page.getByRole("link", { name: "Ver por semana" })).toHaveCount(0);

    await page.goto(`/metas/${goalId}/revision`);
    await expect(page.getByText("Esta meta todavía no tiene cifra.")).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(page.getByRole("listitem")).toHaveCount(0);

    await page.getByRole("link", { name: "Volver a la meta" }).click();
    await page.waitForURL(`**/metas/${goalId}`);
  } finally {
    await deleteGoal(db, personId, goalId);
  }
});

test("a goal id that resolves to nothing 404s the review, never a blank screen", async ({ page }) => {
  await page.goto("/metas/00000000-0000-0000-0000-000000000000/revision");
  await expect(page.getByRole("heading", { name: "Esta página no existe" })).toBeVisible();
});

test("an id that is no uuid 404s the review on a live database, never the failure page", async ({ page }) => {
  await page.goto("/metas/not-a-uuid/revision");
  await expect(page.getByRole("heading", { name: "Esta página no existe" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No se pudo abrir" })).toHaveCount(0);
});
