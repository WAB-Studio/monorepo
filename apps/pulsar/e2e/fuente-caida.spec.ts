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

// The Semana row's mark names its day in full («…, lunes 5: hecho»), read
// back here rather than imported.
const WEEKDAY_LONG = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

function markDayLabel(civilDay: string): string {
  const weekdayIndex = (new Date(`${civilDay}T12:00:00Z`).getUTCDay() + 6) % 7;
  return `${WEEKDAY_LONG[weekdayIndex]} ${Number(civilDay.slice(8, 10))}`;
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
        .getByRole("main")
        .getByRole("img", { name: `${seeded.tapName}, ${markDayLabel(seeded.today)}: hecho`, exact: true });
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

      // `MetaTotal` (399): the total's own line stays, and today's note sits under it.
      const since = page.locator("p", { hasText: /^en total, desde el / }).locator("visible=true");
      await expect(since).toHaveCount(1);
      const sinceBox = (await since.boundingBox())!;
      const noteBox = (await page.getByText(GOAL_NOTE, { exact: true }).boundingBox())!;
      expect(noteBox.y).toBeGreaterThanOrEqual(sinceBox.y + sinceBox.height - 1);
    } finally {
      await context.close();
      await db`delete from goals.goals where id = ${seeded.goalId} and user_id = ${person.id}`;
    }
  });

  test("the goal's month block says it holds only what was declared, with the declared figure, at 360 and 1280", async ({
    person,
    browser,
    baseURL,
    db,
  }) => {
    // `MetaMesSinEvidencia.dc.html` (module 136): 5 declared pages of a
    // 12-page month, the reading source unreadable.
    const seeded = await seed(db, person);
    const monthStart = `${seeded.today.slice(0, 7)}-01`;
    await db`
      insert into goals.month_budgets (user_id, goal_id, month, amount)
      values (${person.id}, ${seeded.goalId}, ${monthStart}::date, 12)
    `;
    const [quantity] = await db<{ id: string }[]>`
      insert into goals.commitments
        (user_id, goal_id, name, cadence_kind, satisfaction, target_quantity, unit, created_at)
      values (${person.id}, ${seeded.goalId}, ${`Páginas ${Date.now()}`}, 'daily', 'quantity', 10, 'páginas',
              now() - interval '20 days')
      returning id
    `;
    await db`
      insert into goals.facts (user_id, goal_id, commitment_id, day, quantity)
      values (${person.id}, ${seeded.goalId}, ${quantity.id}, ${seeded.today}::date, 5)
    `;
    const context = await browser.newContext({ storageState: person.sessionFile, baseURL: baseURL! });
    try {
      const page = await context.newPage();
      for (const width of [360, 1280]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(`/metas/${seeded.goalId}`);
        await settle(page, seeded.goalName);

        const visible = (text: string) => page.getByText(text, { exact: true }).locator("visible=true");
        await expect(
          visible("solo lo que dijiste tú · no pudimos leer el diccionario de lectura"),
        ).toHaveCount(1);
        await expect(visible("5 de 12")).toHaveCount(1);
        // The month block prints the bare figure; the total beside «mide en» keeps its unit.
        await expect(visible("5")).toHaveCount(1);
        await expect(page.getByText(/llevas \d+ %|bajo el 60 %/).locator("visible=true")).toHaveCount(0);
        await expect(page.getByRole("link", { name: "Ver por mes", exact: true })).toBeVisible();
      }
    } finally {
      await context.close();
      await db`delete from goals.goals where id = ${seeded.goalId} and user_id = ${person.id}`;
    }
  });

  test("the ordinary server draws none of the three notices over the same seed", async ({
    person,
    browser,
    baseURL,
    db,
  }) => {
    // A control is worth something only against a server without the seam. The
    // seam server is `baseURL`: the same seed, session and paths must draw the
    // note there and not here, so this one is a different server and the only
    // difference between the two is the seam.
    expect(new URL(LIVE).origin, "PULSAR_BASE_URL is the seam server").not.toBe(new URL(baseURL!).origin);

    const seeded = await seed(db, person);
    const context = await browser.newContext({ storageState: person.sessionFile, baseURL: LIVE });
    const seamContext = await browser.newContext({ storageState: person.sessionFile, baseURL: baseURL! });
    try {
      const page = await context.newPage();
      const seamPage = await seamContext.newPage();
      for (const [path, content, note] of [
        ["/", seeded.tapName, DAY_NOTE],
        ["/semana", seeded.goalName, WEEK_NOTE],
        [`/metas/${seeded.goalId}`, seeded.goalName, GOAL_NOTE],
      ]) {
        await seamPage.goto(path);
        await settle(seamPage, content);
        await expect(seamPage.getByText(note, { exact: true }), `${path} on the seam server`).toBeVisible();

        await page.goto(path);
        await settle(page, content);
        for (const other of [DAY_NOTE, WEEK_NOTE, GOAL_NOTE]) {
          await expect(page.getByText(other)).toHaveCount(0);
        }
        await expect(page.getByText(FAILURE)).toHaveCount(0);
      }
    } finally {
      await seamContext.close();
      await context.close();
      await db`delete from goals.goals where id = ${seeded.goalId} and user_id = ${person.id}`;
    }
  });
});
