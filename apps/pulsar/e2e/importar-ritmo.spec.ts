import type { Browser, Page } from "@playwright/test";

import messages from "../messages/es/import.json";
import { appAlerts, test, expect, settled as pageSettled } from "./fixtures";
import { todayInZone } from "../lib/zone";

// RP-63: the review says each goal's rhythm before the person confirms (board `ImportarRevisarRitmo`).
const RHYTHM_LINE = messages.review.rhythm;
const rhythmOf = (amount: string) => messages.review.rhythmOf.replace("{amount}", amount);
const SOURCE_LINE = "ritmo: 12 h";

function shift(by: number) {
  const [year, month] = todayInZone().split("-").map(Number);
  const index = year * 12 + (month - 1) + by;
  return { year: Math.floor(index / 12), month: String((index % 12) + 1).padStart(2, "0") };
}

// The catalogue's own example, its dates moved to the person's now so the
// months stay inside the goal's span whatever day the suite runs.
function template(rhythm: string | null = "12 h"): string {
  const first = `${shift(0).year}-${shift(0).month}`;
  const second = `${shift(1).year}-${shift(1).month}`;
  const horizon = `${shift(0).year + 1}-${shift(0).month}-01`;
  const text = messages.template.example
    .replace("2027-10-01", horizon)
    .replace("2026-10-01 a 2026-12-31", `${first}-01 a ${first}-28`)
    .replaceAll("2026-10", first)
    .replaceAll("2026-11", second);
  if (!text.includes(SOURCE_LINE)) throw new Error("the template example carries no `ritmo:` line");
  return rhythm === null ? text.replace(`\n${SOURCE_LINE}`, "") : text.replace(SOURCE_LINE, `ritmo: ${rhythm}`);
}

function withKmGoal(): string {
  const horizon = `${shift(0).year + 1}-${shift(0).month}-01`;
  return `${template()}\n\n# Correr 10K\nhorizonte: ${horizon}\nmedida: distancia · km`;
}

async function toReview(page: Page, text: string) {
  await page.goto("/metas/importar");
  await expect(page.getByRole("button", { name: "Leer el plan" })).toBeVisible();
  await page.getByLabel(messages.textLabel).fill(text);
  await page.getByRole("button", { name: "Leer el plan" }).click();
  await expect(page).toHaveURL(/\/metas\/importar\/revisar$/);
  await expect(page.getByRole("heading", { name: messages.review.title })).toBeVisible();
  await pageSettled(page);
}

type Fixtures = { person: { id: string; sessionFile: string }; browser: Browser; baseURL: string | undefined };
async function asPerson(
  { person, browser, baseURL }: Fixtures,
  viewport: { width: number; height: number },
  run: (page: Page) => Promise<void>,
) {
  const context = await browser.newContext({ storageState: person.sessionFile, baseURL: baseURL!, viewport });
  try {
    await run(await context.newPage());
  } finally {
    await context.close();
  }
}

const goalCard = (page: Page, name: string) => page.getByRole("region", { name });

test.describe("the review says the rhythm before creating (RP-63, RP-35)", () => {
  for (const width of [390, 1440]) {
    test(`@${width}: the template's rhythm is a row «12 h al mes» with the board's line, after the measure row`, async ({ person, browser, baseURL }) => {
      await asPerson({ person, browser, baseURL }, { width, height: 900 }, async (page) => {
        await toReview(page, template());
        const card = goalCard(page, "IA aplicada");

        const main = card.getByText(rhythmOf("12 h"), { exact: true });
        const meta = card.getByText(RHYTHM_LINE, { exact: true });
        await expect(main).toBeVisible();
        await expect(meta).toBeVisible();
        // The meta line sits under its main line, in the same row.
        const [mainBox, metaBox] = [(await main.boundingBox())!, (await meta.boundingBox())!];
        expect(metaBox.y).toBeGreaterThan(mainBox.y);
        expect(metaBox.y - mainBox.y).toBeLessThan(40);
        // And the row follows the measure row.
        const measure = (await card.getByText("horas de estudio", { exact: true }).boundingBox())!;
        expect(mainBox.y).toBeGreaterThan(measure.y);
        // Like the other rows of the board, it is a marked checkbox.
        await expect(card.getByRole("checkbox", { name: new RegExp(rhythmOf("12 h")) })).toBeChecked();
      });
    });
  }

  test("a rhythm with minutes reads in hours and minutes, not as 90 min or 1.5 h", async ({ person, browser, baseURL }) => {
    await asPerson({ person, browser, baseURL }, { width: 390, height: 900 }, async (page) => {
      await toReview(page, template("1 h 30 min"));
      const card = goalCard(page, "IA aplicada");
      await expect(card.getByText(rhythmOf("1 h 30 min"), { exact: true })).toBeVisible();
      await expect(card.getByText(RHYTHM_LINE, { exact: true })).toBeVisible();
      await expect(card.getByText(/90 min|1[.,]5 h/)).toHaveCount(0);
    });
  });

  test("a template without ritmo: paints no rhythm row, and no «0 h al mes»", async ({ person, browser, baseURL }) => {
    await asPerson({ person, browser, baseURL }, { width: 390, height: 900 }, async (page) => {
      await toReview(page, template(null));
      await expect(goalCard(page, "IA aplicada")).toBeVisible();
      await expect(page.getByText(RHYTHM_LINE, { exact: true })).toHaveCount(0);
      await expect(page.getByText(/ al mes$/)).toHaveCount(0);
      await expect(page.getByText(/^0 (h|min)/)).toHaveCount(0);
    });
  });

  test("a goal in km beside a timed one has no rhythm row: only the goal that carries it says it", async ({ person, browser, baseURL }) => {
    await asPerson({ person, browser, baseURL }, { width: 390, height: 1200 }, async (page) => {
      await toReview(page, withKmGoal());
      await expect(page.getByRole("button", { name: "Crear 2 metas" })).toBeVisible();
      await expect(goalCard(page, "IA aplicada").getByText(RHYTHM_LINE, { exact: true })).toHaveCount(1);
      const km = goalCard(page, "Correr 10K");
      await expect(km.getByText("distancia", { exact: true })).toBeVisible();
      await expect(km.getByText(RHYTHM_LINE, { exact: true })).toHaveCount(0);
      await expect(page.getByText(RHYTHM_LINE, { exact: true })).toHaveCount(1);
    });
  });

  test("confirming builds the plan: the goal opens with «El plan» and its end", async ({ person, browser, baseURL, db }) => {
    await asPerson({ person, browser, baseURL }, { width: 390, height: 900 }, async (page) => {
      try {
        await toReview(page, template());
        await page.getByRole("button", { name: "Crear 1 meta" }).click();
        await expect(page).toHaveURL(/\/metas$/);
        await page.getByRole("link", { name: /IA aplicada/ }).first().click();
        await expect(page.getByText("el plan", { exact: true })).toBeVisible();
        const plan = page.getByRole("link", { name: /^A este ritmo terminas el .* Ritmo 12 h al mes/ });
        await expect(plan).toBeVisible();
        await expect(plan).toHaveAttribute("href", /\/metas\/[^/]+\/plan$/);
        const [goal] = await db`select rhythm from goals.goals where user_id = ${person.id} and name = 'IA aplicada'`;
        expect(goal.rhythm).toBe(720);
      } finally {
        await db`delete from goals.goals where user_id = ${person.id} and name in ('IA aplicada', 'Correr 10K')`;
      }
    });
  });

  test("unchecking the rhythm row creates the goal without a rhythm: the goal offers «Armar el plan»", async ({ person, browser, baseURL, db }) => {
    await asPerson({ person, browser, baseURL }, { width: 390, height: 900 }, async (page) => {
      try {
        await toReview(page, template());
        const box = goalCard(page, "IA aplicada").getByRole("checkbox", { name: new RegExp(rhythmOf("12 h")) });
        await box.click();
        await expect(box).not.toBeChecked();
        await page.getByRole("button", { name: "Crear 1 meta" }).click();
        await expect(page).toHaveURL(/\/metas$/);
        await page.getByRole("link", { name: /IA aplicada/ }).first().click();
        await expect(page.getByRole("link", { name: "Armar el plan" })).toBeVisible();
        await expect(page.getByRole("link", { name: /A este ritmo terminas/ })).toHaveCount(0);
        const [goal] = await db`select rhythm from goals.goals where user_id = ${person.id} and name = 'IA aplicada'`;
        expect(goal.rhythm).toBeNull();
      } finally {
        await db`delete from goals.goals where user_id = ${person.id} and name = 'IA aplicada'`;
      }
    });
  });

  test("ritmo: on a goal measured in km is refused with its line, and nothing is written", async ({ person, browser, baseURL, db }) => {
    await asPerson({ person, browser, baseURL }, { width: 390, height: 900 }, async (page) => {
      const text = template().replace("medida: horas de estudio · minutos", "medida: distancia · km").replace(SOURCE_LINE, "ritmo: 10 h");
      await page.goto("/metas/importar");
      await expect(page.getByRole("button", { name: "Leer el plan" })).toBeVisible();
      await page.getByLabel(messages.textLabel).fill(text);
      await page.getByRole("button", { name: "Leer el plan" }).click();

      const line = text.split("\n").indexOf("ritmo: 10 h") + 1;
      await expect(appAlerts(page).filter({ hasText: /\S/ })).toContainText(`Línea ${line}: «ritmo: 10 h»`);
      await expect(page).toHaveURL(/\/metas\/importar$/);
      await expect(page.getByLabel(messages.textLabel)).toHaveValue(text);
      const goals = await db`select 1 from goals.goals where user_id = ${person.id}`;
      expect(goals).toHaveLength(0);
    });
  });

  test("while it confirms the button is aria-busy, and the goal is written once", async ({ person, browser, baseURL, db }) => {
    await asPerson({ person, browser, baseURL }, { width: 390, height: 900 }, async (page) => {
      try {
        await toReview(page, template());
        let release!: () => void;
        const gate = new Promise<void>((resolve) => (release = resolve));
        await page.route("**/metas/importar/revisar", async (route) => {
          if (route.request().method() !== "POST") return route.continue();
          await gate;
          await route.continue();
        });
        await page.getByRole("button", { name: "Crear 1 meta" }).click();
        await expect(page.getByRole("button", { name: messages.review.creating })).toHaveAttribute("aria-busy", "true");
        release();
        await expect(page).toHaveURL(/\/metas$/);
        const goals = await db`select 1 from goals.goals where user_id = ${person.id} and name = 'IA aplicada'`;
        expect(goals).toHaveLength(1);
      } finally {
        await db`delete from goals.goals where user_id = ${person.id} and name = 'IA aplicada'`;
      }
    });
  });

  test("«‹ tu texto» leads back with the template, ritmo: line included, still in the field", async ({ person, browser, baseURL }) => {
    await asPerson({ person, browser, baseURL }, { width: 390, height: 900 }, async (page) => {
      const text = template();
      await toReview(page, text);
      await page.getByRole("link", { name: `Volver a ${messages.review.place}`, exact: true }).click();
      await expect(page).toHaveURL(/\/metas\/importar$/);
      await expect(page.getByLabel(messages.textLabel)).toHaveValue(text);
    });
  });

  test("at 360 the review with its rhythm row does not overflow, and every row keeps a 44px tap target", async ({ person, browser, baseURL }) => {
    await asPerson({ person, browser, baseURL }, { width: 360, height: 800 }, async (page) => {
      await toReview(page, withKmGoal());
      await expect(page.getByText(RHYTHM_LINE, { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const row = (await page.getByRole("checkbox", { name: new RegExp(rhythmOf("12 h")) }).locator("xpath=ancestor::label").boundingBox())!;
      expect(row.height).toBeGreaterThanOrEqual(44);
      expect(row.x + row.width).toBeLessThanOrEqual(360);
    });
  });
});
