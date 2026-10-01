import type { Page } from "@playwright/test";

import { test, expect } from "./fixtures";
import { civilDateToDate, dateToCivilDate, todayInZone } from "@/lib/zone";

// A one-column screen is 640 px of content beside the rail, on any computer
// (module 90). The two-column screens keep the room the rail leaves.

// `goto` returns while the loading skeleton still stands: measure only once
// the screen's own content is there and the skeleton's `main` has gone.
async function open(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.locator("main :is(h1, p, a, button, input)").first()).toBeVisible();
  await expect(page.locator("main")).toHaveCount(1);
}

function plusDays(days: number): string {
  const date = civilDateToDate(todayInZone());
  date.setUTCDate(date.getUTCDate() + days);
  return dateToCivilDate(date);
}

// The screen's own content box: the `main` less its padding.
async function contentWidth(page: Page): Promise<number> {
  return page.evaluate(() => {
    const main = document.querySelector("main")!;
    const style = getComputedStyle(main);
    return main.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  });
}

async function widest(page: Page): Promise<number> {
  return page.evaluate(() => {
    const main = document.querySelector("main")!;
    return Math.max(...Array.from(main.querySelectorAll("input, a, button, h1, p")).map((el) => el.getBoundingClientRect().width));
  });
}

const CAPPED = 640;

// From 700 to 1023 px the phone face's column holds 600 px of content (640 less
// 20 px of padding a side), centred in the viewport (DESIGN.md, 2026-09-30).
const MID_COLUMN = 600;

async function mainBox(page: Page): Promise<{ left: number; right: number }> {
  return page.evaluate(() => {
    const box = document.querySelector("main")!.getBoundingClientRect();
    return { left: box.left, right: window.innerWidth - box.right };
  });
}

async function expectMidColumn(page: Page, path: string): Promise<void> {
  for (const width of [700, 800, 1023]) {
    await page.setViewportSize({ width, height: 800 });
    await open(page, path);
    expect(await contentWidth(page), `${path} content at ${width}`).toBeCloseTo(MID_COLUMN, 0);
    const { left, right } = await mainBox(page);
    expect(Math.abs(left - right), `${path} centred at ${width}: ${left} left, ${right} right`).toBeLessThanOrEqual(1);
  }
}

// The rail's own width, read from the page: the content beside it is whatever
// it leaves, less the 56 px of padding a side (DESIGN.md, RNP-11).
async function railWidth(page: Page): Promise<number> {
  const box = await page.getByRole("navigation").boundingBox();
  return box!.width;
}

type Db = Parameters<Parameters<typeof test>[2]>[0]["db"];

// A route may need a goal; the test seeds it under the person and deletes it by id.
type Route = { path: (goalId: string) => string; needsGoal: boolean };

const fixed = (path: string): Route => ({ path: () => path, needsGoal: false });
const ofGoal = (path: (goalId: string) => string): Route => ({ path, needsGoal: true });

const one: Route[] = [
  fixed("/metas/nueva"),
  fixed("/metas"),
  fixed("/sueltas"),
  ofGoal((id) => `/metas/${id}/compromisos/nuevo`),
  ofGoal((id) => `/metas/${id}/fases/nueva`),
  fixed(`/dia/${plusDays(-1)}`),
];
const two: Route[] = [fixed("/"), ofGoal((id) => `/metas/${id}`)];

async function seedGoal(db: Db, userId: string): Promise<string> {
  const [goal] = await db<{ id: string }[]>`
    insert into goals.goals (user_id, name, horizon)
    values (${userId}, ${`Meta de la columna ${Date.now()}`}, ${plusDays(90)}) returning id
  `;
  return goal.id;
}

for (const route of one) {
  test(`${route.path("<id>")} holds 640 px at 1280 and 1024, 600 from 700 to 1023, and 360 does not move (module 90)`, async ({ person, browser, db }) => {
    const goalId = route.needsGoal ? await seedGoal(db, person.id) : "";
    const context = await browser.newContext({ storageState: person.sessionFile });
    try {
      const path = route.path(goalId);
      const page = await context.newPage();
      await page.setViewportSize({ width: 360, height: 740 });
      await open(page, path);
      expect(await contentWidth(page), `${path} at 360`).toBe(320);
      for (const width of [1280, 1024]) {
        await page.setViewportSize({ width, height: 800 });
        await open(page, path);
        expect(await contentWidth(page), `${path} at ${width}`).toBeCloseTo(CAPPED, 0);
        expect(await widest(page), `${path} widest at ${width}`).toBeLessThanOrEqual(CAPPED);
      }
      await expectMidColumn(page, path);
    } finally {
      await context.close();
      if (goalId) await db`delete from goals.goals where id = ${goalId} and user_id = ${person.id}`;
    }
  });
}

for (const route of two) {
  test(`${route.path("<id>")} keeps the rail's room at 1280 and 1024, 600 from 700 to 1023, and 360 does not move (module 90)`, async ({ person, browser, db }) => {
    const goalId = route.needsGoal ? await seedGoal(db, person.id) : "";
    const context = await browser.newContext({ storageState: person.sessionFile });
    try {
      const path = route.path(goalId);
      const page = await context.newPage();
      await page.setViewportSize({ width: 360, height: 740 });
      await open(page, path);
      expect(await contentWidth(page), `${path} at 360`).toBe(320);
      for (const width of [1280, 1024]) {
        await page.setViewportSize({ width, height: 800 });
        await open(page, path);
        const expected = width - (await railWidth(page)) - 112;
        expect(await contentWidth(page), `${path} at ${width}`).toBeCloseTo(expected, 0);
      }
      await expectMidColumn(page, path);
    } finally {
      await context.close();
      if (goalId) await db`delete from goals.goals where id = ${goalId} and user_id = ${person.id}`;
    }
  });
}

test("/sueltas with a one-off waiting holds 640 px at 1280 and 1024 (module 90)", async ({ person, browser, db }) => {
  const name = `Suelta ${Date.now()}`;
  const [oneOff] = await db<{ id: string }[]>`
    insert into goals.one_offs (user_id, name, day) values (${person.id}, ${name}, null) returning id
  `;
  const context = await browser.newContext({ storageState: person.sessionFile });
  try {
    const page = await context.newPage();
    for (const width of [1280, 1024]) {
      await page.setViewportSize({ width, height: 800 });
      await open(page, "/sueltas");
      await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
      expect(await contentWidth(page), `/sueltas full at ${width}`).toBeLessThanOrEqual(CAPPED);
      expect(await widest(page), `/sueltas full widest at ${width}`).toBeLessThanOrEqual(CAPPED);
    }
  } finally {
    await context.close();
    await db`delete from goals.one_offs where id = ${oneOff.id} and user_id = ${person.id}`;
  }
});
