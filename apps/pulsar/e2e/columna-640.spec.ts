import type { Page } from "@playwright/test";

import { test, expect, mintDisposablePerson } from "./fixtures";
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

test("a one-column screen holds 640 px at 1280 and 1024, and the two-column ones keep the rail's room, and 360 does not move (module 90)", async ({
  browser,
  baseURL,
  db,
}) => {
  const person = mintDisposablePerson(baseURL ?? "http://localhost:3200");
  const stamp = Date.now();
  const [goal] = await db<{ id: string }[]>`
    insert into goals.goals (user_id, name, horizon)
    values (${person.id}, ${`Meta de la columna ${stamp}`}, ${plusDays(90)}) returning id
  `;
  const context = await browser.newContext({ storageState: person.sessionFile });
  const yesterday = plusDays(-1);
  const one = [
    "/metas/nueva",
    "/metas",
    "/sueltas",
    `/metas/${goal.id}/compromisos/nuevo`,
    `/metas/${goal.id}/fases/nueva`,
    `/dia/${yesterday}`,
  ];
  const two = ["/", `/metas/${goal.id}`];
  const at360: Record<string, number> = {};

  try {
    const page = await context.newPage();

    await page.setViewportSize({ width: 360, height: 740 });
    for (const path of [...one, ...two]) {
      await open(page, path);
      at360[path] = await contentWidth(page);
      expect(at360[path], `${path} at 360`).toBe(320);
    }

    for (const width of [1280, 1024]) {
      await page.setViewportSize({ width, height: 800 });
      for (const path of one) {
        await open(page, path);
        expect(await contentWidth(page), `${path} at ${width}`).toBeLessThanOrEqual(CAPPED);
        expect(await widest(page), `${path} widest at ${width}`).toBeLessThanOrEqual(CAPPED);
      }
      for (const path of two) {
        await open(page, path);
        expect(await contentWidth(page), `${path} at ${width}`).toBeGreaterThan(CAPPED);
      }
    }

    // Full: a person with a one-off waiting.
    await db`insert into goals.one_offs (user_id, name, day) values (${person.id}, ${`Suelta ${stamp}`}, null)`;
    for (const width of [1280, 1024]) {
      await page.setViewportSize({ width, height: 800 });
      await open(page, "/sueltas");
      await expect(page.getByRole("button", { name: `Suelta ${stamp}`, exact: true })).toBeVisible();
      expect(await contentWidth(page), `/sueltas full at ${width}`).toBeLessThanOrEqual(CAPPED);
      expect(await widest(page), `/sueltas full widest at ${width}`).toBeLessThanOrEqual(CAPPED);
    }
  } finally {
    await context.close();
    await db`delete from goals.one_offs where user_id = ${person.id}`;
    await db`delete from goals.goals where id = ${goal.id} and user_id = ${person.id}`;
  }
});
