import { test, expect } from "./fixtures";
import { civilDateToDate, dateToCivilDate, todayInZone } from "@/lib/zone";

// `RoadmapHoyMovido.dc.html`, `RoadmapHoyMovidoDias.dc.html` (module 353,
// RP-52): a goal whose last month closed short draws the card; «Entendido»
// writes `plan_seen` and a reload keeps it gone; a goal whose month met its
// room draws none; the next task of the plan says this month's part.

function monthStartOf(offset: number): string {
  const date = civilDateToDate(`${todayInZone().slice(0, 7)}-01`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return dateToCivilDate(date);
}

for (const width of [390, 1440]) {
  test(`Hoy at ${width} says the plan moved, dismisses it for good, and names the next task of the plan`, async ({
    person,
    browser,
    baseURL,
    db,
  }) => {
    const stamp = Date.now();
    const closed = monthStartOf(-1);
    const shortName = `Meta corta ${stamp}`;
    const metName = `Meta cumplida ${stamp}`;
    const bigName = `Tarea grande ${stamp}`;

    const seedGoal = async (name: string) => {
      const [goal] = await db<{ id: string }[]>`
        insert into goals.goals (user_id, name, horizon, measure_name, measure_unit, rhythm, created_at)
        values (${person.id}, ${name}, '2099-12-31'::date, 'minutos', 'minutos', 600, '2020-01-01T00:00:00Z'::timestamptz)
        returning id
      `;
      return goal.id;
    };
    const seedTask = async (goal: string, name: string, estimate: number, created: string, doneOn: string | null) => {
      const [task] = await db<{ id: string }[]>`
        insert into goals.one_offs (user_id, goal_id, name, estimate, in_plan, created_at)
        values (${person.id}, ${goal}, ${name}, ${estimate}, true, ${created}::timestamptz) returning id
      `;
      if (doneOn !== null) {
        await db`
          insert into goals.facts (user_id, goal_id, one_off_id, day)
          values (${person.id}, ${goal}, ${task.id}, ${doneOn}::date)
        `;
      }
    };

    // 5 h done of the closed month's 12 h: the end moves.
    const short = await seedGoal(shortName);
    await seedTask(short, `Hecha corta ${stamp}`, 300, "2020-01-01T00:00:00Z", closed);
    await seedTask(short, bigName, 1800, "2020-01-02T00:00:00Z", null);
    await db`
      insert into goals.month_budgets (user_id, goal_id, month, amount) values (${person.id}, ${short}, ${closed}::date, 720)
    `;
    // 10 h done of its 10 h: the end stays.
    const met = await seedGoal(metName);
    await seedTask(met, `Hecha cumplida ${stamp}`, 600, "2020-01-01T00:00:00Z", closed);
    await seedTask(met, `Resto ${stamp}`, 1800, "2020-01-02T00:00:00Z", null);

    const context = await browser.newContext({ storageState: person.sessionFile, baseURL: baseURL! });
    try {
      const page = await context.newPage();
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const seen = (text: string | RegExp) => page.getByText(text).locator("visible=true");
      const title = seen(new RegExp(`^Tu plan de ${shortName} se movió \\d+ (día|días|semana|semanas)$`));

      await expect.soft(title, "a goal whose month closed short draws the card").toHaveCount(1);
      await expect.soft(seen(new RegExp(`^Tu plan de ${metName}`)), "a goal whose month met its room draws none").toHaveCount(0);
      await expect.soft(seen(/cerró con 5 h de 12 h\./)).toHaveCount(1);
      await expect.soft(seen("Siguiente del plan · 10 h").first(), "the next task reads the part, not the estimate").toBeVisible();
      await expect.soft(page.getByRole("link", { name: "Ver el plan" }).locator("visible=true")).toHaveAttribute(
        "href",
        `/metas/${short}/plan`,
      );

      await page.getByRole("button", { name: "Entendido" }).locator("visible=true").click();
      await expect(title, "Entendido removes the card").toHaveCount(0);
      await page.reload();
      await expect(page.locator("main")).toHaveCount(1);
      await expect(seen(shortName).first()).toBeVisible();
      await expect(title, "a reload keeps it gone").toHaveCount(0);
      await expect(page.getByRole("button", { name: "Entendido" }).locator("visible=true")).toHaveCount(0);
    } finally {
      await context.close();
      await db`delete from goals.goals where user_id = ${person.id}`;
    }
  });
}
