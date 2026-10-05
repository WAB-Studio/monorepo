import type postgres from "postgres";

import { test, expect } from "./fixtures";
import { civilDateToDate, dateToCivilDate, todayInZone } from "@/lib/zone";

// `/metas` (`MetasCentro`, `MetasCentroEscritorio`; RP-11, RP-24, RP-27, RP-33,
// RP-37; RNP-16, RNP-17, RNP-07): the open goals as rows with their last day,
// «Abrir otra meta» in a group of its own, and «el plan» beside or below them.
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function plusDays(days: number): string {
  const date = civilDateToDate(todayInZone());
  date.setUTCDate(date.getUTCDate() + days);
  return dateToCivilDate(date);
}

// The last day a goal counts is the day before its horizon.
function lastDay(horizon: string): string {
  const date = civilDateToDate(horizon);
  date.setUTCDate(date.getUTCDate() - 1);
  const day = dateToCivilDate(date);
  const label = `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;
  return day.slice(0, 4) === todayInZone().slice(0, 4) ? label : `${label} ${day.slice(0, 4)}`;
}

async function seedGoal(
  db: postgres.Sql,
  personId: string,
  name: string,
  horizon: string,
  age: number,
  archived = false,
): Promise<string> {
  const [row] = await db<{ id: string }[]>`
    insert into goals.goals (user_id, name, horizon, archived_at, created_at)
    values (${personId}, ${name}, ${horizon}, ${archived ? new Date() : null},
            ${new Date(Date.now() - 20 * 86_400_000 + age)})
    returning id
  `;
  return row.id;
}

for (const width of [360, 390, 1280, 1440]) {
  test(`/metas at ${width}: the goals as rows with their last day, «Abrir otra meta» apart, the plan one tap away`, async ({
    person,
    browser,
    db,
  }) => {
    const stamp = Date.now();
    const nearHorizon = plusDays(60);
    // A year out, so the row spells the year.
    const farHorizon = plusDays(400);
    const nearName = `Cerca ${stamp}`;
    const farName = `Lejos ${stamp}`;
    const endedName = `Fin ${stamp % 100000}`;
    const archivedName = `Archivada ${stamp}`;
    const nearId = await seedGoal(db, person.id, nearName, nearHorizon, 0);
    const farId = await seedGoal(db, person.id, farName, farHorizon, 1000);
    const endedId = await seedGoal(db, person.id, endedName, "2026-09-14", 2000);
    await seedGoal(db, person.id, archivedName, nearHorizon, 3000, true);

    const context = await browser.newContext({
      storageState: person.sessionFile,
      viewport: { width, height: 900 },
    });
    try {
      const page = await context.newPage();
      await page.goto("/metas");

      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Metas");

      const group = page.getByRole("group", { name: "abiertas" });
      const links = group.getByRole("link");
      await expect(links).toHaveCount(2);
      await expect(links.nth(0)).toContainText(nearName);
      await expect(links.nth(0)).toContainText(`hasta el ${lastDay(nearHorizon)}`);
      await expect(links.nth(1)).toContainText(farName);
      await expect(links.nth(1)).toContainText(`hasta el ${lastDay(farHorizon)}`);
      expect(lastDay(farHorizon)).toMatch(/ \d{4}$/);
      for (const index of [0, 1]) {
        const box = await links.nth(index).boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(48);
      }

      // «Abrir otra meta» is a link of the page, not one of the goals' rows.
      const addAnother = page.getByRole("link", { name: "Abrir otra meta" });
      await expect(addAnother).toHaveAttribute("href", "/metas/nueva");
      await expect(group.getByRole("link", { name: "Abrir otra meta" })).toHaveCount(0);

      await expect(page.getByRole("link", { name: `${endedName} terminó el 13 sep` })).toBeVisible();
      await expect(page.getByRole("link", { name: new RegExp(`^${archivedName} archivada el \\d+ \\w+$`) })).toBeVisible();

      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

      if (width >= 1024) {
        const rowBox = await links.nth(0).boundingBox();
        const planBox = await page.getByText("el plan", { exact: true }).boundingBox();
        expect(planBox!.x).toBeGreaterThan(rowBox!.x + rowBox!.width);
      }

      for (const [id, name] of [
        [nearId, nearName],
        [farId, farName],
        [endedId, endedName],
      ]) {
        await page.goto("/metas");
        await page.locator("main").getByRole("link", { name: new RegExp(`^${name}`) }).click();
        await page.waitForURL(new RegExp(`/metas/${id}$`));
      }

      await page.goto("/metas");
      await page.getByRole("link", { name: /^Importar un plan/ }).click();
      await page.waitForURL(/\/metas\/importar$/);

      await page.goto("/metas");
      await page.getByRole("link", { name: /^Exportar/ }).click();
      await page.waitForURL(/\/exportar$/);
    } finally {
      await context.close();
    }
  });
}

const MONTH_LONG = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

for (const width of [390, 1440]) {
  test(`/metas at ${width}: the desktop row carries the goal's month and figure; the phone keeps its last day and puts the plan before «Archivadas»`, async ({
    person,
    browser,
    db,
  }) => {
    const stamp = Date.now();
    const today = todayInZone();
    const month = `${today.slice(0, 7)}-01`;
    const monthName = MONTH_LONG[Number(today.slice(5, 7)) - 1];
    const horizon = plusDays(60);
    const measuredName = `Medida ${stamp}`;
    const taskedName = `Tareas ${stamp}`;
    const archivedName = `Archivada ${stamp}`;

    const [measured] = await db<{ id: string }[]>`
      insert into goals.goals (user_id, name, horizon, measure_name, measure_unit, created_at)
      values (${person.id}, ${measuredName}, ${horizon}::date, 'estudio', 'min',
              ${new Date(Date.now() - 20 * 86_400_000)})
      returning id
    `;
    await db`
      insert into goals.month_budgets (user_id, goal_id, month, amount)
      values (${person.id}, ${measured.id}, ${month}::date, 720)
    `;
    const [done] = await db<{ id: string }[]>`
      insert into goals.one_offs (user_id, goal_id, name, planned_month, estimate)
      values (${person.id}, ${measured.id}, 'hecha', ${month}::date, 161)
      returning id
    `;
    await db`
      insert into goals.facts (user_id, goal_id, one_off_id, day)
      values (${person.id}, ${measured.id}, ${done.id}, ${today}::date)
    `;

    const tasked = await seedGoal(db, person.id, taskedName, horizon, 1000);
    for (const [name, doneToday] of [["a", true], ["b", false], ["c", false]] as const) {
      const [task] = await db<{ id: string }[]>`
        insert into goals.one_offs (user_id, goal_id, name, planned_month)
        values (${person.id}, ${tasked}, ${name}, ${month}::date)
        returning id
      `;
      if (doneToday) {
        await db`
          insert into goals.facts (user_id, goal_id, one_off_id, day)
          values (${person.id}, ${tasked}, ${task.id}, ${today}::date)
        `;
      }
    }
    await seedGoal(db, person.id, archivedName, horizon, 3000, true);

    const context = await browser.newContext({
      storageState: person.sessionFile,
      viewport: { width, height: 900 },
    });
    try {
      const page = await context.newPage();
      await page.goto("/metas");
      const main = page.locator("main");
      const measuredRow = main.locator("a", { hasText: measuredName });
      const taskedRow = main.locator("a", { hasText: taskedName });

      if (width >= 1024) {
        await expect(measuredRow.getByText(`${monthName} · 2 h 41 min de 12 h`)).toBeVisible();
        await expect(taskedRow.getByText(`${monthName} · 1 de 3 tareas`)).toBeVisible();
        await expect(measuredRow.getByText(`hasta el ${lastDay(horizon)}`).last()).toBeVisible();
      } else {
        await expect(measuredRow.getByText(`hasta el ${lastDay(horizon)}`).first()).toBeVisible();
        await expect(measuredRow.getByText(`${monthName} · 2 h 41 min de 12 h`)).toBeHidden();
        await expect(taskedRow.getByText(`${monthName} · 1 de 3 tareas`)).toBeHidden();

        const y = async (locator: ReturnType<typeof page.getByText>) => (await locator.boundingBox())!.y;
        const addAnother = await y(page.getByRole("link", { name: "Abrir otra meta" }));
        const plan = await y(page.getByText("el plan", { exact: true }));
        const archived = await y(page.getByText("Archivadas", { exact: true }));
        expect(addAnother).toBeLessThan(plan);
        expect(plan).toBeLessThan(archived);
      }
    } finally {
      await context.close();
    }
  });
}
