import type postgres from "postgres";

import { test, expect } from "./fixtures";
import { civilDateToDate, dateToCivilDate, todayInZone } from "@/lib/zone";

// RP-16 with creation honoured (module 64): a goal opened inside the week
// draws no dot and no count on the days before, and a past day that did ask
// still reads "N de M". Each test seeds its own goals and drops them by id.

function shift(day: string, by: number): string {
  const date = civilDateToDate(day);
  date.setUTCDate(date.getUTCDate() + by);
  return dateToCivilDate(date);
}

function weekdayIndex(day: string): number {
  return (civilDateToDate(day).getUTCDay() + 6) % 7;
}

function shortLabel(day: string): string {
  const weekday = new Intl.DateTimeFormat("es", { weekday: "short", timeZone: "UTC" })
    .format(civilDateToDate(day))
    .replace(".", "");
  return `${weekday} ${Number(day.slice(8, 10))}`;
}

const today = todayInZone();
const weekDays = Array.from({ length: 7 }, (_, i) => shift(today, i - weekdayIndex(today)));
// Today, or tomorrow when today is Monday: inside the week either way.
const creationDay = weekdayIndex(today) === 0 ? shift(today, 1) : today;
const beforeCreation = weekDays.filter((day) => day < creationDay);
const fromCreation = weekDays.filter((day) => day >= creationDay);
const pastDays = weekDays.filter((day) => day < today);

// Noon Bogotá on the civil day: the same civil day in every zone near it.
function noonOf(day: string): Date {
  return new Date(`${day}T17:00:00Z`);
}

async function seedGoal(db: postgres.Sql, personId: string, name: string, createdAt: Date) {
  const [goal] = await db<{ id: string }[]>`
    insert into goals.goals (user_id, name, horizon)
    values (${personId}, ${name}, ${shift(today, 60)}) returning id
  `;
  const [commitment] = await db<{ id: string }[]>`
    insert into goals.commitments (user_id, goal_id, name, cadence_kind, satisfaction, created_at)
    values (${personId}, ${goal.id}, ${`Compromiso ${name}`}, 'daily', 'tap', ${createdAt}) returning id
  `;
  return { goalId: goal.id, commitmentId: commitment.id };
}

test("a goal opened this week draws no dot and no count before it, its dot from then on (RP-16)", async ({
  page,
  db,
  personId,
}) => {
  const name = `Meta creada ${Date.now()}`;
  const { goalId, commitmentId } = await seedGoal(db, personId, name, new Date(Date.now() - 30 * 86_400_000));
  try {
    await db`
      update goals.commitments set created_at = ${noonOf(creationDay)}
      where id = ${commitmentId} and user_id = ${personId}
    `;
    await page.goto("/semana");
    const section = page.locator("section", { hasText: name });
    await expect(section).toBeVisible();

    const row = (day: string) =>
      section.locator("button, div").filter({ hasText: shortLabel(day) }).first();

    for (const day of beforeCreation) {
      await expect(row(day).locator('[role="img"]')).toHaveCount(0);
      await expect(row(day)).not.toContainText(/\d+ de \d+/);
    }
    for (const day of fromCreation) {
      await expect(row(day).locator('[role="img"]')).toHaveCount(1);
    }
    // Today keeps "hoy" even when it holds no dot yet.
    await expect(row(today)).toContainText("hoy");
    // No day of this goal reads a "0 de 0".
    await expect(section.getByText("0 de 0")).toHaveCount(0);
  } finally {
    await db`delete from goals.goals where id = ${goalId} and user_id = ${personId}`;
  }
});

test("a past day that asked still reads its count (RP-06)", async ({ page, db, personId }) => {
  test.skip(pastDays.length === 0, "Monday has no past day in its own week");
  const name = `Meta con historia ${Date.now()}`;
  const { goalId } = await seedGoal(db, personId, name, new Date(Date.now() - 30 * 86_400_000));
  try {
    await page.goto("/semana");
    const section = page.locator("section", { hasText: name });
    await expect(section).toBeVisible();
    for (const day of pastDays) {
      await expect(
        section.locator("button, div").filter({ hasText: shortLabel(day) }).first(),
      ).toContainText("0 de 1");
    }
  } finally {
    await db`delete from goals.goals where id = ${goalId} and user_id = ${personId}`;
  }
});
