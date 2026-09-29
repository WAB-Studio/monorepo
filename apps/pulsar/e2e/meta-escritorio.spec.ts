import type { Page } from "@playwright/test";
import type postgres from "postgres";

import { horizonForWeeks } from "@/lib/day/weeks";
import { civilDateInZone } from "@/lib/zone";

import { test, expect } from "./fixtures";

// RNP-11: the goal opens in two columns from 1024 — the commitments left, the
// end, the figure and the phases right — and «Renombrar» and «Archivar» sit
// beside the title. Below 1024 the order is the phone's own.

async function seedGoal(db: postgres.Sql, personId: string, name: string): Promise<string> {
  const createdAt = new Date(Date.now() - 2 * 86_400_000);
  const openedOn = civilDateInZone(createdAt);
  const [goal] = await db<{ id: string }[]>`
    insert into goals.goals (user_id, name, horizon, created_at)
    values (${personId}, ${name}, ${horizonForWeeks(openedOn, 12)}, ${createdAt})
    returning id
  `;
  await db`
    insert into goals.commitments (user_id, goal_id, name, cadence_kind, satisfaction)
    values (${personId}, ${goal.id}, 'Compromiso ancho', 'daily', 'tap')
  `;
  await db`
    insert into goals.phases (user_id, goal_id, aim, starts_on, ends_on)
    values (${personId}, ${goal.id}, 'Fase ancha', ${openedOn}, ${openedOn})
  `;
  return goal.id;
}

async function boxOf(page: Page, text: string) {
  return page.getByText(text, { exact: true }).evaluate((el) => {
    const { x, y } = el.getBoundingClientRect();
    return { x, y };
  });
}

test("at 1280 the commitments sit left, the end and the phases right, one of each act visible (RNP-11)", async ({
  page,
  db,
  personId,
}) => {
  const name = `Meta ancha ${Date.now()}`;
  const goalId = await seedGoal(db, personId, name);
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/metas/${goalId}`);

    const commitment = await boxOf(page, "Compromiso ancho");
    const phase = await boxOf(page, "Fase ancha");
    const end = await page.getByText(/^12 semanas · hasta el /).evaluate((el) => {
      const { x, y } = el.getBoundingClientRect();
      return { x, y };
    });
    expect(phase.x).toBeGreaterThan(commitment.x + 300);
    expect(end.x).toBeGreaterThan(commitment.x + 300);
    expect(end.y).toBeLessThan(phase.y);

    await expect(page.getByRole("button", { name: "Renombrar" })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Archivar" })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "mover el final" })).toHaveCount(1);
    const title = await boxOf(page, name);
    const rename = await page.getByRole("button", { name: "Renombrar" }).boundingBox();
    expect(rename!.x).toBeGreaterThan(title.x);
    expect(Math.abs(rename!.y - title.y)).toBeLessThan(40);
  } finally {
    await db`delete from goals.goals where id = ${goalId} and user_id = ${personId}`;
  }
});

test("at 360 the order is the phone's: end, commitments, phases, then «Archivar esta meta» (RNP-11)", async ({
  page,
  db,
  personId,
}) => {
  const goalId = await seedGoal(db, personId, `Meta angosta ${Date.now()}`);
  try {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(`/metas/${goalId}`);

    const end = await page.getByText(/^12 semanas · hasta el /).boundingBox();
    const commitment = await page.getByText("Compromiso ancho", { exact: true }).boundingBox();
    const phase = await page.getByText("Fase ancha", { exact: true }).boundingBox();
    const archive = await page.getByRole("button", { name: "Archivar esta meta" }).boundingBox();
    expect(end!.y).toBeLessThan(commitment!.y);
    expect(commitment!.y).toBeLessThan(phase!.y);
    expect(phase!.y).toBeLessThan(archive!.y);

    await expect(page.getByRole("button", { name: "Renombrar" })).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
  } finally {
    await db`delete from goals.goals where id = ${goalId} and user_id = ${personId}`;
  }
});
