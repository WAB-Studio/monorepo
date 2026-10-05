import type { Browser, Page } from "@playwright/test";
import type postgres from "postgres";

import { test, expect, type Person } from "./fixtures";
import { civilDateToDate, dateToCivilDate, todayInZone } from "@/lib/zone";

// RNP-16, RNP-17, RNP-18 (`ArmazonPestanas`, `ArmazonPestanasHoja`,
// `ArmazonRiel`, `MetaRiel`): below 1024 the nav is four tabs fixed to the
// foot; from 1024 it is the rail, with each open goal named under the four.
const stamp = Date.now();
const OPEN_A = `Pestañas abierta A ${stamp}`;
const OPEN_B = `Pestañas abierta B ${stamp}`;
const ARCHIVED = `Pestañas archivada ${stamp}`;
const QUANTITY = `Leer páginas ${stamp}`;
const TABS = ["Hoy", "Semana", "Mes", "Metas"];

function shift(day: string, by: number): string {
  const date = civilDateToDate(day);
  date.setUTCDate(date.getUTCDate() + by);
  return dateToCivilDate(date);
}

const today = todayInZone();
const yesterday = shift(today, -1);

type World = { a: string; b: string };

// Two open goals and one archived. Fifteen commitments make Hoy and the goal
// taller than 844 and than 800, so "scrolled to the end" is a real scroll.
async function seed(db: postgres.Sql, personId: string): Promise<World> {
  const created = new Date(Date.now() - 20 * 86_400_000);
  const horizon = shift(today, 90);
  const [a] = await db<{ id: string }[]>`
    insert into goals.goals (user_id, name, horizon, created_at)
    values (${personId}, ${OPEN_A}, ${horizon}, ${created}) returning id
  `;
  const [b] = await db<{ id: string }[]>`
    insert into goals.goals (user_id, name, horizon, created_at)
    values (${personId}, ${OPEN_B}, ${horizon}, ${new Date(created.getTime() + 1000)}) returning id
  `;
  await db`
    insert into goals.goals (user_id, name, horizon, created_at, archived_at)
    values (${personId}, ${ARCHIVED}, ${horizon}, ${new Date(created.getTime() + 2000)}, now())
  `;
  await db`
    insert into goals.commitments
      (user_id, goal_id, name, cadence_kind, satisfaction, target_quantity, unit, created_at)
    values (${personId}, ${a.id}, ${QUANTITY}, 'daily', 'quantity', 20, 'páginas', ${created})
  `;
  for (let index = 0; index < 15; index++) {
    await db`
      insert into goals.commitments (user_id, goal_id, name, cadence_kind, satisfaction, created_at)
      values (${personId}, ${a.id}, ${`Compromiso ${index} ${stamp}`}, 'daily', 'tap', ${created})
    `;
  }
  await db`insert into goals.one_offs (user_id, name, day) values (${personId}, ${`Suelta ${stamp}`}, ${today})`;
  return { a: a.id, b: b.id };
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

// `loading.tsx` is a `main` too, with blocks and no text: the screen is there
// once its `main` says something.
const loaded = (page: Page) => expect(page.getByRole("main")).toContainText(/\S/);

async function navBox(page: Page) {
  return page.getByRole("navigation").evaluate((el) => {
    const { top, bottom, left, right, width, height } = el.getBoundingClientRect();
    return { top, bottom, left, right, width, height };
  });
}

async function scrollToEnd(page: Page) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.evaluate(
    () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
}

// Bottom edge of the lowest visible control inside `main`; a screen with no
// control (the week's cards) answers with its lowest element.
async function lastControlBottom(page: Page) {
  return page.getByRole("main").evaluate((main) => {
    const controls = Array.from(
      main.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea'),
    )
      .map((el) => el.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0);
    const rects = controls.length > 0 ? controls : Array.from(main.querySelectorAll("*")).map((el) => el.getBoundingClientRect()).filter((rect) => rect.width > 0 && rect.height > 0);
    return { count: rects.length, bottom: Math.max(...rects.map((rect) => rect.bottom)) };
  });
}

test.describe("pestañas y riel", () => {
  let world: World;

  test.beforeEach(async ({ db, person }) => {
    world = await seed(db, person.id);
  });

  const routes = (): { name: string; path: string }[] => [
    { name: "/", path: "/" },
    { name: "/semana", path: "/semana" },
    { name: "/mes", path: "/mes" },
    { name: "/metas", path: "/metas" },
    { name: "/metas/<id>", path: `/metas/${world.a}` },
    { name: "/sueltas", path: "/sueltas" },
    { name: "a past day", path: `/dia/${yesterday}` },
  ];

  test("at 390 × 844 the four tabs stay in view, and nothing of main ends under them (RNP-16)", async ({
    browser,
    baseURL,
    person,
  }) => {
    const { context, page } = await open(browser, baseURL, person, 390, 844);
    try {
      for (const route of routes()) {
        await page.goto(route.path);
        await loaded(page);
        const nav = page.getByRole("navigation");
        await expect(nav.getByRole("link")).toHaveCount(4);

        const before = await navBox(page);
        expect(before.bottom, `${route.name} before scrolling`).toBeLessThanOrEqual(844);
        expect(before.top, `${route.name} before scrolling`).toBeGreaterThan(844 - 120);

        await scrollToEnd(page);
        const after = await navBox(page);
        expect(after.bottom, `${route.name} at the end`).toBeLessThanOrEqual(844);
        expect(after.top, `${route.name} at the end`).toBeGreaterThan(844 - 120);

        const last = await lastControlBottom(page);
        expect(last.count, `${route.name} has controls`).toBeGreaterThan(0);
        expect(last.bottom, `${route.name}: last control above the bar`).toBeLessThanOrEqual(after.top);
      }
    } finally {
      await context.close();
    }
  });

  test("a sheet stands over the tabs: both its buttons are the topmost element at their centres (RNP-16)", async ({
    browser,
    baseURL,
    person,
  }) => {
    const { context, page } = await open(browser, baseURL, person, 390, 844);
    try {
      await page.goto("/");
      await page.locator("button", { hasText: QUANTITY }).click();
      const sheet = page.getByRole("dialog");
      await expect(sheet).toBeVisible();
      await sheet.evaluate((el) => Promise.all(el.getAnimations().map((animation) => animation.finished)));

      // The sheet's lowest two buttons are the ones that sat over the bar.
      for (const name of ["Escribir otra cantidad", "Anotar"]) {
        const button = sheet.getByRole("button", { name, exact: true });
        const topmost = await button.evaluate((el) => {
          const rect = el.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return hit === el || el.contains(hit);
        });
        expect(topmost, `${name} is topmost`).toBe(true);
      }
    } finally {
      await context.close();
    }
  });

  test("each tab lands in one tap and is the only one current (RNP-16)", async ({ browser, baseURL, person }) => {
    const { context, page } = await open(browser, baseURL, person, 390, 844);
    try {
      await page.goto("/");
      const targets = [
        { name: "Semana", url: "/semana" },
        { name: "Mes", url: "/mes" },
        { name: "Metas", url: "/metas" },
        { name: "Hoy", url: "/" },
      ];
      for (const target of targets) {
        await page.getByRole("navigation").getByRole("link", { name: target.name, exact: true }).tap();
        await expect(page).toHaveURL((url) => url.pathname === target.url);
        const nav = page.getByRole("navigation");
        await expect(nav.locator("[aria-current]")).toHaveCount(1);
        await expect(nav.getByRole("link", { name: target.name, exact: true })).toHaveAttribute("aria-current", "page");
      }
    } finally {
      await context.close();
    }
  });

  test("at 360 nothing overflows and each tab reaches 48 px (RNP-07, RNP-16)", async ({ browser, baseURL, person }) => {
    const { context, page } = await open(browser, baseURL, person, 360, 740);
    try {
      for (const route of routes()) {
        await page.goto(route.path);
        await loaded(page);
        expect(await page.evaluate(() => document.documentElement.scrollWidth), route.name).toBe(360);
        const sizes = await page
          .getByRole("navigation")
          .getByRole("link")
          .evaluateAll((links) => links.map((link) => link.getBoundingClientRect()).map((r) => [r.width, r.height]));
        expect(sizes).toHaveLength(4);
        for (const [width, height] of sizes) {
          expect(width, route.name).toBeGreaterThanOrEqual(48);
          expect(height, route.name).toBeGreaterThanOrEqual(48);
        }
      }
    } finally {
      await context.close();
    }
  });

  for (const width of [1280, 1440]) {
    test(`at ${width} the rail holds the four and exactly the open goals (RNP-17, RNP-18)`, async ({
      browser,
      baseURL,
      person,
    }) => {
      const { context, page } = await open(browser, baseURL, person, width, 800);
      try {
        await page.goto("/");
        await loaded(page);
        const links = page.getByRole("navigation").getByRole("link");
        await expect(links).toHaveCount(6);
        expect(await links.allInnerTexts()).toEqual([...TABS, OPEN_A, OPEN_B]);
        await expect(page.getByRole("navigation").getByText(ARCHIVED)).toHaveCount(0);
        await expect(page.getByRole("navigation").getByRole("link", { name: OPEN_A })).toHaveAttribute(
          "href",
          `/metas/${world.a}`,
        );
      } finally {
        await context.close();
      }
    });
  }

  test("at 1280 a cut goal name shows whole on keyboard focus, a short one shows none (RNP-17)", async ({
    browser,
    baseURL,
    person,
    db,
  }) => {
    const long = `Una meta con un nombre larguísimo que no cabe en el riel ${stamp}`;
    await db`
      insert into goals.goals (user_id, name, horizon, created_at)
      values (${person.id}, ${long}, ${shift(today, 90)}, ${new Date(Date.now() - 19 * 86_400_000)})
    `;
    const short = `Corta ${stamp % 1000}`;
    await db`
      insert into goals.goals (user_id, name, horizon, created_at)
      values (${person.id}, ${short}, ${shift(today, 90)}, ${new Date(Date.now() - 18 * 86_400_000)})
    `;
    const { context, page } = await open(browser, baseURL, person, 1280, 800);
    try {
      await page.goto("/");
      await loaded(page);
      const nav = page.getByRole("navigation");
      const balloon = page.locator("[data-goal-balloon]");
      await nav.getByRole("link", { name: OPEN_B }).focus();
      await page.keyboard.press("Tab");
      await expect(nav.getByRole("link", { name: long })).toBeFocused();
      await expect(balloon).toBeVisible();
      await expect(balloon).toHaveText(long);
      const [tip, link] = await Promise.all([balloon.boundingBox(), nav.getByRole("link", { name: long }).boundingBox()]);
      expect(tip!.x).toBeGreaterThanOrEqual(link!.x + link!.width);
      await page.keyboard.press("Tab");
      await expect(nav.getByRole("link", { name: short })).toBeFocused();
      await expect(balloon).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("on a goal's page its rail item is current and Metas is not; below 1024 Metas is (RNP-17)", async ({
    browser,
    baseURL,
    person,
  }) => {
    const wide = await open(browser, baseURL, person, 1280, 800);
    try {
      await wide.page.goto(`/metas/${world.b}`);
      const nav = wide.page.getByRole("navigation");
      await expect(nav.getByRole("link", { name: OPEN_B })).toHaveAttribute("aria-current", "page");
      await expect(nav.getByRole("link", { name: "Metas", exact: true })).not.toHaveAttribute("aria-current", "page");
      await expect(nav.locator("[aria-current]")).toHaveCount(1);
    } finally {
      await wide.context.close();
    }

    const narrow = await open(browser, baseURL, person, 390, 844);
    try {
      await narrow.page.goto(`/metas/${world.b}`);
      const nav = narrow.page.getByRole("navigation");
      await expect(nav.getByRole("link", { name: "Metas", exact: true })).toHaveAttribute("aria-current", "page");
      await expect(nav.locator("[aria-current]")).toHaveCount(1);
    } finally {
      await narrow.context.close();
    }
  });

  test("the rail's ground reaches the foot of a page taller than the viewport (RNP-17)", async ({
    browser,
    baseURL,
    person,
  }) => {
    const { context, page } = await open(browser, baseURL, person, 1280, 800);
    try {
      await page.goto("/");
      await loaded(page);
      const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
      expect(scrollHeight).toBeGreaterThan(800 + 100);
      const nav = await navBox(page);
      expect(nav.top).toBe(0);
      expect(nav.height).toBeGreaterThanOrEqual(scrollHeight - 1);

      // The ground stays under the rail's contents once scrolled to the end.
      await scrollToEnd(page);
      const scrolled = await navBox(page);
      expect(scrolled.bottom).toBeGreaterThanOrEqual(799);
      await expect(page.getByRole("navigation").getByRole("link", { name: "Hoy", exact: true })).toBeInViewport();
    } finally {
      await context.close();
    }
  });

  test("printing Hoy draws no nav (RNP-16)", async ({ browser, baseURL, person }) => {
    const { context, page } = await open(browser, baseURL, person, 390, 844);
    try {
      await page.goto("/");
      await expect(page.getByRole("navigation")).toBeVisible();
      await page.emulateMedia({ media: "print" });
      await expect(page.getByRole("navigation")).toBeHidden();
    } finally {
      await context.close();
    }
  });
});
