import { test, expect } from "./fixtures";
import { civilDateToDate, dateToCivilDate, todayInZone, weekOf } from "@/lib/zone";

// `HoyMes.dc.html`, `HoyMesBajo.dc.html` (module 135): Hoy says each goal's
// month amount in hours and minutes, and from the 20th a goal under 60 % says
// its pace. The pace branch follows the clock the app reads, so both branches
// are written and the one true today is asserted.

function plusDays(days: number): string {
  const date = civilDateToDate(todayInZone());
  date.setUTCDate(date.getUTCDate() + days);
  return dateToCivilDate(date);
}

test("Hoy draws the month line in hours and minutes, the pace line from the 20th, and none on a past day", async ({
  person,
  browser,
  baseURL,
  db,
}) => {
  const stamp = Date.now();
  const today = todayInZone();
  const monthStart = `${today.slice(0, 7)}-01`;
  const late = Number(today.slice(8, 10)) >= 20;
  const underName = `Meta bajo ${stamp}`;
  const exactName = `Meta justa ${stamp}`;
  const bareName = `Meta sin monto ${stamp}`;

  const seedGoal = async (name: string, budget: number | null) => {
    const [goal] = await db<{ id: string }[]>`
      insert into goals.goals (user_id, name, horizon, measure_name, measure_unit, created_at)
      values (${person.id}, ${name}, ${plusDays(90)}, 'minutos', 'minutos', now() - interval '40 days')
      returning id
    `;
    if (budget !== null) {
      await db`
        insert into goals.month_budgets (user_id, goal_id, month, amount)
        values (${person.id}, ${goal.id}, ${monthStart}::date, ${budget})
      `;
    }
    return goal.id;
  };
  const quantity = async (goalId: string, name: string, minutes: number, day: string) => {
    const [commitment] = await db<{ id: string }[]>`
      insert into goals.commitments
        (user_id, goal_id, name, cadence_kind, satisfaction, target_quantity, unit, created_at)
      values (${person.id}, ${goalId}, ${name}, 'daily', 'quantity', 30, 'minutos', now() - interval '40 days')
      returning id
    `;
    await db`
      insert into goals.facts (user_id, goal_id, commitment_id, day, quantity)
      values (${person.id}, ${goalId}, ${commitment.id}, ${day}::date, ${minutes})
    `;
  };

  // 720 planned: 300 + 90 declared and a 15-minute task reach 405, 56 %.
  const under = await seedGoal(underName, 720);
  await quantity(under, `Sesión A ${stamp}`, 300, monthStart);
  await quantity(under, `Sesión B ${stamp}`, 90, today);
  const [task] = await db<{ id: string }[]>`
    insert into goals.one_offs (user_id, goal_id, name, planned_month, estimate)
    values (${person.id}, ${under}, ${`Tarea ${stamp}`}, ${monthStart}::date, 15) returning id
  `;
  await db`
    insert into goals.facts (user_id, goal_id, one_off_id, day)
    values (${person.id}, ${under}, ${task.id}, ${monthStart}::date)
  `;
  // 432 of 720 is exactly 60 %: not under it.
  const exact = await seedGoal(exactName, 720);
  await quantity(exact, `Sesión C ${stamp}`, 432, monthStart);
  // A measure and facts, no amount this month.
  const bare = await seedGoal(bareName, null);
  await quantity(bare, `Sesión D ${stamp}`, 100, monthStart);

  const pace = `día ${Number(today.slice(8, 10))} · 56 %, bajo el 60 %`;
  const context = await browser.newContext({ storageState: person.sessionFile, baseURL: baseURL! });
  try {
    const page = await context.newPage();
    const seen = (text: string) => page.getByText(text, { exact: true }).locator("visible=true");
    const lines = async (weekSays: number) => {
      await expect(page.locator("main")).toHaveCount(1);
      await expect(seen(underName).first()).toBeVisible();
      await expect(seen("6 h 45 min")).toHaveCount(1 + weekSays);
      await expect(seen("7 h 12 min")).toHaveCount(1 + weekSays);
      await expect(seen("de 12 h")).toHaveCount(2);
      // From the 20th the under-60 goal says its pace and the 60 % one does not;
      // before it, neither does.
      if (late) await expect(seen(pace)).toHaveCount(1);
      await expect(page.getByText(/bajo el 60 %/).locator("visible=true")).toHaveCount(late ? 1 : 0);
    };

    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/");
    await lines(0);
    await expect(seen("este mes")).toHaveCount(1);
    await expect(seen(bareName).first()).toBeVisible();
    // The goal with no amount is a row of the day, never a line of the block.
    await expect(page.getByText("de 12 h", { exact: true }).locator("visible=true")).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    // The card keeps its week figure and now reads it in hours and minutes:
    // 90 this week, or the whole 405 in the first days of a month.
    const inWeek = weekOf(today).includes(monthStart);
    await lines(inWeek ? 1 : 0);
    if (!inWeek) await expect(seen("1 h 30 min")).toHaveCount(1);

    // Never on a past day (the ended line's own guard).
    await page.goto(`/dia/${plusDays(-1)}`);
    await expect(page.locator("main")).toHaveCount(1);
    await expect(seen(underName).first()).toBeVisible();
    await expect(seen("de 12 h")).toHaveCount(0);
    await expect(seen("este mes")).toHaveCount(0);
    await expect(page.getByText(/bajo el 60 %/).locator("visible=true")).toHaveCount(0);
  } finally {
    await context.close();
    await db`delete from goals.goals where user_id = ${person.id}`;
  }
});
