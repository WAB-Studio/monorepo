import type { Browser, Page } from "@playwright/test";

import messages from "../messages/es/import.json";
import { test, expect } from "./fixtures";
import { civilDateToDate, todayInZone } from "../lib/zone";

// Against the ordinary server, which holds no model key (`OPENAI_API_KEY=""`):
// the draft comes from the template path, so no model is ever called
// (RP-37, RNP-13). The boards are `ImportarRevisar*.dc.html`.

function monthsFromToday() {
  const [year, month] = todayInZone().split("-").map(Number);
  const shift = (by: number) => {
    const index = year * 12 + (month - 1) + by;
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
  };
  return { previous: shift(-1), first: shift(0), second: shift(1), horizon: `${year + 1}-${String(month).padStart(2, "0")}-01` };
}

const word = (month: string, withYear = false) =>
  new Intl.DateTimeFormat("es", withYear ? { month: "long", year: "numeric", timeZone: "UTC" } : { month: "long", timeZone: "UTC" }).format(
    civilDateToDate(`${month}-01`),
  );

// The catalogue's example, its dates moved to the person's own now so the
// months stay inside the goal's span whatever day the suite runs.
function template(extraMonth?: string): string {
  const { first, second, horizon } = monthsFromToday();
  let text = messages.template.example
    .replace("2027-10-01", horizon)
    .replace("2026-10-01 a 2026-12-31", `${first}-01 a ${first}-28`)
    .replaceAll("2026-10", first)
    .replaceAll("2026-11", second);
  if (extraMonth) text = text.replace(`- ${second} · 20 h`, `- ${second} · 20 h\n- ${extraMonth} · 8 h`);
  return text;
}

async function toReview(page: Page, text: string) {
  await page.goto("/metas/importar");
  await expect(page.getByRole("button", { name: "Leer el plan" })).toBeVisible();
  await page.getByLabel(messages.textLabel).fill(text);
  await page.getByRole("button", { name: "Leer el plan" }).click();
  await expect(page).toHaveURL(/\/metas\/importar\/revisar$/);
  await settled(page);
}

// `load` fires with the loading fallback still standing.
async function settled(page: Page) {
  await expect(page.getByRole("heading", { name: messages.review.title })).toBeVisible();
  await expect(page.locator("main")).toHaveCount(1);
}

// The worker's own person drives each test, so what the database holds is theirs alone.
type Fixtures = { person: { id: string; sessionFile: string }; browser: Browser; baseURL: string | undefined };
async function asPerson(
  { person, browser, baseURL }: Fixtures,
  run: (page: Page) => Promise<void>,
  viewport?: { width: number; height: number },
) {
  const context = await browser.newContext({ storageState: person.sessionFile, baseURL: baseURL!, ...(viewport ? { viewport } : {}) });
  try {
    await run(await context.newPage());
  } finally {
    await context.close();
  }
}

const box = (page: Page, name: string | RegExp) => page.getByRole("checkbox", { name });

test.describe("the review of an imported plan (RP-37, RP-35)", () => {
  test("it reads the goal, its amounts, its commitments and the tutor task with its two sub-tasks", async ({ person, browser, baseURL }) => {
    const { first, second } = monthsFromToday();
    await asPerson({ person, browser, baseURL }, async (page) => {
      await toReview(page, template());

      await expect(page.getByText(messages.review.eyebrowTemplate, { exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "IA aplicada" })).toBeVisible();
      await expect(page.getByRole("button", { name: `Cambiar el monto de ${word(first)}` })).toHaveText("12 h");
      await expect(page.getByRole("button", { name: `Cambiar el monto de ${word(second)}` })).toHaveText("20 h");
      await expect(box(page, /Tema técnico/)).toBeChecked();
      await expect(box(page, /Inglés pasivo/)).toBeChecked();
      await expect(box(page, /^Tutor/)).toBeChecked();
      await expect(box(page, /Elegir tutor/)).toBeChecked();
      await expect(box(page, /Sesiones 1–4/)).toBeChecked();
      await expect(page.getByText(`${word(first)} · la suma de lo marcado`, { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Crear 1 meta" })).toBeVisible();
      await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(0);
    });
  });

  test("unmarking a sub-task and changing a month, then confirming, writes exactly that", async ({ person, browser, baseURL, db }) => {
    const { first, second } = monthsFromToday();
    await asPerson({ person, browser, baseURL }, async (page) => {
      await toReview(page, template());

      await box(page, /Sesiones 1–4/).uncheck();
      // The parent's figure is the sum of what stays marked.
      await expect(page.locator("label", { hasText: "la suma de lo marcado" })).toContainText("1 h");

      await page.getByRole("button", { name: `Cambiar el monto de ${word(first)}` }).click();
      await page.getByRole("spinbutton", { name: "horas" }).fill("10");
      await page.getByRole("spinbutton", { name: "minutos" }).fill("0");
      await page.getByRole("button", { name: "Guardar" }).click();
      await expect(page.getByRole("button", { name: `Cambiar el monto de ${word(first)}` })).toHaveText("10 h");

      await page.getByRole("button", { name: "Crear 1 meta" }).click();
      await expect(page).toHaveURL(/\/metas$/);
      await expect(page.getByText("IA aplicada").first()).toBeVisible();

      const goals = await db`select id from goals.goals where user_id = ${person.id} and name = 'IA aplicada'`;
      expect(goals).toHaveLength(1);
      const budgets = await db`
        select to_char(month, 'YYYY-MM') as month, amount from goals.month_budgets
        where user_id = ${person.id} and goal_id = ${goals[0].id} order by month`;
      expect(budgets.map((row) => [row.month, row.amount])).toEqual([[first, 600], [second, 1200]]);

      const tutor = await db`select id from goals.one_offs where user_id = ${person.id} and goal_id = ${goals[0].id} and name = 'Tutor' and parent_id is null`;
      expect(tutor).toHaveLength(1);
      const children = await db`select name, estimate from goals.one_offs where user_id = ${person.id} and parent_id = ${tutor[0].id}`;
      expect(children.map((row) => [row.name, row.estimate])).toEqual([["Elegir tutor", 60]]);
      const unmarked = await db`select 1 from goals.one_offs where user_id = ${person.id} and name = 'Sesiones 1–4'`;
      expect(unmarked).toHaveLength(0);
    });
  });

  test("a month before today is shown under the warnings, unmarked, and is not written", async ({ person, browser, baseURL, db }) => {
    const { previous, first, second } = monthsFromToday();
    await asPerson({ person, browser, baseURL }, async (page) => {
      await toReview(page, template(previous));

      const title = page.getByRole("heading", { name: messages.review.blocked.title });
      await expect(title).toBeVisible();
      await expect(page.getByText(messages.review.blocked.hint, { exact: true })).toBeVisible();
      const refused = page.getByRole("checkbox", { name: new RegExp(word(previous, true)) });
      await expect(refused).toBeDisabled();
      await expect(refused).not.toBeChecked();
      await expect(
        page.getByText(messages.review.blocked.outsideSpan.replace("{month}", word(first)), { exact: true }),
      ).toBeVisible();
      // The warnings stand above the goal.
      const above = (await title.boundingBox())!.y;
      expect(above).toBeLessThan((await page.getByRole("heading", { name: "IA aplicada" }).boundingBox())!.y);

      await page.getByRole("button", { name: "Crear 1 meta" }).click();
      await expect(page).toHaveURL(/\/metas$/);
      const goals = await db`select id from goals.goals where user_id = ${person.id} and name = 'IA aplicada'`;
      const budgets = await db`
        select to_char(month, 'YYYY-MM') as month from goals.month_budgets
        where user_id = ${person.id} and goal_id = ${goals[0].id} order by month`;
      expect(budgets.map((row) => row.month)).toEqual([first, second]);
    });
  });

  test("a reload keeps the draft, and none sends the person back to the import", async ({ person, browser, baseURL }) => {
    await asPerson({ person, browser, baseURL }, async (page) => {
      await toReview(page, template());
      await page.reload();
      await settled(page);
      await expect(page.getByRole("heading", { name: "IA aplicada" })).toBeVisible();
    });
    await asPerson({ person, browser, baseURL }, async (fresh) => {
      await fresh.goto("/metas/importar/revisar");
      await expect(fresh).toHaveURL(/\/metas\/importar$/);
    });
  });

  for (const width of [360, 1280]) {
    test(`it holds at ${width}`, async ({ person, browser, baseURL }) => {
      await asPerson(
        { person, browser, baseURL },
        async (page) => {
          await toReview(page, template());

          expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
          for (const checkbox of await page.getByRole("checkbox").all()) {
            const row = (await checkbox.locator("xpath=ancestor::label").boundingBox())!;
            expect(row.height).toBeGreaterThanOrEqual(44);
          }
          const amounts = await page.getByRole("button", { name: /^Cambiar el monto de/ }).all();
          expect(amounts.length).toBeGreaterThan(0);
          for (const amount of amounts) expect((await amount.boundingBox())!.height).toBeGreaterThanOrEqual(44);

          // The confirm stays in the viewport while the list scrolls.
          const at = (await page.getByRole("button", { name: "Crear 1 meta" }).boundingBox())!;
          expect(at.y + at.height).toBeLessThanOrEqual(800);
          // A sub-task sits 32px in.
          const parent = (await box(page, /^Tutor/).boundingBox())!;
          const child = (await box(page, /Elegir tutor/).boundingBox())!;
          expect(child.x - parent.x).toBeGreaterThanOrEqual(28);
        },
        { width, height: 800 },
      );
    });
  }
});
