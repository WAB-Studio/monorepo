import type postgres from "postgres";

import { test, expect } from "./fixtures";
import { civilDateToDate, dateToCivilDate, todayInZone } from "@/lib/zone";

// RP-06 from the week (`Semana.dc.html`): a past day's label is the way into
// that day's own screen; today's is plain text, a future day's is too. Each
// test seeds its own goal, backdated so its commitment exists on every day
// of the week, and drops it by the id it got back.

function shift(day: string, by: number): string {
  const date = civilDateToDate(day);
  date.setUTCDate(date.getUTCDate() + by);
  return dateToCivilDate(date);
}

// Monday is 0, as `weekOf` counts a week.
function weekdayIndex(day: string): number {
  return (civilDateToDate(day).getUTCDay() + 6) % 7;
}

// ICU's Spanish, never the catalogue's list the screen reads.
function openName(day: string): string {
  const date = civilDateToDate(day);
  const weekday = new Intl.DateTimeFormat("es", { weekday: "long", timeZone: "UTC" }).format(date);
  return `Abrir el ${weekday} ${date.getUTCDate()}`;
}

function shortLabel(day: string): string {
  const weekday = new Intl.DateTimeFormat("es", { weekday: "short", timeZone: "UTC" })
    .format(civilDateToDate(day))
    .replace(".", "");
  return `${weekday} ${Number(day.slice(8, 10))}`;
}

async function seedGoal(db: postgres.Sql, personId: string, name: string) {
  const stamp = Date.now();
  const [goal] = await db<{ id: string }[]>`
    insert into goals.goals (user_id, name, horizon)
    values (${personId}, ${`Meta semana pasada ${stamp}`}, ${shift(todayInZone(), 60)}) returning id
  `;
  await db`
    insert into goals.commitments (user_id, goal_id, name, cadence_kind, satisfaction, created_at)
    values (${personId}, ${goal.id}, ${name}, 'daily', 'tap', ${new Date(Date.now() - 12 * 86_400_000)})
  `;
  return goal.id;
}

async function deleteGoal(db: postgres.Sql, personId: string, goalId: string) {
  await db`delete from goals.goals where id = ${goalId} and user_id = ${personId}`;
}

const today = todayInZone();
const daysBack = weekdayIndex(today);
const weekDays = Array.from({ length: 7 }, (_, i) => shift(today, i - daysBack));
const pastDays = weekDays.filter((day) => day < today);
const futureDays = weekDays.filter((day) => day > today);

test("a past day of the week is a link to its own screen, today and a future day are not (RP-06)", async ({
  page,
  db,
  personId,
}) => {
  const goalId = await seedGoal(db, personId, `Compromiso semana ${Date.now()}`);
  try {
    await page.goto("/semana");
    const section = page.locator("section", { hasText: "Meta semana pasada" }).first();
    await expect(section).toBeVisible();

    await expect(section.getByRole("link")).toHaveCount(pastDays.length);
    for (const day of pastDays) {
      const link = section.getByRole("link", { name: openName(day) });
      await expect(link).toHaveAttribute("href", `/dia/${day}`);
      await expect(link).toHaveText(shortLabel(day));
    }

    // Plain text, never a link: the label is there, no `Abrir` names it.
    for (const day of [today, ...futureDays]) {
      await expect(section.getByRole("link", { name: openName(day) })).toHaveCount(0);
      await expect(section.getByText(shortLabel(day), { exact: true })).toBeVisible();
    }
    await expect(section.getByRole("link", { name: /^Abrir el/ })).toHaveCount(pastDays.length);
  } finally {
    await deleteGoal(db, personId, goalId);
  }
});

test("a tap on a past day from the week fills that day's dot on return (RP-06)", async ({ page, db, personId }) => {
  test.skip(pastDays.length === 0, "a Monday's week holds no past day");
  const name = `Compromiso semana ${Date.now()}`;
  const goalId = await seedGoal(db, personId, name);
  const day = pastDays[pastDays.length - 1];

  try {
    await page.goto("/semana");
    const section = page.locator("section", { hasText: "Meta semana pasada" }).first();
    const dot = section.getByRole("img", { name: `${name}: pendiente` });
    await expect(dot).toHaveCount(weekDays.length);
    const row = section.locator("div").filter({ has: page.getByRole("link", { name: openName(day) }) });
    await expect(row.getByRole("img")).toHaveAttribute("data-state", "empty");

    await section.getByRole("link", { name: openName(day) }).click();
    await page.waitForURL(`**/dia/${day}`);
    await page.locator("button", { hasText: name }).click();
    await expect(page.locator("button", { hasText: name }).locator("svg")).toBeVisible();

    await page.goto("/semana");
    await expect(row.getByRole("img")).toHaveAttribute("data-state", "declared");
    await expect(row.getByRole("img")).toHaveAccessibleName(`${name}: hecho`);
  } finally {
    await deleteGoal(db, personId, goalId);
  }
});

test("the week holds at 360px with its links, every row at least 56px (RP-06, RNP-07)", async ({
  page,
  db,
  personId,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const goalId = await seedGoal(db, personId, `Compromiso semana ${Date.now()}`);
  try {
    await page.goto("/semana");
    const section = page.locator("section", { hasText: "Meta semana pasada" }).first();
    await expect(section).toBeVisible();

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(360);

    const heights = await section
      .locator(":scope > button, :scope > div")
      .filter({ has: page.locator('[role="img"]') })
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
    expect(heights.length).toBe(7);
    for (const height of heights) expect(height).toBeGreaterThanOrEqual(56);
    await page.screenshot({ path: "private/semana-pasado-360.png", fullPage: true });
  } finally {
    await deleteGoal(db, personId, goalId);
  }
});
