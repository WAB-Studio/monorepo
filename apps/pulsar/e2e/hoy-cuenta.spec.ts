import { test, expect, mintDisposablePerson } from "./fixtures";
import { civilDateToDate, dateToCivilDate, todayInZone, weekOf } from "@/lib/zone";

// `HoyCuenta.dc.html` (module 96): Hoy counts «hechos N de M» over the rows
// the Semana counts, and a flexible met in its period stays as a quiet row.

function plusDays(days: number): string {
  const date = civilDateToDate(todayInZone());
  date.setUTCDate(date.getUTCDate() + days);
  return dateToCivilDate(date);
}

test("«hechos» moves as a row is tapped and matches the Semana's cell; a met flexible stays quiet and tappable; a flexible row fits at 360", async ({
  browser,
  baseURL,
  db,
}) => {
  const person = mintDisposablePerson(baseURL ?? "http://localhost:3200");
  const stamp = Date.now();
  const goalName = `Meta cuenta ${stamp}`;
  const first = `Primero ${stamp}`;
  const second = `Segundo ${stamp}`;
  const partial = `Parcial ${stamp}`;
  const met = `Cumplida ${stamp}`;
  const today = todayInZone();
  const week = weekOf(today);
  // A fact earlier in this week's period is only possible after Monday; the
  // month has a first day before today except on the 1st.
  const earlier = week[0] < today ? week[0] : null;

  const [goal] = await db<{ id: string }[]>`
    insert into goals.goals (user_id, name, horizon, created_at)
    values (${person.id}, ${goalName}, ${plusDays(90)}, now() - interval '20 days') returning id
  `;
  const commitment = async (name: string, kind: string, count: number | null) => {
    const [row] = await db<{ id: string }[]>`
      insert into goals.commitments (user_id, goal_id, name, cadence_kind, cadence_n, satisfaction, created_at)
      values (${person.id}, ${goal.id}, ${name}, ${kind}, ${count}, 'tap', now() - interval '20 days')
      returning id
    `;
    return row.id;
  };
  await commitment(first, "daily", null);
  await commitment(second, "daily", null);
  await commitment(partial, "times_per_week", 3);
  const metId = await commitment(met, "times_per_week", 1);
  if (earlier) {
    {
      await db`
        insert into goals.facts (user_id, commitment_id, goal_id, day, written_at)
        values (${person.id}, ${metId}, ${goal.id}, ${earlier}, now())
      `;
    }
  }

  const context = await browser.newContext({ storageState: person.sessionFile, baseURL: baseURL! });
  try {
    const page = await context.newPage();
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/");
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.getByText(goalName, { exact: true })).toBeVisible();
    await expect(page.getByText("hechos 0 de 2", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: new RegExp(`^${first}`) }).click();
    await expect(page.getByText("hechos 1 de 2", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: new RegExp(`^${second}`) }).click();
    await expect(page.getByText("hechos 2 de 2", { exact: true })).toBeVisible();

    // A flexible with progress says only its progress, on one line.
    const partialRow = page.getByRole("button", { name: new RegExp(`^${partial}`) });
    await expect(partialRow).toContainText("0 de 3 esta semana");
    await expect(partialRow).not.toContainText("veces por semana");
    const box = await partialRow.boundingBox();
    expect(box!.height).toBeLessThanOrEqual(72);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);

    // The Semana's cell for today counts the same rows.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/semana");
    await expect(page.locator("main")).toHaveCount(1);
    const table = page.getByRole("table");
    await expect(table).toBeVisible();
    await expect(table.locator("tfoot td").nth(week.indexOf(today))).toHaveText("2 de 2");

    if (earlier) {
      await page.setViewportSize({ width: 360, height: 800 });
      await page.goto("/");
      await expect(page.locator("main")).toHaveCount(1);
      const quiet = page.getByRole("button", { name: new RegExp(`^${met}`) });
      await expect(quiet).toContainText("cumplida esta semana · 1 de 1");
      await expect(page.getByText("hechos 2 de 2", { exact: true })).toBeVisible();

      await quiet.click();
      await expect(quiet).toContainText("cumplida esta semana · 2 veces");
      await expect(page.getByText("hechos 2 de 2", { exact: true })).toBeVisible();
      const [{ count }] = await db<{ count: number }[]>`
        select count(*)::int as count from goals.facts where user_id = ${person.id} and day = ${today}
      `;
      expect(count).toBe(3);

      await quiet.click();
      await expect(quiet).toContainText("cumplida esta semana · 1 de 1");
    }
  } finally {
    await context.close();
    await db`delete from goals.goals where id = ${goal.id}`;
  }
});
