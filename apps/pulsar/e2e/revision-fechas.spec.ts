import type { Page } from "@playwright/test";

import { civilDateToDate, dateToCivilDate, todayInZone, weekOf } from "@/lib/zone";

import { test, expect, laneNumber } from "./fixtures";

function dayAfter(day: string, days: number): string {
  const date = civilDateToDate(day);
  date.setUTCDate(date.getUTCDate() + days);
  return dateToCivilDate(date);
}

const format = new Intl.DateTimeFormat("es", { day: "numeric", month: "short", timeZone: "UTC" });

function range(from: string, to: string): string {
  return format.formatRange(civilDateToDate(from), civilDateToDate(to));
}

// The Wednesday of the week two Mondays back, so the review holds three
// weeks whatever weekday the spec runs on.
test("each review row prints its dates, week 1 from the opening day to its Sunday (RP-17, RNP-07)", async ({
  page,
  db,
  personId,
}) => {
  const lane = laneNumber();
  const goalName = `Meta fechas ${lane} ${Date.now()}`;
  const measureName = `Medida fechas ${lane} ${Date.now()}`;

  await page.goto("/metas/nueva");
  await page.getByLabel("nombre").fill(goalName);
  await page.getByRole("button", { name: "Abrirla" }).click();
  await page.waitForURL(/\/metas\/[0-9a-f-]{36}$/);
  const goalId = page.url().split("/metas/")[1];

  try {
    await addMeasure(page, goalId, measureName);

    const firstMonday = dayAfter(weekOf(todayInZone())[0], -14);
    const openedOn = dayAfter(firstMonday, 2);
    const openedDaysBack =
      (civilDateToDate(todayInZone()).getTime() - civilDateToDate(openedOn).getTime()) / 86_400_000;
    const backdatedAt = new Date(Date.now() - openedDaysBack * 86_400_000);
    await db`update goals.goals set created_at = ${backdatedAt} where id = ${goalId} and user_id = ${personId}`;

    const week1 = range(openedOn, dayAfter(firstMonday, 6));
    const week2 = range(dayAfter(firstMonday, 7), dayAfter(firstMonday, 13));
    const week3 = range(dayAfter(firstMonday, 14), dayAfter(firstMonday, 20));
    expect(week1).not.toBe(week2);

    await page.goto(`/metas/${goalId}/revision`);

    const items = page.getByRole("listitem");
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toContainText(week1);
    await expect(items.nth(1)).toContainText(week2);
    await expect(items.nth(2)).toContainText(week3);

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(360);

    await page.setViewportSize({ width: 1280, height: 900 });
    const rows = page.getByRole("table").getByRole("row");
    await expect(rows.nth(1).getByRole("cell").nth(0)).toContainText(week1);
    await expect(rows.nth(2).getByRole("cell").nth(0)).toContainText(week2);
    await expect(rows.nth(3).getByRole("cell").nth(0)).toContainText(week3);
    const labelWidth = await rows
      .nth(0)
      .getByRole("columnheader")
      .nth(0)
      .evaluate((el) => el.getBoundingClientRect().width);
    expect(labelWidth).toBeGreaterThanOrEqual(150);
  } finally {
    await db`delete from goals.goals where id = ${goalId} and user_id = ${personId}`;
  }
});

async function addMeasure(page: Page, goalId: string, name: string): Promise<void> {
  await page.goto(`/metas/${goalId}`);
  await page.getByRole("link", { name: "Añadir un compromiso" }).click();
  await page.waitForURL(`**/metas/${goalId}/compromisos/nuevo`);
  await page.getByLabel("qué es").fill(name);
  await page.getByRole("button", { name: "un número", exact: true }).click();
  await page.getByLabel("cantidad").fill("5");
  await page.getByLabel("unidad").fill("minutos");
  await page.getByRole("button", { name: "Añadirlo" }).click();
  await page.waitForURL(`**/metas/${goalId}`);
}
