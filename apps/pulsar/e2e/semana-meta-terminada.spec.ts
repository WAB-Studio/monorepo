import type { Browser, Page } from "@playwright/test";
import type postgres from "postgres";

import { test, expect, mintDisposablePerson } from "./fixtures";
import { civilDateToDate, dateToCivilDate, todayInZone } from "@/lib/zone";

// Semana says when a goal ended (`SemanaMetaTerminada.dc.html`): «terminó el
// <día> · ver» under its name, never «ayer». Each test seeds a person of its
// own and horizons relative to today.

function shift(day: string, by: number): string {
  const date = civilDateToDate(day);
  date.setUTCDate(date.getUTCDate() + by);
  return dateToCivilDate(date);
}

const today = todayInZone();
// 0 is Monday.
const todayIndex = (civilDateToDate(today).getUTCDay() + 6) % 7;

// ICU's Spanish, never the catalogue's list the screen reads.
function dayWords(day: string): string {
  const weekday = new Intl.DateTimeFormat("es", { weekday: "long", timeZone: "UTC" }).format(civilDateToDate(day));
  return `${weekday} ${Number(day.slice(8, 10))}`;
}

async function seedGoal(db: postgres.Sql, personId: string, name: string, horizon: string) {
  const [goal] = await db<{ id: string }[]>`
    insert into goals.goals (user_id, name, horizon, created_at)
    values (${personId}, ${name}, ${horizon}, ${new Date(Date.now() - 60 * 86_400_000)}) returning id
  `;
  // The table face draws a goal only once it holds a row.
  await db`
    insert into goals.commitments (user_id, goal_id, name, cadence_kind, satisfaction, created_at)
    values (${personId}, ${goal.id}, 'Compromiso', 'daily', 'tap', ${new Date(Date.now() - 60 * 86_400_000)})
  `;
  return goal.id;
}

async function withPerson(
  browser: Browser,
  baseURL: string | undefined,
  db: postgres.Sql,
  width: number,
  body: (page: Page, personId: string) => Promise<void>,
) {
  const person = mintDisposablePerson(baseURL ?? "http://localhost:3200");
  const context = await browser.newContext({
    baseURL: baseURL!,
    storageState: person.sessionFile,
    viewport: { width, height: 900 },
  });
  try {
    const page = await context.newPage();
    await body(page, person.id);
  } finally {
    await context.close();
    await db`delete from goals.commitments where user_id = ${person.id}`;
    await db`delete from goals.goals where user_id = ${person.id}`;
  }
}

async function open(page: Page): Promise<void> {
  await page.goto("/semana");
  await expect(page.locator("main :is(h1, p, a, button, input)").first()).toBeVisible();
  await expect(page.locator("main")).toHaveCount(1);
}

for (const width of [360, 1280]) {
  test(`at ${width} a goal that ended this week reads «terminó el <día> · ver» and opens`, async ({
    browser,
    baseURL,
    db,
  }) => {
    // Yesterday was Sunday: its goal ended before this week and is not drawn.
    test.skip(todayIndex === 0, "no day of this week is over on a Monday");
    await withPerson(browser, baseURL, db, width, async (page, personId) => {
      const name = `Meta terminada ${Date.now()}`;
      const lastDay = shift(today, -1);
      const id = await seedGoal(db, personId, name, today);
      await open(page);
      await expect(page.getByText(`terminó el ${dayWords(lastDay)} ·`).filter({ visible: true })).toHaveCount(1);
      await expect(page.getByText(/terminó ayer/)).toHaveCount(0);
      const link = page.getByRole("link", { name: `Abrir ${name}` }).filter({ visible: true });
      await expect(link).toHaveText("ver");
      await link.click();
      await expect(page).toHaveURL(new RegExp(`/metas/${id}$`));
    });
  });

  test(`at ${width} a goal ended this week with only flexible commitments reads the line too`, async ({
    browser,
    baseURL,
    db,
  }) => {
    test.skip(todayIndex === 0, "no day of this week is over on a Monday");
    await withPerson(browser, baseURL, db, width, async (page, personId) => {
      const name = `Meta flexible ${Date.now()}`;
      const id = await seedGoal(db, personId, name, today);
      await db`delete from goals.commitments where goal_id = ${id}`;
      await db`
        insert into goals.commitments (user_id, goal_id, name, cadence_kind, cadence_n, satisfaction, created_at)
        values (${personId}, ${id}, 'Empuje', 'times_per_week', 3, 'tap', ${new Date(Date.now() - 60 * 86_400_000)})
      `;
      await open(page);
      await expect(
        page.getByText(`terminó el ${dayWords(shift(today, -1))} ·`).filter({ visible: true }),
      ).toHaveCount(1);
      await expect(page.getByRole("link", { name: `Abrir ${name}` }).filter({ visible: true })).toHaveText("ver");
    });
  });

  test(`at ${width} a goal still open shows no ended line`, async ({ browser, baseURL, db }) => {
    await withPerson(browser, baseURL, db, width, async (page, personId) => {
      const name = `Meta abierta ${Date.now()}`;
      await seedGoal(db, personId, name, shift(today, 30));
      await open(page);
      await expect(page.getByText(name, { exact: false }).filter({ visible: true }).first()).toBeVisible();
      await expect(page.getByText(/terminó/).filter({ visible: true })).toHaveCount(0);
      await expect(page.getByRole("link", { name: `Abrir ${name}` })).toHaveCount(0);
    });
  });
}
