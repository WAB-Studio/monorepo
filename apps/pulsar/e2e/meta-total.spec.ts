import type { Locator, Page } from "@playwright/test";
import type postgres from "postgres";

import { dateToCivilDate, todayInZone } from "@/lib/zone";

import { test, expect, type Person } from "./fixtures";

// RP-14, RP-28: the figure beside «mide en minutos» is the goal's total since
// it opened, and a quiet line under it says so: «en total, desde el 1 de
// enero» (`MetaTotal`, board words of wave 4). The date is DM Mono inside an
// Archivo sentence; the year shows only when it is not the current one. «0 min»
// stays at zero, and a goal with no measure draws neither figure nor line.

const WIDTHS: [number, number][] = [
  [390, 844],
  [1440, 900],
];

const LINE = /^en total, desde el /;

// Noon in Bogotá, so the opening day is the same civil day in the zone.
function openedAt(year: number): Date {
  return new Date(`${year}-01-01T17:00:00Z`);
}

async function seedGoal(
  db: postgres.Sql,
  person: Person,
  opts: { openedYear: number; measured: boolean; minutes: number },
): Promise<{ goalId: string }> {
  const horizon = dateToCivilDate(new Date(Date.now() + 90 * 86_400_000));
  const opened = openedAt(opts.openedYear);
  const [goal] = await db<{ id: string }[]>`
    insert into goals.goals (user_id, name, horizon, measure_name, measure_unit, created_at)
    values (${person.id}, ${`Meta total ${Date.now()}`}, ${horizon}::date,
            ${opts.measured ? "Estudio" : null}, ${opts.measured ? "minutos" : null}, ${opened})
    returning id
  `;
  if (opts.measured) {
    const [commitment] = await db<{ id: string }[]>`
      insert into goals.commitments
        (user_id, goal_id, name, cadence_kind, satisfaction, target_quantity, unit, created_at)
      values (${person.id}, ${goal.id}, ${`Estudio ${Date.now()}`}, 'daily', 'quantity', 60, 'minutos', ${opened})
      returning id
    `;
    if (opts.minutes > 0) {
      await db`
        insert into goals.facts (user_id, goal_id, commitment_id, day, quantity)
        values (${person.id}, ${goal.id}, ${commitment.id}, ${todayInZone()}::date, ${opts.minutes})
      `;
    }
  }
  return { goalId: goal.id };
}

async function lineParts(line: Locator) {
  return line.evaluate((el) => ({
    text: el.textContent ?? "",
    family: getComputedStyle(el).fontFamily,
    spans: Array.from(el.querySelectorAll("span")).map((span) => ({
      text: span.textContent ?? "",
      family: getComputedStyle(span).fontFamily,
    })),
  }));
}

function totalLine(page: Page): Locator {
  return page.locator("p", { hasText: LINE }).locator("visible=true");
}

for (const [width, height] of WIDTHS) {
  test(`at ${width}px a measured goal names its figure the total since it opened`, async ({
    person,
    browser,
    baseURL,
    db,
  }) => {
    const year = Number(todayInZone().slice(0, 4));
    const { goalId } = await seedGoal(db, person, { openedYear: year, measured: true, minutes: 890 });
    const context = await browser.newContext({
      storageState: person.sessionFile,
      baseURL: baseURL!,
      viewport: { width, height },
    });
    try {
      const page = await context.newPage();
      await page.goto(`/metas/${goalId}`);
      await expect(page.getByText("mide en minutos", { exact: true })).toBeVisible();

      // Names the total, with the board's words.
      const line = totalLine(page);
      await expect(line).toHaveCount(1);
      await expect(line).toHaveText("en total, desde el 1 de enero");

      // Sits under the figure, not above it or beside the sentence.
      const figure = page.getByText(/^14 h 50 min$/).locator("visible=true").first();
      await expect(figure).toBeVisible();
      const figureBox = (await figure.boundingBox())!;
      const lineBox = (await line.boundingBox())!;
      expect(lineBox.y).toBeGreaterThanOrEqual(figureBox.y + figureBox.height - 1);

      // The date is mono, the rest of the sentence is not.
      const parts = await lineParts(line);
      expect(parts.family).not.toMatch(/mono/i);
      // One span, the whole date: the words «en total, desde el» stay outside it.
      expect(parts.spans.map((s) => s.text)).toEqual(["1 de enero"]);
      expect(parts.spans[0].family).toMatch(/mono/i);

      // The current year is never printed.
      expect(parts.text).not.toMatch(/\d{4}/);
    } finally {
      await context.close();
      await db`delete from goals.goals where id = ${goalId} and user_id = ${person.id}`;
    }
  });
}

test("a goal opened in another year carries that year in its mono date", async ({ person, browser, baseURL, db }) => {
  const lastYear = Number(todayInZone().slice(0, 4)) - 1;
  const { goalId } = await seedGoal(db, person, { openedYear: lastYear, measured: true, minutes: 890 });
  const context = await browser.newContext({ storageState: person.sessionFile, baseURL: baseURL! });
  try {
    const page = await context.newPage();
    await page.goto(`/metas/${goalId}`);
    const line = totalLine(page);
    await expect(line).toHaveCount(1);
    await expect(line).toContainText(`1 de enero`);
    const parts = await lineParts(line);
    expect(parts.text).toContain(String(lastYear));
    // The year belongs to the date: it sits inside the mono span.
    expect(parts.spans.map((s) => s.text)).toEqual([`1 de enero de ${lastYear}`]);
    expect(parts.spans[0].family).toMatch(/mono/i);
    expect(parts.family).not.toMatch(/mono/i);
  } finally {
    await context.close();
    await db`delete from goals.goals where id = ${goalId} and user_id = ${person.id}`;
  }
});

test("a measured goal with nothing done keeps «0 min» and its line", async ({ person, browser, baseURL, db }) => {
  const year = Number(todayInZone().slice(0, 4));
  const { goalId } = await seedGoal(db, person, { openedYear: year, measured: true, minutes: 0 });
  const context = await browser.newContext({ storageState: person.sessionFile, baseURL: baseURL! });
  try {
    const page = await context.newPage();
    await page.goto(`/metas/${goalId}`);
    await expect(page.getByText("mide en minutos", { exact: true })).toBeVisible();
    await expect(page.getByText(/^0 min$/).locator("visible=true").first()).toBeVisible();
    await expect(totalLine(page)).toHaveText("en total, desde el 1 de enero");
  } finally {
    await context.close();
    await db`delete from goals.goals where id = ${goalId} and user_id = ${person.id}`;
  }
});

test("a goal with no measure draws no total line and no «mide en»", async ({ person, browser, baseURL, db }) => {
  const year = Number(todayInZone().slice(0, 4));
  const { goalId } = await seedGoal(db, person, { openedYear: year, measured: false, minutes: 0 });
  const context = await browser.newContext({ storageState: person.sessionFile, baseURL: baseURL! });
  try {
    const page = await context.newPage();
    await page.goto(`/metas/${goalId}`);
    await expect(page.getByText("esta meta no mide nada", { exact: true })).toBeVisible();
    await expect(page.getByText("mide en", { exact: false })).toHaveCount(0);
    await expect(page.getByText(/en total/)).toHaveCount(0);
    await expect(page.getByText(/desde el \d/)).toHaveCount(0);
  } finally {
    await context.close();
    await db`delete from goals.goals where id = ${goalId} and user_id = ${person.id}`;
  }
});
