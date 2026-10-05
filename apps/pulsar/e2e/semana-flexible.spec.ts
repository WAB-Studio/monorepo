import { test, expect } from "./fixtures";
import { civilDateToDate, dateToCivilDate, todayInZone, weekOf } from "@/lib/zone";

// «N veces por semana» and «N al mes» leave the daily «hechos N de M» and
// carry their own count (`SemanaFlexible.dc.html`, `SemanaEscritorioFlexible.dc.html`).

function plusDays(days: number): string {
  const date = civilDateToDate(todayInZone());
  date.setUTCDate(date.getUTCDate() + days);
  return dateToCivilDate(date);
}

test("a flexible cadence is counted by its period, leaves «hechos», and its undone days read quiet (phone and 1280)", async ({
  person,
  browser,
  baseURL,
  db,
}) => {
  const personId = person.id;
  const stamp = Date.now();
  const goalName = `Meta flexible ${stamp}`;
  const daily = `Anki ${stamp}`;
  const weekly = `Empuje ${stamp}`;
  const monthly = `Pesarse ${stamp}`;

  const today = todayInZone();
  const week = weekOf(today);
  const monday = week[0];
  const month = today.slice(0, 7);
  // Distinct days with a fact: today, this week's Monday, the month's first.
  const doneDays = [...new Set([today, monday, `${month}-01`])];
  const inWeek = doneDays.filter((day) => week.includes(day));
  const inMonth = doneDays.filter((day) => day.slice(0, 7) === month);

  const [goal] = await db<{ id: string }[]>`
    insert into goals.goals (user_id, name, horizon, created_at)
    values (${personId}, ${goalName}, ${plusDays(90)}::date, now() - interval '40 days') returning id
  `;
  async function seed(name: string, kind: string, count: number | null, days: string[]) {
    const [row] = await db<{ id: string }[]>`
      insert into goals.commitments (user_id, goal_id, name, cadence_kind, cadence_n, satisfaction, created_at)
      values (${personId}, ${goal.id}, ${name}, ${kind}, ${count}, 'tap', now() - interval '40 days') returning id
    `;
    for (const day of days) {
      await db`
        insert into goals.facts (user_id, goal_id, commitment_id, day)
        values (${personId}, ${goal.id}, ${row.id}, ${day}::date)
      `;
    }
  }
  await seed(daily, "daily", null, inWeek);
  await seed(weekly, "times_per_week", 3, inWeek);
  await seed(
    monthly,
    "times_per_month",
    4,
    doneDays.filter((day) => day.slice(0, 7) === month),
  );

  const context = await browser.newContext({ storageState: person.sessionFile, baseURL: baseURL! });
  try {
    const page = await context.newPage();
    const weekProgress = `${inWeek.length} de 3 esta semana`;
    const monthProgress = `${inMonth.length} de 4 este mes`;

    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/semana");
    // `loading.tsx` may still stand: one `main` says the page itself has rendered.
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.getByText(`${goalName} · por semana y por mes`)).toBeVisible();
    const flexRow = (name: string) => page.getByRole("button", { name: new RegExp(`^${name}`) });
    await expect(flexRow(weekly)).toContainText("3 veces por semana");
    await expect(flexRow(weekly)).toContainText(weekProgress);
    await expect(flexRow(monthly)).toContainText("4 al mes");
    await expect(flexRow(monthly)).toContainText(monthProgress);
    // Only the daily commitment draws dots in the day rows: one per day it was done.
    await expect(page.getByRole("img", { name: new RegExp(`^${weekly}`) })).toHaveCount(0);
    await expect(page.getByRole("img", { name: new RegExp(`^${monthly}`) })).toHaveCount(0);
    await expect(page.getByRole("img", { name: `${daily}: hecho` })).toHaveCount(inWeek.length);
    // Only a lived day reads «1 de 1» (the daily, done): a Monday has none, so none reads it.
    await expect(page.getByText("1 de 1", { exact: true }).locator("visible=true")).toHaveCount(
      inWeek.filter((day) => day < today).length,
    );
    await expect(page.getByText("3 de 3", { exact: true }).locator("visible=true")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    await page.screenshot({ path: "private/screenshots/semana-flexible-360.png", fullPage: true });

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/semana");
    // `loading.tsx` may still stand: one `main` says the page itself has rendered.
    await expect(page.locator("main")).toHaveCount(1);
    const table = page.getByRole("table");
    await expect(table).toBeVisible();
    const rowOf = (name: string) =>
      table.locator("tr", { has: page.getByRole("rowheader", { name: new RegExp(`^${name}`) }) });
    await expect(rowOf(weekly).getByRole("rowheader")).toContainText(`3 veces por semana · ${weekProgress}`);
    await expect(rowOf(monthly).getByRole("rowheader")).toContainText(`4 al mes · ${monthProgress}`);
    const cellsOf = (day: string) => rowOf(weekly).locator("td").nth(week.indexOf(day)).getByRole("img");
    for (const day of inWeek) await expect(cellsOf(day)).toHaveAttribute("data-state", "declared");
    for (const day of week.filter((other) => !inWeek.includes(other))) await expect(cellsOf(day)).toHaveCount(0);
    // Only the daily commitment's slots are in «hechos»: today it is 1 of 1.
    const todayIndex = week.indexOf(today);
    await expect(table.locator("tfoot td").nth(todayIndex)).toHaveText("1 de 1");
    await page.screenshot({ path: "private/screenshots/semana-flexible-1280.png", fullPage: true });
  } finally {
    await context.close();
    await db`delete from goals.goals where id = ${goal.id}`;
  }
});

test("on the phone a goal with no commitment still draws its own section", async ({ person, browser, baseURL, db }) => {
  const goalName = `Meta sin compromisos ${Date.now()}`;
  const [goal] = await db<{ id: string }[]>`
    insert into goals.goals (user_id, name, horizon, created_at)
    values (${person.id}, ${goalName}, ${plusDays(90)}::date, now() - interval '3 days') returning id
  `;
  const context = await browser.newContext({ storageState: person.sessionFile, baseURL: baseURL! });
  try {
    const page = await context.newPage();
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/semana");
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.getByRole("main").getByText(goalName)).toBeVisible();
  } finally {
    await context.close();
    await db`delete from goals.goals where id = ${goal.id}`;
  }
});

test("Hoy carries a flexible commitment's period count on its row and asks it only while its quota is open", async ({
  person,
  browser,
  baseURL,
  db,
}) => {
  const stamp = Date.now();
  const goalName = `Meta hoy flexible ${stamp}`;
  const weekly = `Empuje ${stamp}`;
  const monthly = `Pesarse ${stamp}`;
  const met = `Cumplida ${stamp}`;

  const today = todayInZone();
  const week = weekOf(today);
  const month = today.slice(0, 7);
  const doneDays = [...new Set([today, week[0], `${month}-01`])];
  const inWeek = doneDays.filter((day) => week.includes(day));
  const inMonth = doneDays.filter((day) => day.slice(0, 7) === month);

  const [goal] = await db<{ id: string }[]>`
    insert into goals.goals (user_id, name, horizon, created_at)
    values (${person.id}, ${goalName}, ${plusDays(90)}::date, now() - interval '40 days') returning id
  `;
  async function seed(name: string, kind: string, count: number, days: string[]) {
    const [row] = await db<{ id: string }[]>`
      insert into goals.commitments (user_id, goal_id, name, cadence_kind, cadence_n, satisfaction, created_at)
      values (${person.id}, ${goal.id}, ${name}, ${kind}, ${count}, 'tap', now() - interval '40 days') returning id
    `;
    for (const day of days) {
      await db`
        insert into goals.facts (user_id, goal_id, commitment_id, day)
        values (${person.id}, ${goal.id}, ${row.id}, ${day}::date)
      `;
    }
  }
  await seed(weekly, "times_per_week", 3, inWeek);
  await seed(monthly, "times_per_month", 4, inMonth);
  // Met on the month's first, quota 1. Any day after the 1st does not ask it
  // again and draws it quiet; the 1st itself still asks, so it reads its count.
  const first = `${month}-01`;
  const quiet = first < today;
  await seed(met, "times_per_month", 1, [first]);

  const context = await browser.newContext({ storageState: person.sessionFile, baseURL: baseURL! });
  try {
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.getByRole("main").getByText(goalName, { exact: true })).toBeVisible();
    const row = (name: string) => page.getByRole("button", { name: new RegExp(`^${name}`) });
    await expect(row(weekly)).toContainText(`${inWeek.length} de 3 esta semana`);
    await expect(row(monthly)).toContainText(`${inMonth.length} de 4 este mes`);
    await expect(row(met)).toContainText(quiet ? "cumplida este mes · 1 de 1" : "1 de 1 este mes");
    await expect(row(met).filter({ hasText: /cumplida/ })).toHaveCount(quiet ? 1 : 0);
  } finally {
    await context.close();
    await db`delete from goals.goals where id = ${goal.id}`;
  }
});
