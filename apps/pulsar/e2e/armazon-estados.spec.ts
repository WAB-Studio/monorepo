import type { Browser, Page } from "@playwright/test";
import type postgres from "postgres";

import { test, expect, type Person } from "./fixtures";
import { civilDateToDate, dateToCivilDate, todayInZone } from "@/lib/zone";

// RNP-16, RNP-17 (`ArmazonCargando`, `ArmazonNoEncontrada` and their 1440
// faces): the 404 and the loading skeleton stand inside the frame, with the
// header where the real one lands. The failure board is held by `caida.spec.ts`,
// which owns the server whose database is down.
const stamp = Date.now();
const GOAL = `Estados meta ${stamp}`;
const UNKNOWN_GOAL = "00000000-0000-4000-8000-000000000000";

async function seed(db: postgres.Sql, personId: string) {
  const horizon = civilDateToDate(todayInZone());
  horizon.setUTCDate(horizon.getUTCDate() + 90);
  await db`
    insert into goals.goals (user_id, name, horizon)
    values (${personId}, ${GOAL}, ${dateToCivilDate(horizon)})
  `;
}

async function open(browser: Browser, baseURL: string | undefined, person: Person, width: number, height: number) {
  const context = await browser.newContext({
    baseURL,
    storageState: person.sessionFile,
    viewport: { width, height },
    hasTouch: width < 1024,
  });
  return { context, page: await context.newPage() };
}

const loaded = (page: Page) => expect(page.getByRole("main")).toContainText(/\S/);

for (const width of [390, 1440]) {
  test.describe(`at ${width}`, () => {
    test.beforeEach(async ({ db, person }) => {
      await seed(db, person.id);
    });

    test("the 404 draws one h1, a way to Hoy, no way back and the navigation with nothing current", async ({
      browser,
      baseURL,
      person,
    }) => {
      const { context, page } = await open(browser, baseURL, person, width, 900);
      await page.goto(`/metas/${UNKNOWN_GOAL}`);
      await loaded(page);
      await expect(page.getByRole("heading")).toHaveCount(1);
      await expect(page.getByRole("heading", { name: "Esta página no existe" })).toBeVisible();
      await expect(page.getByRole("main").getByRole("link", { name: "Ir a hoy" })).toHaveAttribute("href", "/");
      await expect(page.getByRole("main").getByRole("link", { name: "Ver las metas" })).toHaveAttribute("href", "/metas");
      await expect(page.getByRole("link", { name: /^Volver a / })).toHaveCount(0);
      await expect(page.getByText("la encuentras en Metas")).toBeVisible();

      const nav = page.getByRole("navigation");
      await expect(nav.getByRole("link").filter({ hasText: /^(Hoy|Semana|Mes|Metas)$/ })).toHaveCount(4);
      if (width >= 1024) await expect(nav.getByRole("link", { name: GOAL })).toBeVisible();
      await expect(page.locator("a[aria-current]")).toHaveCount(0);
      await context.close();
    });

    // Every screen's header lands at one place; the skeleton's block stands there.
    test("a route held in loading shows the header block where the header lands", async ({
      browser,
      baseURL,
      person,
    }) => {
      const { context, page } = await open(browser, baseURL, person, width, 900);
      await page.goto(`/metas/${UNKNOWN_GOAL}`);
      await loaded(page);
      const landed = await page.locator("main header").first().boundingBox();

      await page.goto("/");
      await loaded(page);
      let release!: () => void;
      const gate = new Promise<void>((done) => {
        release = done;
      });
      await page.route("**/semana**", async (route) => {
        if (route.request().headers()["rsc"] === "1") await gate;
        await route.continue();
      });

      await page.getByRole("navigation").getByRole("link", { name: "Semana" }).first().click();
      const block = page.locator("main header[aria-hidden]");
      await expect(block).toBeVisible();
      await expect(page.getByRole("heading")).toHaveCount(0);
      const held = await block.boundingBox();
      expect(Math.abs(held!.y - landed!.y)).toBeLessThanOrEqual(2);

      release();
      await expect(block).toHaveCount(0);
      await context.close();
    });
  });
}

test("at 360 the 404 does not overflow", async ({ browser, baseURL, person }) => {
  const { context, page } = await open(browser, baseURL, person, 360, 740);
  await page.goto(`/metas/${UNKNOWN_GOAL}`);
  await loaded(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await context.close();
});
