import type { Browser, Page } from "@playwright/test";

import messages from "../messages/es/import.json";
import { test, expect } from "./fixtures";
import { todayInZone } from "../lib/zone";

// The review draws a template task's and sub-task's note, whole and read-only
// (RP-45); the template path needs no model key. Board `ImportarRevisarNota`.

const TUTOR_NOTE = ["Preguntar por la tarifa por hora.", "Pedir una clase de prueba antes de pagar."];
const CHILD_NOTE = "Comparar tres perfiles.";

function template(): string {
  const [year, month] = todayInZone().split("-").map(Number);
  const first = `${year}-${String(month).padStart(2, "0")}`;
  const second = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
  return messages.template.example
    .replace("2027-10-01", `${year + 1}-${String(month).padStart(2, "0")}-01`)
    .replace("2026-10-01 a 2026-12-31", `${first}-01 a ${first}-28`)
    .replaceAll("2026-10", first)
    .replaceAll("2026-11", second);
}

type Fixtures = { person: { id: string; sessionFile: string }; browser: Browser; baseURL: string | undefined };
async function asPerson({ person, browser, baseURL }: Fixtures, run: (page: Page) => Promise<void>) {
  const context = await browser.newContext({ storageState: person.sessionFile, baseURL: baseURL! });
  try {
    await run(await context.newPage());
  } finally {
    await context.close();
  }
}

async function toReview(page: Page) {
  await page.goto("/metas/importar");
  await page.getByLabel(messages.textLabel).fill(template());
  await page.getByRole("button", { name: "Leer el plan" }).click();
  await expect(page).toHaveURL(/\/metas\/importar\/revisar$/);
  await expect(page.getByRole("heading", { name: messages.review.title })).toBeVisible();
  await expect(page.locator("main")).toHaveCount(1);
}

test.describe("the review shows each task's note (RP-45)", () => {
  test("both notes sit whole under their tasks, read-only; unmarking a task hides no other; confirming stores them", async ({
    person,
    browser,
    baseURL,
    db,
  }) => {
    await asPerson({ person, browser, baseURL }, async (page) => {
      await toReview(page);

      const tutorNote = page.locator("label").filter({ hasText: /^Tutor/ }).getByText("Preguntar por la tarifa", { exact: false });
      await expect(tutorNote).toBeVisible();
      await expect(tutorNote).toHaveText(TUTOR_NOTE.join("\n"));
      await expect(tutorNote).toHaveCSS("white-space", /pre-line/);
      await expect(tutorNote).toHaveCSS("font-size", "13px");
      const childNote = page.getByText(CHILD_NOTE, { exact: true });
      await expect(childNote).toBeVisible();
      // Whole: two lines of text, not clipped to one.
      expect((await tutorNote.boundingBox())!.height).toBeGreaterThan(2 * 13);
      // Read-only: no field holds a note.
      await expect(page.getByRole("textbox", { name: /nota/i })).toHaveCount(0);

      await page.getByRole("checkbox", { name: /Sesiones 1–4/ }).uncheck();
      await expect(tutorNote).toBeVisible();
      await expect(childNote).toBeVisible();

      await page.getByRole("button", { name: "Crear 1 meta" }).click();
      await expect(page).toHaveURL(/\/metas$/);
      await expect(page.getByRole("link", { name: /IA aplicada/ }).first()).toBeVisible();

      const rows = await db`
        select name, note from goals.one_offs
        where user_id = ${person.id} and name in ('Tutor', 'Elegir tutor', 'Leer AI Engineering cap. 1–4') order by name`;
      expect(rows.map((r) => [r.name, r.note])).toEqual([
        ["Elegir tutor", CHILD_NOTE],
        ["Leer AI Engineering cap. 1–4", null],
        ["Tutor", TUTOR_NOTE.join("\n")],
      ]);
    });
  });
});
