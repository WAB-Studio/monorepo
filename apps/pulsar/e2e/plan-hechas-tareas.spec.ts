import type { Locator, Page } from "@playwright/test";
import type postgres from "postgres";

import { monthOf, nextMonth } from "@/lib/plan/months";
import { todayInZone } from "@/lib/zone";

import { test as base, expect } from "./fixtures";

// `MetaPlanHechas.dc.html` and `RoadmapMesCifras.dc.html` (module 405, RP-50,
// RP-52, RP-28): the plan's «hechas» says it counts tasks done. The words are
// the approved boards' own, quoted here as literals, never read from the
// catalogue: a catalogue edit is what this spec exists to catch.

const test = base.extend<{ mine: Page }>({
  mine: async ({ browser, baseURL, person, viewport }, provide) => {
    const context = await browser.newContext({
      storageState: person.sessionFile,
      baseURL: baseURL!,
      viewport: viewport ?? { width: 390, height: 844 },
    });
    await provide(await context.newPage());
    await context.close();
  },
});

const NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const today = todayInZone();
const thisYear = today.slice(0, 4);
const m0 = monthOf(today);
const m1 = nextMonth(m0);
const horizon = `${Number(thisYear) + 1}-${today.slice(5, 7)}-01`;
const monthName = NAMES[Number(today.slice(5, 7)) - 1];
const nameOf = (month: string) =>
  month.slice(0, 4) === thisYear ? NAMES[Number(month.slice(5, 7)) - 1] : `${NAMES[Number(month.slice(5, 7)) - 1]} de ${month.slice(0, 4)}`;

type Db = postgres.Sql;

async function seedGoal(db: Db, personId: string, rhythm: number | null, unit: string | null = "minutos"): Promise<string> {
  const [goal] = await db<{ id: string }[]>`
    insert into goals.goals (user_id, name, horizon, measure_name, measure_unit, rhythm, created_at)
    values (${personId}, ${`Meta hechas ${Date.now()}`}, ${horizon}::date, ${unit}, ${unit}, ${rhythm}, now() - interval '40 days')
    returning id`;
  return goal.id;
}

async function seedTask(db: Db, personId: string, goalId: string, name: string, estimate: number, done: boolean, position: number) {
  const [task] = await db<{ id: string }[]>`
    insert into goals.one_offs (user_id, goal_id, name, estimate, position, in_plan)
    values (${personId}, ${goalId}, ${name}, ${estimate}, ${position}, true) returning id`;
  if (done) {
    await db`insert into goals.facts (user_id, goal_id, one_off_id, day) values (${personId}, ${goalId}, ${task.id}, ${today}::date)`;
  }
}

async function drop(db: Db, personId: string, goalId: string) {
  await db`delete from goals.facts where goal_id = ${goalId} and user_id = ${personId}`;
  await db`delete from goals.commitments where goal_id = ${goalId} and user_id = ${personId}`;
  await db`delete from goals.month_budgets where goal_id = ${goalId} and user_id = ${personId}`;
  await db`delete from goals.one_offs where goal_id = ${goalId} and user_id = ${personId}`;
  await db`delete from goals.goals where id = ${goalId} and user_id = ${personId}`;
}

const current = (page: Page) =>
  page.locator("section").filter({ has: page.getByText(`${monthName} · en curso`, { exact: true }) });
const later = (page: Page) =>
  page.locator("section").filter({ has: page.getByText(nameOf(m1), { exact: true }) });
const planRow = (page: Page, goalId: string) => page.locator(`a[href="/metas/${goalId}/plan"]`);
const family = (locator: Locator) => locator.evaluate((el) => getComputedStyle(el).fontFamily);

async function figuresMono(line: Locator, count: number) {
  expect(await family(line)).not.toMatch(/mono/i);
  const figures = line.locator("> span");
  await expect(figures).toHaveCount(count);
  for (let i = 0; i < count; i++) expect(await family(figures.nth(i))).toMatch(/mono/i);
}

for (const width of [390, 1440]) {
  test.describe(`405 at ${width}`, () => {
    test.use({ viewport: { width, height: 900 } });

    test("the current month header and the goal's row say «en tareas hechas», figures mono, words Archivo", async ({ mine: page, db, person }) => {
      const goalId = await seedGoal(db, person.id, 720);
      try {
        await seedTask(db, person.id, goalId, "Hecha 3", 180, true, 1);
        await seedTask(db, person.id, goalId, "Hecha 2", 120, true, 2);
        await seedTask(db, person.id, goalId, "Pendiente", 240, false, 3);

        await page.goto(`/metas/${goalId}/plan`);
        const header = current(page).getByText("5 h de 12 h en tareas hechas", { exact: true });
        await expect(header).toBeVisible();
        await figuresMono(header, 2);
        await expect(page.getByText(/\d hechas de/)).toHaveCount(0);

        await page.goto(`/metas/${goalId}`);
        const rhythm = planRow(page, goalId).getByText(`Ritmo 12 h al mes · en ${monthName}, 5 h de 12 h en tareas hechas`, { exact: true });
        await expect(rhythm).toBeVisible();
        await figuresMono(rhythm, 3);
      } finally {
        await drop(db, person.id, goalId);
      }
    });

    test("a later month keeps «planeadas de»; the current one is never said as planned", async ({ mine: page, db, person }) => {
      const goalId = await seedGoal(db, person.id, 720);
      try {
        await seedTask(db, person.id, goalId, "Hecha", 300, true, 1);
        await seedTask(db, person.id, goalId, "Grande", 2400, false, 2);
        await page.goto(`/metas/${goalId}/plan`);
        await expect(later(page).getByText("12 h planeadas de 12 h", { exact: true })).toBeVisible();
        await expect(later(page).getByText(/tareas hechas/)).toHaveCount(0);
        await expect(current(page).getByText(/planeadas de/)).toHaveCount(0);
        await expect(current(page).getByText("5 h de 12 h en tareas hechas", { exact: true })).toBeVisible();
      } finally {
        await drop(db, person.id, goalId);
      }
    });

    test("nothing done: «0 min de 12 h en tareas hechas» on the header and the row", async ({ mine: page, db, person }) => {
      const goalId = await seedGoal(db, person.id, 720);
      try {
        await seedTask(db, person.id, goalId, "Pendiente", 240, false, 1);
        await page.goto(`/metas/${goalId}/plan`);
        await expect(current(page).getByText("0 min de 12 h en tareas hechas", { exact: true })).toBeVisible();
        await page.goto(`/metas/${goalId}`);
        await expect(planRow(page, goalId).getByText(`Ritmo 12 h al mes · en ${monthName}, 0 min de 12 h en tareas hechas`, { exact: true })).toBeVisible();
      } finally {
        await drop(db, person.id, goalId);
      }
    });

    test("the figure counts tasks, never facts: a 2 h fact moves «lo medido» to 7 h and neither plan line", async ({ mine: page, db, person }) => {
      const goalId = await seedGoal(db, person.id, 720);
      try {
        await seedTask(db, person.id, goalId, "Hecha 3", 180, true, 1);
        await seedTask(db, person.id, goalId, "Hecha 2", 120, true, 2);
        await seedTask(db, person.id, goalId, "Pendiente", 240, false, 3);
        const [commitment] = await db<{ id: string }[]>`
          insert into goals.commitments (user_id, goal_id, name, cadence_kind, satisfaction, target_quantity, unit, created_at)
          values (${person.id}, ${goalId}, ${`Sesión ${Date.now()}`}, 'daily', 'quantity', 30, 'minutos', now() - interval '40 days')
          returning id`;
        await db`insert into goals.facts (user_id, goal_id, commitment_id, day, quantity) values (${person.id}, ${goalId}, ${commitment.id}, ${today}::date, 120)`;

        await page.goto(`/metas/${goalId}/plan`);
        await expect(current(page).getByText("5 h de 12 h en tareas hechas", { exact: true })).toBeVisible();
        await page.goto(`/metas/${goalId}`);
        await expect(planRow(page, goalId).getByText(`Ritmo 12 h al mes · en ${monthName}, 5 h de 12 h en tareas hechas`, { exact: true })).toBeVisible();
        const measured = page.locator("section").filter({ has: page.getByText(monthName, { exact: true }) }).filter({ hasText: /7 h/ });
        await expect(measured.first()).toBeVisible();
        await expect(measured.first()).not.toContainText("tareas hechas");
      } finally {
        await drop(db, person.id, goalId);
      }
    });
  });
}

test.describe("405 at 360", () => {
  test.use({ viewport: { width: 360, height: 800 } });

  test("«12 h 30 min de 120 h en tareas hechas» fits on the header and the row", async ({ mine: page, db, person }) => {
    const goalId = await seedGoal(db, person.id, 7200);
    try {
      await seedTask(db, person.id, goalId, "Hecha larga", 750, true, 1);
      await seedTask(db, person.id, goalId, "Pendiente", 240, false, 2);
      await page.goto(`/metas/${goalId}/plan`);
      await expect(current(page).getByText("12 h 30 min de 120 h en tareas hechas", { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
      await page.goto(`/metas/${goalId}`);
      await expect(planRow(page, goalId).getByText(`Ritmo 120 h al mes · en ${monthName}, 12 h 30 min de 120 h en tareas hechas`, { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    } finally {
      await drop(db, person.id, goalId);
    }
  });
});

test("a goal with no measure draws no «tareas hechas» on its plan", async ({ mine: page, db, person }) => {
  const goalId = await seedGoal(db, person.id, null, null);
  try {
    // A budget gives the month an amount; with no measure it still has no figure to say.
    await db`insert into goals.month_budgets (user_id, goal_id, month, amount) values (${person.id}, ${goalId}, ${`${today.slice(0, 7)}-01`}::date, 720)`;
    await seedTask(db, person.id, goalId, "Hecha", 180, true, 1);
    await page.goto(`/metas/${goalId}/plan`);
    await expect(page.getByText("Hecha", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/tareas hechas/)).toHaveCount(0);
  } finally {
    await drop(db, person.id, goalId);
  }
});
