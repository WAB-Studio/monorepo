import { test, expect } from "./fixtures";
import { dayBefore } from "@/lib/day/weeks";
import { monthOf, nextMonth } from "@/lib/plan/months";
import { todayInZone } from "@/lib/zone";

// `Meses.dc.html`, `MesesEscritorio`, `MesPlan.dc.html` (module 138, RP-28,
// RP-32, RP-35): a goal read month by month, and the sheet that sets,
// changes and removes a month's amount.

const NAMES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

function label(month: string): string {
  return `${NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

const thisMonth = monthOf(todayInZone());
const lastMonth = monthOf(dayBefore(thisMonth));
const followingMonth = nextMonth(thisMonth);
const horizon = nextMonth(followingMonth);

// Opened last month with a measure in minutes; the horizon leaves next month
// in the span, with nothing in it.
async function seedGoal(db: import("postgres").Sql, personId: string, name: string) {
  const [goal] = await db<{ id: string }[]>`
    insert into goals.goals (user_id, name, horizon, measure_name, measure_unit, created_at)
    values (${personId}, ${name}, ${horizon}::date, 'minutos', 'minutos', (${lastMonth}::date + 14) + time '12:00' at time zone 'UTC')
    returning id
  `;
  return goal.id;
}

test("the months read planned, reached and the share carried; the sheet sets, changes and removes an amount in hours and minutes (RP-28, RP-32, RP-35)", async ({
  person,
  browser,
  baseURL,
  db,
}) => {
  const stamp = Date.now();
  const goalId = await seedGoal(db, person.id, `Meta meses ${stamp}`);
  await db`
    insert into goals.month_budgets (user_id, goal_id, month, amount)
    values (${person.id}, ${goalId}, ${lastMonth}::date, 600)
  `;
  // 100 done in the month, 200 left: 200 of 300 carried, 66.67 floors to 66.
  const [done] = await db<{ id: string }[]>`
    insert into goals.one_offs (user_id, goal_id, name, planned_month, estimate)
    values (${person.id}, ${goalId}, ${`Hecha ${stamp}`}, ${lastMonth}::date, 100) returning id
  `;
  await db`
    insert into goals.facts (user_id, goal_id, one_off_id, day)
    values (${person.id}, ${goalId}, ${done.id}, ${lastMonth}::date + 14)
  `;
  await db`
    insert into goals.one_offs (user_id, goal_id, name, planned_month, estimate)
    values (${person.id}, ${goalId}, ${`Pendiente ${stamp}`}, ${lastMonth}::date, 200)
  `;

  const stored = async () => {
    const rows = await db<{ amount: number }[]>`
      select amount from goals.month_budgets
      where goal_id = ${goalId} and month = ${thisMonth}::date
    `;
    return rows.map((row) => row.amount);
  };

  const context = await browser.newContext({ storageState: person.sessionFile, baseURL: baseURL! });
  try {
    const page = await context.newPage();
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(`/metas/${goalId}/meses`);
    await expect(page.locator("main")).toHaveCount(1);

    const items = page.getByRole("listitem");
    await expect(items).toHaveCount(3);
    const last = items.nth(0);
    await expect(last).toContainText(label(lastMonth));
    await expect(last).toContainText("1 h 40 min");
    await expect(last).toContainText("de 10 h");
    await expect(last).toContainText("se arrastró 66 %");
    await expect(last.getByRole("link", { name: label(lastMonth) })).toHaveAttribute(
      "href",
      `/metas/${goalId}/meses/${lastMonth.slice(0, 7)}`,
    );
    const current = page.locator("li[data-current]");
    await expect(current).toContainText(label(thisMonth));
    await expect(current).toContainText("en curso");
    await expect(current).toContainText("sin monto");
    await expect(current).not.toContainText("se arrastró");
    // A month with nothing is still a row, and says so, and carries no share.
    await expect(items.nth(2)).toContainText(label(followingMonth));
    await expect(items.nth(2)).toContainText("sin monto");
    await expect(items.nth(2)).not.toContainText("%");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);

    // Set: 12 and 30 are 750, read back in the row with no reload.
    await current.getByRole("link", { name: "sin monto" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("heading", { name: `¿Cuánto en ${label(thisMonth)}?` })).toBeVisible();
    await expect(sheet.getByRole("button", { name: /^quitar el monto/ })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    await sheet.getByLabel("horas", { exact: true }).fill("12");
    await sheet.getByLabel("minutos", { exact: true }).fill("30");
    await sheet.getByRole("button", { name: "Guardar" }).click();
    await expect(sheet).toHaveCount(0);
    await expect(current).toContainText("de 12 h 30 min");
    await expect(current).not.toContainText("sin monto");
    expect(await stored()).toEqual([750]);

    // Refused: 60 minutes is no minute count, and nothing changes.
    await current.getByRole("link", { name: "de 12 h 30 min" }).click();
    await expect(sheet.getByLabel("horas", { exact: true })).toHaveValue("12");
    await expect(sheet.getByLabel("minutos", { exact: true })).toHaveValue("30");
    await sheet.getByLabel("minutos", { exact: true }).fill("60");
    await sheet.getByRole("button", { name: "Guardar" }).click();
    await expect(sheet.getByText("Los minutos van de 0 a 59.")).toBeVisible();
    expect(await stored()).toEqual([750]);

    // Changed.
    await sheet.getByLabel("minutos", { exact: true }).fill("45");
    await sheet.getByRole("button", { name: "Guardar" }).click();
    await expect(sheet).toHaveCount(0);
    await expect(current).toContainText("de 12 h 45 min");
    expect(await stored()).toEqual([765]);

    // Removed.
    await current.getByRole("link", { name: "de 12 h 45 min" }).click();
    await sheet.getByRole("button", { name: `quitar el monto de ${label(thisMonth)}` }).click();
    await expect(sheet).toHaveCount(0);
    await expect(current).toContainText("sin monto");
    expect(await stored()).toEqual([]);

    // The desktop face: the same rows as a table, in the 640 column.
    await page.setViewportSize({ width: 1280, height: 900 });
    const table = page.getByRole("table");
    await expect(table).toBeVisible();
    const rows = table.getByRole("row");
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(1).getByRole("cell").nth(1)).toHaveText("1 h 40 min");
    await expect(rows.nth(1).getByRole("cell").nth(2)).toHaveText("10 h");
    await expect(rows.nth(2)).toHaveAttribute("data-current", "");
    await expect(rows.nth(2).getByRole("cell").nth(3)).toContainText("en curso");
    const width = await page.evaluate(() => document.querySelector("main")?.getBoundingClientRect().width);
    // 640 px of content with the 56 px padding standing outside it on each side.
    expect(width).toBe(752);

    await rows.nth(2).getByRole("link", { name: "sin monto" }).click();
    await expect(sheet.getByRole("heading", { name: `¿Cuánto en ${label(thisMonth)}?` })).toBeVisible();
  } finally {
    await context.close();
    await db`delete from goals.goals where user_id = ${person.id}`;
  }
});

test("?planear= opens the sheet on that month and ignores a month outside the span (RP-28)", async ({
  person,
  browser,
  baseURL,
  db,
}) => {
  const goalId = await seedGoal(db, person.id, `Meta planear ${Date.now()}`);
  const context = await browser.newContext({ storageState: person.sessionFile, baseURL: baseURL! });
  try {
    const page = await context.newPage();
    await page.goto(`/metas/${goalId}/meses?planear=${followingMonth.slice(0, 7)}`);
    await expect(
      page.getByRole("heading", { name: `¿Cuánto en ${label(followingMonth)}?` }),
    ).toBeVisible();

    await page.goto(`/metas/${goalId}/meses?planear=2001-01`);
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Nothing is planned anywhere: the empty face names the way in.
    await expect(page.getByText(/^Ningún mes tiene monto/)).toBeVisible();
    await page.getByRole("link", { name: `Planear ${label(thisMonth)}` }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  } finally {
    await context.close();
    await db`delete from goals.goals where user_id = ${person.id}`;
  }
});

test("a unit that is no time takes one field and stores the number as typed (RP-28)", async ({
  person,
  browser,
  baseURL,
  db,
}) => {
  const goalId = await seedGoal(db, person.id, `Meta páginas ${Date.now()}`);
  await db`update goals.goals set measure_unit = 'páginas', measure_name = 'páginas' where id = ${goalId}`;
  const context = await browser.newContext({ storageState: person.sessionFile, baseURL: baseURL! });
  try {
    const page = await context.newPage();
    await page.goto(`/metas/${goalId}/meses?planear=${thisMonth.slice(0, 7)}`);
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByLabel("horas")).toHaveCount(0);
    await sheet.getByLabel("cuánto, en páginas").fill("40");
    await sheet.getByRole("button", { name: "Guardar" }).click();
    await expect(sheet).toHaveCount(0);
    await expect(page.locator("li[data-current]")).toContainText("de 40 páginas");
    const rows = await db<{ amount: number }[]>`select amount from goals.month_budgets where goal_id = ${goalId}`;
    expect(rows.map((row) => row.amount)).toEqual([40]);
  } finally {
    await context.close();
    await db`delete from goals.goals where user_id = ${person.id}`;
  }
});

test("a goal with no measure says why no amount can be set and links back; an unknown goal 404s (RP-28)", async ({
  person,
  browser,
  baseURL,
  db,
}) => {
  const [goal] = await db<{ id: string }[]>`
    insert into goals.goals (user_id, name, horizon)
    values (${person.id}, ${`Meta sin medida ${Date.now()}`}, ${horizon}::date) returning id
  `;
  const context = await browser.newContext({ storageState: person.sessionFile, baseURL: baseURL! });
  try {
    const page = await context.newPage();
    await page.goto(`/metas/${goal.id}/meses`);
    await expect(page.getByText("Esta meta no mide nada, así que no lleva montos ni tiempo.")).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
    await page.getByRole("link", { name: "Volver a la meta" }).click();
    await page.waitForURL(`**/metas/${goal.id}`);

    await page.goto("/metas/00000000-0000-0000-0000-000000000000/meses");
    await expect(page.getByRole("heading", { name: "Esta página no existe" })).toBeVisible();
  } finally {
    await context.close();
    await db`delete from goals.goals where user_id = ${person.id}`;
  }
});
