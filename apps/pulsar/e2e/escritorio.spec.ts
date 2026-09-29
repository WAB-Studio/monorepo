import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import type { Browser, BrowserContext, Locator, Page } from "@playwright/test";
import postgres from "postgres";

import { test, expect, laneNumber, seededPerson } from "./fixtures";
import { civilDateToDate, dateToCivilDate, todayInZone } from "@/lib/zone";

// RNP-11 across the app (`HoyEscritorio`, `SemanaEscritorio`, `MetaEscritorio`,
// `RevisionEscritorio`, `HojaEscritorio`): at 1280 × 800 every route is the
// desktop face, at 1023 the phone face. Nothing scrolls sideways, the rail is
// there and no bottom nav, no two visible controls overlap and each one's
// shorter side reaches 32 px. «Visible control» is what the query below
// selects: a link, button, field, select, role=button or role=tab with a box
// and `visibility` not hidden — the face that is not drawn is `display: none`
// and has no box, so it is not measured.
const MIN_SIDE = 32;
const RAIL = 232;

function shift(day: string, by: number): string {
  const date = civilDateToDate(day);
  date.setUTCDate(date.getUTCDate() + by);
  return dateToCivilDate(date);
}

const today = todayInZone();
const yesterday = shift(today, -1);
const stamp = Date.now();
const LONG_GOAL = `Meta de medición a 1280 con un nombre bastante largo para forzar el ajuste ${stamp}`;
const QUANTITY = `Leer páginas del libro con un nombre largo ${stamp}`;
const TAP = `Repasar tarjetas ${stamp}`;
const ONE_OFF = `Suelta de medición ${stamp}`;
const SCHEDULED = `Programada de medición ${stamp}`;
const ENDED = `Meta terminada de medición ${stamp}`;

// A person of this spec's own, registered under the suite's run whose teardown
// drops it: the ended goal and the scheduled one-off are states the shared
// identity cannot promise while its siblings count its goals and one-offs.
function mintDisposablePerson(lane: number, baseUrl: string): { id: string; sessionFile: string } {
  execFileSync(
    process.execPath,
    ["--import", "tsx", "--env-file=.env.local", "scripts/harness/mint-session.ts"],
    { env: { ...process.env, HARNESS_LANE: String(lane), PULSAR_BASE_URL: baseUrl }, stdio: "pipe" },
  );
  const sessionFile = resolve(process.cwd(), `private/session-${lane}.json`);
  const previous = process.env.HARNESS_LANE;
  process.env.HARNESS_LANE = String(lane);
  try {
    return { id: seededPerson().id, sessionFile };
  } finally {
    if (previous === undefined) delete process.env.HARNESS_LANE;
    else process.env.HARNESS_LANE = previous;
  }
}

type Measured = { count: number; violations: string[] };

async function measure(page: Page, rootSelector: string | null, width: number): Promise<Measured> {
  return page.evaluate(
    ({ rootSelector, width, minSide }) => {
      const root = rootSelector ? document.querySelector(rootSelector) : document;
      const violations: string[] = [];
      const scrollWidth = document.documentElement.scrollWidth;
      if (scrollWidth > width) violations.push(`scrollWidth ${scrollWidth} > ${width}`);
      if (!root) return { count: 0, violations: [`no root ${rootSelector}`] };

      const describe = (el: Element) => {
        const label = el.getAttribute("aria-label") ?? (el.textContent ?? "").trim().slice(0, 30);
        return `${el.tagName.toLowerCase()}[${label}]`;
      };
      const isFixed = (el: Element) => {
        for (let node: Element | null = el; node; node = node.parentElement) {
          if (getComputedStyle(node).position === "fixed") return true;
        }
        return false;
      };

      const controls = Array.from(
        root.querySelectorAll(
          'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="tab"]',
        ),
      )
        .map((el) => ({ el, rect: el.getBoundingClientRect(), style: getComputedStyle(el) }))
        .filter(({ rect, style }) => rect.width > 0 && rect.height > 0 && style.visibility !== "hidden");

      for (const { el, rect } of controls) {
        const side = Math.min(rect.width, rect.height);
        if (side < minSide) {
          violations.push(`${describe(el)} shorter side ${side.toFixed(1)} < ${minSide} (${rect.width.toFixed(1)}x${rect.height.toFixed(1)})`);
        }
        if (rect.right > width + 0.5 || rect.left < -0.5) {
          violations.push(`${describe(el)} leaves the viewport: left ${rect.left.toFixed(1)} right ${rect.right.toFixed(1)}`);
        }
      }
      for (let i = 0; i < controls.length; i++) {
        for (let j = i + 1; j < controls.length; j++) {
          const a = controls[i];
          const b = controls[j];
          if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
          if (isFixed(a.el) !== isFixed(b.el)) continue;
          const x = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
          const y = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
          if (x > 0.5 && y > 0.5) {
            violations.push(`${describe(a.el)} overlaps ${describe(b.el)} by ${x.toFixed(1)}x${y.toFixed(1)}`);
          }
        }
      }
      return { count: controls.length, violations };
    },
    { rootSelector, width, minSide: MIN_SIDE },
  );
}

// A screen with nothing to measure would pass by proving nothing.
async function expectHolds(page: Page, width: number, minControls: number, rootSelector: string | null = null) {
  const { count, violations } = await measure(page, rootSelector, width);
  expect(count).toBeGreaterThanOrEqual(minControls);
  if (violations.length > 0) {
    await page.screenshot({ path: test.info().outputPath("violations.png"), fullPage: true });
  }
  expect(violations).toEqual([]);
}

// The open animation ends by itself: waits on it, never on the clock.
async function settled(dialog: Locator) {
  await dialog.evaluate((el) => Promise.all(el.getAnimations().map((animation) => animation.finished)));
}

async function railBox(page: Page) {
  return page.getByRole("navigation").evaluate((el) => {
    const { x, y, width, height } = el.getBoundingClientRect();
    return { x, y, width, height };
  });
}

type World = { personId: string; sessionFile: string; goalId: string };

// One person per worker for every case here: seeded once, gone when the worker
// ends. A failed case never skips the ones after it.
const worldTest = test.extend<object, { world: World }>({
  world: [
    async ({}, provide, workerInfo) => {
      const baseURL = workerInfo.project.use.baseURL;
      const person = mintDisposablePerson(9900 + laneNumber() * 10 + workerInfo.parallelIndex, baseURL ?? "http://localhost:3200");
      const admin = postgres(process.env.MIGRATION_DATABASE_URL!, { prepare: false, max: 1 });
      const personId = person.id;
      try {
        const created = new Date(Date.now() - 20 * 86_400_000);
        const [goal] = await admin<{ id: string }[]>`
          insert into goals.goals (user_id, name, horizon, created_at)
          values (${personId}, ${LONG_GOAL}, ${shift(today, 90)}, ${created}) returning id
        `;
        await admin`
          insert into goals.phases (user_id, goal_id, aim, starts_on, ends_on)
          values (${personId}, ${goal.id}, 'Sostener el ritmo diario sin saltarse ninguno', ${shift(today, -7)}, ${shift(today, 30)})
        `;
        await admin`
          insert into goals.commitments
            (user_id, goal_id, name, cadence_kind, satisfaction, target_quantity, unit, created_at)
          values (${personId}, ${goal.id}, ${QUANTITY}, 'daily', 'quantity', 20, 'páginas', ${created})
        `;
        const [tap] = await admin<{ id: string }[]>`
          insert into goals.commitments (user_id, goal_id, name, cadence_kind, satisfaction, created_at)
          values (${personId}, ${goal.id}, ${TAP}, 'daily', 'tap', ${created}) returning id
        `;
        await admin`insert into goals.facts (user_id, commitment_id, day) values (${personId}, ${tap.id}, ${yesterday})`;
        await admin`insert into goals.one_offs (user_id, name, day) values (${personId}, ${ONE_OFF}, ${today})`;
        await admin`insert into goals.one_offs (user_id, name, day) values (${personId}, ${SCHEDULED}, ${shift(today, 2)})`;
        const [ended] = await admin<{ id: string }[]>`
          insert into goals.goals (user_id, name, horizon, created_at)
          values (${personId}, ${ENDED}, ${today}, ${created}) returning id
        `;
        await admin`
          insert into goals.commitments (user_id, goal_id, name, cadence_kind, satisfaction, created_at)
          values (${personId}, ${ended.id}, 'Compromiso terminado', 'daily', 'tap', ${created})
        `;
        await provide({ personId, sessionFile: person.sessionFile, goalId: goal.id });
      } finally {
        await admin`delete from goals.facts where user_id = ${personId}`;
        await admin`delete from goals.one_offs where user_id = ${personId}`;
        await admin`delete from goals.goals where user_id = ${personId}`;
        await admin.end();
      }
    },
    { scope: "worker" },
  ],
});

async function signedIn(browser: Browser, baseURL: string | undefined, world: World, width: number, height: number) {
  const context: BrowserContext = await browser.newContext({
    baseURL,
    storageState: world.sessionFile,
    viewport: { width, height },
  });
  return { context, page: await context.newPage() };
}

type Route = { name: string; path: (world: World) => string; ready: (page: Page) => Promise<void>; min: number };

const ROUTES: Route[] = [
  { name: "/", path: () => "/", ready: (p) => expect(p.getByText(QUANTITY).first()).toBeVisible(), min: 5 },
  {
    name: "/dia/<yesterday>",
    path: () => `/dia/${yesterday}`,
    ready: (p) => expect(p.getByText(TAP).first()).toBeVisible(),
    min: 4,
  },
  { name: "/semana", path: () => "/semana", ready: (p) => expect(p.getByRole("table")).toBeVisible(), min: 5 },
  { name: "/sueltas", path: () => "/sueltas", ready: (p) => expect(p.getByText(SCHEDULED).first()).toBeVisible(), min: 5 },
  { name: "/metas", path: () => "/metas", ready: (p) => expect(p.getByText(ENDED).first()).toBeVisible(), min: 5 },
  { name: "/metas/nueva", path: () => "/metas/nueva", ready: (p) => expect(p.getByLabel("nombre")).toBeVisible(), min: 5 },
  {
    name: "/metas/<id>",
    path: (world) => `/metas/${world.goalId}`,
    ready: (p) => expect(p.getByRole("button", { name: "Renombrar" })).toBeVisible(),
    min: 8,
  },
  {
    name: "/metas/<id>/compromisos/nuevo",
    path: (world) => `/metas/${world.goalId}/compromisos/nuevo`,
    ready: (p) => expect(p.getByText("Compromiso nuevo")).toBeVisible(),
    min: 6,
  },
  {
    name: "/metas/<id>/fases/nueva",
    path: (world) => `/metas/${world.goalId}/fases/nueva`,
    ready: (p) => expect(p.getByText("Fase nueva")).toBeVisible(),
    min: 5,
  },
  {
    name: "/metas/<id>/revision",
    path: (world) => `/metas/${world.goalId}/revision`,
    ready: (p) => expect(p.getByRole("main")).toBeVisible(),
    min: 4,
  },
  {
    name: "/no-existe",
    path: () => "/no-existe",
    ready: (p) => expect(p.getByRole("heading", { name: "Esta página no existe" })).toBeVisible(),
    min: 4,
  },
];

for (const route of ROUTES) {
  worldTest(`${route.name} holds at 1280 × 800: rail, no bottom nav, one toggle, nothing over anything (RNP-11)`, async ({
    browser,
    baseURL,
    world,
  }) => {
    const { context, page } = await signedIn(browser, baseURL, world, 1280, 800);
    try {
      await page.goto(route.path(world));
      await route.ready(page);

      // The nav is the rail: down the left edge, from the top, 232 wide —
      // never a bar at the foot.
      const rail = await railBox(page);
      expect(rail).toMatchObject({ x: 0, y: 0, width: RAIL });
      expect(rail.height).toBeGreaterThan(400);
      await expect(page.getByRole("navigation").getByRole("link")).toHaveCount(3);
      await expect(page.getByRole("navigation").getByText("Bitácora")).toBeVisible();

      // Two toggles would be the phone face drawn beside the rail's own.
      await expect(page.getByRole("button", { name: /^Cambiar a modo/ })).toHaveCount(1);

      await expectHolds(page, 1280, route.min);
    } finally {
      await context.close();
    }
  });
}

worldTest("the quantity sheet on Hoy opens centred at 480 px at 1280 (RNP-11)", async ({ browser, baseURL, world }) => {
  const { context, page } = await signedIn(browser, baseURL, world, 1280, 800);
  try {
    await page.goto("/");
    await page.locator("button", { hasText: QUANTITY }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveCSS("width", "480px");
    await settled(dialog);
    const box = (await dialog.boundingBox())!;
    expect(Math.abs(box.x + box.width / 2 - 640)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y + box.height / 2 - 400)).toBeLessThanOrEqual(1);
    await expectHolds(page, 1280, 3, '[role="dialog"]');
  } finally {
    await context.close();
  }
});

worldTest("the rename sheet on the goal opens centred at 480 px at 1280 (RNP-11)", async ({ browser, baseURL, world }) => {
  const { context, page } = await signedIn(browser, baseURL, world, 1280, 800);
  try {
    await page.goto(`/metas/${world.goalId}`);
    await page.getByRole("button", { name: "Renombrar" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveCSS("width", "480px");
    await settled(dialog);
    const box = (await dialog.boundingBox())!;
    expect(Math.abs(box.x + box.width / 2 - 640)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y + box.height / 2 - 400)).toBeLessThanOrEqual(1);
    await expectHolds(page, 1280, 3, '[role="dialog"]');
  } finally {
    await context.close();
  }
});

worldTest("the move sheet on /sueltas opens centred at 480 px at 1280 (RNP-11)", async ({ browser, baseURL, world }) => {
  const { context, page } = await signedIn(browser, baseURL, world, 1280, 800);
  try {
    await page.goto("/sueltas");
    await page.getByRole("button", { name: new RegExp(`^${SCHEDULED}`) }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveCSS("width", "480px");
    await settled(dialog);
    const box = (await dialog.boundingBox())!;
    expect(Math.abs(box.x + box.width / 2 - 640)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y + box.height / 2 - 400)).toBeLessThanOrEqual(1);
    await expectHolds(page, 1280, 3, '[role="dialog"]');
  } finally {
    await context.close();
  }
});

// The phone face runs to 1023: the nav a bar at the foot, no table, one toggle.
for (const path of ["/", "/semana", "/sueltas", "/metas"]) {
  worldTest(`${path} is still the phone face at 1023 (RNP-11)`, async ({ browser, baseURL, world }) => {
    const { context, page } = await signedIn(browser, baseURL, world, 1023, 740);
    try {
      await page.goto(path);
      await expect(page.getByRole("main")).toBeVisible();

      const nav = await railBox(page);
      expect(nav).toMatchObject({ x: 0, width: 1023 });
      // The bar closes the column: under the screen, never beside it.
      const main = (await page.getByRole("main").boundingBox())!;
      expect(nav.y).toBeGreaterThanOrEqual(main.y + main.height - 1);
      expect(nav.height).toBeLessThan(100);
      await expect(page.getByRole("table")).toHaveCount(0);
      await expect(page.getByRole("navigation").getByText("Bitácora")).toBeHidden();
      await expect(page.getByRole("button", { name: /^Cambiar a modo/ })).toHaveCount(path === "/" ? 1 : 0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1023);
    } finally {
      await context.close();
    }
  });
}
