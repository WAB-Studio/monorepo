import type { Page } from "@playwright/test";
import type postgres from "postgres";

import { test, expect, type Person } from "./fixtures";
import { civilDateToDate, dateToCivilDate, todayInZone } from "../lib/zone";

// Against `PULSAR_FAULT_BASE_URL`: a `next start` of the same build with
// `PULSAR_FAULT_SEAM=reading_lookups`, so every read of that source rejects
// and each screen draws RNP-04's notice over what the person declared. The
// control drives the same seed on `PULSAR_BASE_URL`, the ordinary server.
const LIVE = process.env.PULSAR_BASE_URL ?? "http://localhost:3200";

const DAY_NOTE = "No pudimos leer una fuente. Lo que declaraste hoy sigue aquí.";
const WEEK_NOTE = "No pudimos leer una fuente. Lo declarado esta semana sigue aquí.";
const GOAL_NOTE = "No pudimos leer una fuente. Lo declarado sigue aquí.";
const FAILURE = "No se pudo abrir";

// `Semana.dc.html`'s own weekday order, read back here rather than imported.
const WEEKDAY_SHORT = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

function weekRowLabel(civilDay: string): string {
  const weekdayIndex = (new Date(`${civilDay}T12:00:00Z`).getUTCDay() + 6) % 7;
  return `${WEEKDAY_SHORT[weekdayIndex]} ${Number(civilDay.slice(8, 10))}`;
}

type Seed = { goalId: string; goalName: string; tapName: string; today: string };

// A goal with a measure, a tap commitment declared today and an evidence one
// on `reading_lookups`. Nothing under `reading.*` is written.
async function seed(db: postgres.Sql, person: Person): Promise<Seed> {
  const stamp = Date.now();
  const goalName = `Meta sin fuente ${stamp}`;
  const tapName = `Marcada a mano ${stamp}`;
  const today = todayInZone();
  const horizonDate = civilDateToDate(today);
  horizonDate.setUTCDate(horizonDate.getUTCDate() + 90);

  const [goal] = await db<{ id: string }[]>`
    insert into goals.goals (user_id, name, horizon, measure_name, measure_unit, created_at)
    values (${person.id}, ${goalName}, ${dateToCivilDate(horizonDate)}, 'Páginas', 'páginas',
            now() - interval '20 days')
    returning id
  `;
  const [tap] = await db<{ id: string }[]>`
    insert into goals.commitments (user_id, goal_id, name, cadence_kind, satisfaction, created_at)
    values (${person.id}, ${goal.id}, ${tapName}, 'daily', 'tap', now() - interval '20 days')
    returning id
  `;
  await db`
    insert into goals.commitments
      (user_id, goal_id, name, cadence_kind, satisfaction, source_id, threshold, created_at)
    values (
      ${person.id}, ${goal.id}, ${`Leída por la fuente ${stamp}`}, 'daily', 'evidence',
      (select id from goals.evidence_sources where key = 'reading_lookups'), 1,
      now() - interval '20 days'
    )
  `;
  await db`
    insert into goals.facts (user_id, commitment_id, goal_id, day, written_at)
    values (${person.id}, ${tap.id}, ${goal.id}, ${today}, now())
  `;
  return { goalId: goal.id, goalName, tapName, today };
}

async function settle(page: Page, content: string): Promise<void> {
  await expect(page.getByText(content).filter({ visible: true }).first()).toBeVisible();
  await expect(page.locator("main")).toHaveCount(1);
}

test.describe("an evidence source that cannot be read (RNP-04)", () => {
  test("Hoy draws the notice and keeps the declared row", async ({ person, browser, baseURL, db }) => {
    const seeded = await seed(db, person);
    const context = await browser.newContext({ storageState: person.sessionFile, baseURL: baseURL! });
    try {
      const page = await context.newPage();
      await page.goto("/");
      await settle(page, seeded.tapName);

      await expect(page.getByText(DAY_NOTE, { exact: true })).toBeVisible();
      const row = page.locator("button", { hasText: seeded.tapName });
      await expect(row.locator("[data-state]")).toHaveAttribute("data-state", "declared");
      await expect(page.getByText(FAILURE)).toHaveCount(0);
    } finally {
      await context.close();
      await db`delete from goals.goals where id = ${seeded.goalId} and user_id = ${person.id}`;
    }
  });

  test("Semana draws the notice and keeps today's declared mark", async ({ person, browser, baseURL, db }) => {
    const seeded = await seed(db, person);
    const context = await browser.newContext({ storageState: person.sessionFile, baseURL: baseURL! });
    try {
      const page = await context.newPage();
      await page.goto("/semana");
      await settle(page, seeded.goalName);

      await expect(page.getByText(WEEK_NOTE, { exact: true })).toBeVisible();
      const mark = page
        .locator("section", { hasText: seeded.goalName })
        .locator("button", { hasText: weekRowLabel(seeded.today) })
        .locator(`[role="img"][aria-label^="${seeded.tapName}"]`);
      await expect(mark).toHaveAttribute("data-state", "declared");
      await expect(page.getByText(FAILURE)).toHaveCount(0);
    } finally {
      await context.close();
      await db`delete from goals.goals where id = ${seeded.goalId} and user_id = ${person.id}`;
    }
  });

  test("a goal with a measure draws the notice", async ({ person, browser, baseURL, db }) => {
    const seeded = await seed(db, person);
    const context = await browser.newContext({ storageState: person.sessionFile, baseURL: baseURL! });
    try {
      const page = await context.newPage();
      await page.goto(`/metas/${seeded.goalId}`);
      await settle(page, seeded.goalName);

      await expect(page.getByText(GOAL_NOTE, { exact: true })).toBeVisible();
      await expect(page.getByText(FAILURE)).toHaveCount(0);
    } finally {
      await context.close();
      await db`delete from goals.goals where id = ${seeded.goalId} and user_id = ${person.id}`;
    }
  });

  test("the ordinary server draws none of the three notices over the same seed", async ({
    person,
    browser,
    db,
  }) => {
    const seeded = await seed(db, person);
    const context = await browser.newContext({ storageState: person.sessionFile, baseURL: LIVE });
    try {
      const page = await context.newPage();
      for (const [path, content] of [
        ["/", seeded.tapName],
        ["/semana", seeded.goalName],
        [`/metas/${seeded.goalId}`, seeded.goalName],
      ]) {
        await page.goto(path);
        await settle(page, content);
        for (const note of [DAY_NOTE, WEEK_NOTE, GOAL_NOTE]) {
          await expect(page.getByText(note)).toHaveCount(0);
        }
        await expect(page.getByText(FAILURE)).toHaveCount(0);
      }
    } finally {
      await context.close();
      await db`delete from goals.goals where id = ${seeded.goalId} and user_id = ${person.id}`;
    }
  });
});
