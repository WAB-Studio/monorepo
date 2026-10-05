import type { Page } from "@playwright/test";

import { test, expect, laneNumber } from "./fixtures";

// RNP-11 at the kit's level: what `components/ui` does at 1024px and does not
// do below it. `Face`, `Split` and `WeekTable` have no consumer yet; the
// screens that adopt them prove them.
type Box = { x: number; y: number; width: number; height: number };

async function box(page: Page, selector: string, nth = 0): Promise<Box> {
  return page.locator(selector).nth(nth).evaluate((el) => {
    const { x, y, width, height } = el.getBoundingClientRect();
    return { x, y, width, height };
  });
}

test("at 1280 the nav is a rail down the left edge and nothing sits under it (RNP-11)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/semana");
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.locator("main")).toHaveCount(1);

  const rail = await box(page, "nav");
  expect(rail).toMatchObject({ x: 0, y: 0, width: 232, height: 800 });
  await expect(page.locator("nav").getByRole("link")).toHaveCount(3);

  const main = await box(page, "main");
  expect(main.x).toBeGreaterThanOrEqual(232);

  // Every control the screen draws stands right of the rail.
  const leftmost = await page.locator("main").evaluate((el) =>
    Math.min(
      ...Array.from(el.querySelectorAll("a, button, input"))
        .map((c) => c.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map((rect) => rect.left),
    ),
  );
  expect(leftmost).toBeGreaterThanOrEqual(232);

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1280);
});

// Boxes measured on `integracion` before this module, at 740 px tall on the
// same three-tab nav: the nav 51 px at the foot, three equal links, the page
// column 640 wide and centred from 700 up.
for (const [width, pageBox] of [
  [360, { x: 0, width: 360 }],
  [800, { x: 80, width: 640 }],
  [1023, { x: 191.5, width: 640 }],
] as const) {
  test(`at ${width} the nav is still three tabs at the foot and the page column has not moved (RNP-11)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 740 });
    await page.goto("/metas");
    await expect(page.locator("main :is(h1, p, a, button, input)").first()).toBeVisible();
    await expect(page.locator("main")).toHaveCount(1);

    const nav = await box(page, "nav");
    expect(nav).toMatchObject({ x: 0, width, height: 51 });
    expect(nav.y + nav.height).toBe(740);

    const links = page.locator("nav").getByRole("link");
    await expect(links).toHaveCount(3);
    for (let index = 0; index < 3; index++) {
      const link = await box(page, "nav a", index);
      expect(link.x).toBeCloseTo((width / 3) * index, 1);
      expect(link.width).toBeCloseTo(width / 3, 1);
      expect(link.height).toBe(50);
    }
    await expect(page.locator("nav").getByRole("button")).toHaveCount(0);

    const column = await box(page, "main");
    expect(column.x).toBeCloseTo(pageBox.x, 1);
    expect(column.width).toBe(pageBox.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });
}

test("a sheet is a centred 480 px dialog at 1280 and pinned to the foot at 360 and 800, and the review's header names the column alone for a time unit (RNP-11, RP-35)", async ({
  page,
  db,
  personId,
}) => {
  const lane = laneNumber();
  await page.goto("/metas/nueva");
  await page.getByLabel("nombre").fill(`Meta kit ${lane} ${Date.now()}`);
  await page.getByRole("button", { name: "Abrirla" }).click();
  await page.waitForURL(/\/metas\/[0-9a-f-]{36}$/);
  const goalId = page.url().split("/metas/")[1];

  try {
    await page.goto(`/metas/${goalId}/compromisos/nuevo`);
    await page.getByLabel("qué es").fill(`Medida kit ${lane} ${Date.now()}`);
    await page.getByRole("button", { name: "un número", exact: true }).click();
    await page.getByLabel("cantidad", { exact: true }).fill("5");
    await page.getByLabel("unidad").fill("minutos");
    await page.getByRole("button", { name: "Añadirlo" }).click();
    await page.waitForURL(`**/metas/${goalId}`);

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole("button", { name: "Renombrar" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveCSS("border-top-left-radius", "16px");
    await expect(dialog).toHaveCSS("border-bottom-right-radius", "16px");
    await expect(dialog).toHaveCSS("box-shadow", "none");
    await expect.poll(async () => (await box(page, "[role=dialog]")).width).toBe(480);
    const centred = await box(page, "[role=dialog]");
    expect(Math.abs(centred.x + centred.width / 2 - 640)).toBeLessThanOrEqual(1);
    expect(Math.abs(centred.y + centred.height / 2 - 400)).toBeLessThanOrEqual(1);

    // The actions are one row at the right edge, the secondary before the primary.
    const actions = dialog.getByRole("button");
    await expect(actions).toHaveCount(2);
    const primary = (await actions.filter({ hasText: "Guardarlo" }).boundingBox())!;
    const secondary = (await actions.filter({ hasText: "Dejarlo como está" }).boundingBox())!;
    expect(Math.abs(secondary.y - primary.y)).toBeLessThanOrEqual(1);
    expect(secondary.x + secondary.width).toBeLessThan(primary.x);
    expect(primary.width).toBeLessThan(240);
    expect(Math.abs(centred.x + centred.width - 1 - 30 - (primary.x + primary.width))).toBeLessThanOrEqual(1);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    for (const width of [360, 800]) {
      await page.setViewportSize({ width, height: 740 });
      await page.getByRole("button", { name: "Renombrar" }).click();
      await expect(dialog).toBeVisible();
      await expect.poll(async () => (await box(page, "[role=dialog]")).width).toBe(width);
      const pinned = await box(page, "[role=dialog]");
      expect(pinned.x).toBe(0);
      expect(pinned.y + pinned.height).toBeCloseTo(740, 0);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    }

    // Nothing scrolls sideways from 1024, the review's table included.
    await page.setViewportSize({ width: 1024, height: 768 });
    for (const path of ["/", "/semana", `/metas/${goalId}`, `/metas/${goalId}/revision`]) {
      await page.goto(path);
      expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBe(1024);
    }

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/metas/${goalId}/revision`);
    // Each cell spells out its hours and minutes, so the header carries no unit.
    await expect(page.getByRole("table").getByRole("columnheader").nth(1)).toHaveText("total");
  } finally {
    await db`delete from goals.goals where id = ${goalId} and user_id = ${personId}`;
  }
});
