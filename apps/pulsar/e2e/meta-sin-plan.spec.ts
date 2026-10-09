import type { Page } from "@playwright/test";
import type postgres from "postgres";

import { monthOf } from "@/lib/plan/months";
import { civilDateToDate, dateToCivilDate, todayInZone } from "@/lib/zone";

import roadmap from "../messages/es/roadmap.json";
import { test, expect } from "./fixtures";

// RP-62, `MetaSinPlan` / `MetaSinPlanTareas`: a goal that does not measure
// time has no «El plan» section and no rhythm form; its tasks live in the
// month they are pinned to. Each goal is seeded under this spec's own
// identity and deleted by id in `finally`.

const today = todayInZone();
const monthStart = monthOf(today);
const horizon = (() => {
  const date = civilDateToDate(today);
  date.setUTCDate(date.getUTCDate() + 80);
  return dateToCivilDate(date);
})();

const monthName = new Intl.DateTimeFormat("es", { month: "long", timeZone: "UTC" }).format(
  new Date(`${monthStart}T12:00:00Z`),
);
const PLAN_LABEL = new RegExp(`^${roadmap.meta.planLabel}$`, "i");
const BUILD = roadmap.meta.build;
const HOURS_PER_MONTH = roadmap.sinRitmo.hoursPerMonth;

async function seedGoal(
  db: postgres.Sql,
  personId: string,
  input: { unit: string | null; tasks: number; budget: number | null },
) {
  const [goal] = await db<{ id: string }[]>`
    insert into goals.goals (user_id, name, horizon, measure_name, measure_unit, created_at)
    values (${personId}, ${`Meta sin plan ${Date.now()}`}, ${horizon}::date, ${input.unit}, ${input.unit},
            now() - interval '5 days')
    returning id
  `;
  for (let index = 1; index <= input.tasks; index++) {
    await db`
      insert into goals.one_offs (user_id, goal_id, name, estimate, position, in_plan, planned_month)
      values (${personId}, ${goal.id}, ${`Tarea ${index}`}, ${input.unit === "minutos" ? 240 : null}, ${index}, true,
              ${input.unit === "minutos" ? null : monthStart}::date)
    `;
  }
  if (input.budget !== null) {
    await db`
      insert into goals.month_budgets (user_id, goal_id, month, amount)
      values (${personId}, ${goal.id}, ${monthStart}::date, ${input.budget})
    `;
  }
  return goal.id;
}

async function drop(db: postgres.Sql, personId: string, goalId: string) {
  await db`delete from goals.month_budgets where goal_id = ${goalId} and user_id = ${personId}`;
  await db`delete from goals.one_offs where goal_id = ${goalId} and user_id = ${personId}`;
  await db`delete from goals.goals where id = ${goalId} and user_id = ${personId}`;
}

const planLink = (page: Page) => page.locator('a[href$="/plan"]');

for (const width of [360, 390, 1440]) {
  test.describe(`at ${width}`, () => {
    test.use({ viewport: { width, height: 900 } });

    test("a km goal with tasks has no «El plan» section, keeps its month and «Ver por mes», and does not overflow", async ({
      page,
      db,
      personId,
    }) => {
      const goalId = await seedGoal(db, personId, { unit: "km", tasks: 3, budget: 40 });
      try {
        await page.goto(`/metas/${goalId}`);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expect(page.getByRole("link", { name: "Ver por mes", exact: true }).locator("visible=true")).toBeVisible();
        await expect(page.getByText(/de 40/).locator("visible=true").first()).toBeVisible();
        await expect(page.getByText(PLAN_LABEL)).toHaveCount(0);
        await expect(page.getByText(BUILD)).toHaveCount(0);
        await expect(planLink(page)).toHaveCount(0);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
      } finally {
        await drop(db, personId, goalId);
      }
    });

    test("«Ver por mes» of a km goal leads to a month that lists its pinned tasks", async ({ page, db, personId }) => {
      const goalId = await seedGoal(db, personId, { unit: "km", tasks: 3, budget: 40 });
      try {
        await page.goto(`/metas/${goalId}`);
        await page.getByRole("link", { name: "Ver por mes", exact: true }).locator("visible=true").click();
        await expect(page).toHaveURL(/\/meses$/);
        await page.getByRole("link", { name: new RegExp(monthName, "i") }).locator("visible=true").first().click();
        await expect(page.getByText("Tarea 1").locator("visible=true").first()).toBeVisible();
        await expect(page.getByText("Tarea 3").locator("visible=true").first()).toBeVisible();
      } finally {
        await drop(db, personId, goalId);
      }
    });

    test("/metas/<km goal>/plan never shows the rhythm form: it lands on the goal", async ({ page, db, personId }) => {
      const goalId = await seedGoal(db, personId, { unit: "km", tasks: 3, budget: 40 });
      try {
        await page.goto(`/metas/${goalId}/plan`);
        await expect(page).toHaveURL(new RegExp(`/metas/${goalId}$`));
        await expect(page.getByText(HOURS_PER_MONTH, { exact: true })).toHaveCount(0);
        await expect(page.getByText(/cuántas horas al mes/i)).toHaveCount(0);
        await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("El plan");
      } finally {
        await drop(db, personId, goalId);
      }
    });

    test("a minutes goal with tasks keeps «El plan» and its way in", async ({ page, db, personId }) => {
      const goalId = await seedGoal(db, personId, { unit: "minutos", tasks: 5, budget: null });
      try {
        await page.goto(`/metas/${goalId}`);
        await expect(page.getByText(PLAN_LABEL).locator("visible=true")).toBeVisible();
        await expect(page.getByText(BUILD).locator("visible=true").first()).toBeVisible();
        await page.goto(`/metas/${goalId}/plan`);
        await expect(page).toHaveURL(new RegExp(`/metas/${goalId}/plan$`));
        await expect(page.getByText(HOURS_PER_MONTH, { exact: true })).toBeVisible();
      } finally {
        await drop(db, personId, goalId);
      }
    });

    test("a km goal with no tasks has no «El plan» section either", async ({ page, db, personId }) => {
      const goalId = await seedGoal(db, personId, { unit: "km", tasks: 0, budget: 40 });
      try {
        await page.goto(`/metas/${goalId}`);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expect(page.getByText(PLAN_LABEL)).toHaveCount(0);
        await expect(planLink(page)).toHaveCount(0);
      } finally {
        await drop(db, personId, goalId);
      }
    });

    test("a goal with no measure draws no «El plan» section", async ({ page, db, personId }) => {
      const goalId = await seedGoal(db, personId, { unit: null, tasks: 0, budget: null });
      try {
        await page.goto(`/metas/${goalId}`);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expect(page.getByText(PLAN_LABEL)).toHaveCount(0);
      } finally {
        await drop(db, personId, goalId);
      }
    });
  });
}
