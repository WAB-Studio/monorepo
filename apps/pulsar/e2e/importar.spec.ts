import type { Page } from "@playwright/test";

import messages from "../messages/es/import.json";
import { test, expect } from "./fixtures";

// The page always carries Next's own empty `role="alert"` route announcer, so an
// alert is the one with text in it.
//
// Against the ordinary server, which holds no model key (`OPENAI_API_KEY=""`):
// the template reads without one, anything else answers 503, and no claim is
// ever written (RP-37, RNP-13). The boards are `Importar*.dc.html`.
const EXAMPLE = messages.template.example;
const PRIVACY = messages.privacy;
const NO_KEY = messages.errors.noKey;

// `load` fires with the loading fallback still standing; the screen is settled
// when its button is there.
async function settled(page: Page) {
  await expect(page.getByRole("button", { name: "Leer el plan" })).toBeVisible();
  await expect(page.locator("main")).toHaveCount(1);
}

async function boxOf(locator: ReturnType<Page["locator"]>) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("no box");
  return box;
}

test.describe("the import screen (RP-37)", () => {
  test("the header's way back, «Volver a Metas», lands on /metas, and the page has one h1", async ({ person, browser, baseURL }) => {
    const context = await browser.newContext({ storageState: person.sessionFile, baseURL: baseURL! });
    try {
      const page = await context.newPage();
      await page.goto("/metas/importar");
      await settled(page);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await page.getByRole("link", { name: "Volver a Metas", exact: true }).click();
      await expect(page).toHaveURL(/\/metas$/);
    } finally {
      await context.close();
    }
  });

  test("the privacy line is visible before any send, above «Leer el plan»", async ({ person, browser, baseURL }) => {
    const context = await browser.newContext({ storageState: person.sessionFile, baseURL: baseURL! });
    try {
      const page = await context.newPage();
      await page.goto("/metas/importar");
      await settled(page);

      const privacy = page.getByText(PRIVACY, { exact: true });
      await expect(privacy).toBeVisible();
      const read = await boxOf(page.getByRole("button", { name: "Leer el plan" }));
      expect((await boxOf(privacy)).y).toBeLessThan(read.y);
    } finally {
      await context.close();
    }
  });

  test("a pasted text outside the template answers the missing key, keeps the text and writes no claim", async ({
    person,
    browser,
    baseURL,
    db,
  }) => {
    const context = await browser.newContext({ storageState: person.sessionFile, baseURL: baseURL! });
    try {
      const page = await context.newPage();
      await page.goto("/metas/importar");
      await settled(page);

      const text = "Octubre: leer el capítulo uno. Noviembre: el dos.";
      const area = page.getByLabel(messages.textLabel);
      await area.fill(text);
      await page.getByRole("button", { name: "Leer el plan" }).click();

      const alert = page.getByRole("alert").filter({ hasText: /\S/ });
      await expect(alert).toHaveText(NO_KEY);
      // The box sits above the text area, and the upload is shut.
      expect((await boxOf(alert)).y).toBeLessThan((await boxOf(area)).y);
      await expect(page.getByLabel(messages.upload)).toBeDisabled();
      await expect(area).toHaveValue(text);
      await expect(page.getByRole("button", { name: "ver la plantilla" })).toBeVisible();
      await expect(page).toHaveURL(/\/metas\/importar$/);

      const rows = await db`select 1 from goals.model_calls where user_id = ${person.id}`;
      expect(rows).toHaveLength(0);
    } finally {
      await context.close();
    }
  });

  test("the catalogue's template example, pasted, lands on the review without a key", async ({
    person,
    browser,
    baseURL,
    db,
  }) => {
    const context = await browser.newContext({ storageState: person.sessionFile, baseURL: baseURL! });
    try {
      const page = await context.newPage();
      await page.goto("/metas/importar");
      await settled(page);

      await page.getByLabel(messages.textLabel).fill(EXAMPLE);
      await page.getByRole("button", { name: "Leer el plan" }).click();
      await expect(page).toHaveURL(/\/metas\/importar\/revisar$/);

      const rows = await db`select 1 from goals.model_calls where user_id = ${person.id}`;
      expect(rows).toHaveLength(0);
    } finally {
      await context.close();
    }
  });

  test("the text last read is in the box when the screen opens again, and a file read leaves it empty", async ({
    person,
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ storageState: person.sessionFile, baseURL: baseURL! });
    try {
      const page = await context.newPage();
      await page.goto("/metas/importar");
      await settled(page);
      await expect(page.getByLabel(messages.textLabel)).toHaveValue("");

      await page.getByLabel(messages.textLabel).fill(EXAMPLE);
      await page.getByRole("button", { name: "Leer el plan" }).click();
      await expect(page).toHaveURL(/\/metas\/importar\/revisar$/);

      await page.goto("/metas/importar");
      await settled(page);
      await expect(page.getByLabel(messages.textLabel)).toHaveValue(EXAMPLE);

      await page.getByLabel(messages.upload).setInputFiles({
        name: "plan.txt",
        mimeType: "text/plain",
        buffer: Buffer.from(EXAMPLE),
      });
      await expect(page).toHaveURL(/\/metas\/importar\/revisar$/);

      await page.goto("/metas/importar");
      await settled(page);
      await expect(page.getByLabel(messages.textLabel)).toHaveValue("");
    } finally {
      await context.close();
    }
  });

  test("the example with a broken month line names the line and keeps the text", async ({ person, browser, baseURL }) => {
    const context = await browser.newContext({ storageState: person.sessionFile, baseURL: baseURL! });
    try {
      const page = await context.newPage();
      await page.goto("/metas/importar");
      await settled(page);

      const broken = EXAMPLE.replace("- 2026-11 · 20 h", "- 2026-13 · 20 h");
      const area = page.getByLabel(messages.textLabel);
      await area.fill(broken);
      await page.getByRole("button", { name: "Leer el plan" }).click();

      await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveText(/^Línea 12: «- 2026-13 · 20 h»\. Esperaba - AAAA-MM · monto\.$/);
      await expect(area).toHaveValue(broken);
      await expect(page).toHaveURL(/\/metas\/importar$/);

      // The template is hidden after the failure; one tap on «ver la plantilla» brings it back.
      await expect(page.getByRole("button", { name: "copiar la plantilla" })).toHaveCount(0);
      await page.getByRole("button", { name: "ver la plantilla" }).click();
      await expect(page.getByRole("button", { name: "copiar la plantilla" })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("an uploaded text file with a broken month line quotes that line", async ({ person, browser, baseURL }) => {
    const context = await browser.newContext({ storageState: person.sessionFile, baseURL: baseURL! });
    try {
      const page = await context.newPage();
      await page.goto("/metas/importar");
      await settled(page);

      await page.getByLabel(messages.upload).setInputFiles({
        name: "plan.txt",
        mimeType: "text/plain",
        buffer: Buffer.from(EXAMPLE.replace("- 2026-11 · 20 h", "- 2026-13 · 20 h")),
      });
      await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveText(
        /^Línea 12: «- 2026-13 · 20 h»\. Esperaba/,
      );
    } finally {
      await context.close();
    }
  });

  test("a text with nothing in it answers the empty notice and offers the template", async ({
    person,
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ storageState: person.sessionFile, baseURL: baseURL! });
    try {
      const page = await context.newPage();
      await page.goto("/metas/importar");
      await settled(page);

      await page.route("**/importar/leer", (route) =>
        route.fulfill({ status: 422, json: { error: "import.errors.empty" } }),
      );
      await page.getByLabel(messages.textLabel).fill("algo sin metas");
      await page.getByRole("button", { name: "Leer el plan" }).click();
      await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveText(messages.errors.empty);
      await page.getByRole("button", { name: "ver la plantilla" }).click();
      await expect(page.getByRole("button", { name: "copiar la plantilla" })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("a blank box answers the blank notice without sending anything", async ({ person, browser, baseURL }) => {
    const context = await browser.newContext({ storageState: person.sessionFile, baseURL: baseURL! });
    try {
      const page = await context.newPage();
      let sent = 0;
      await page.route("**/importar/leer", (route) => {
        sent += 1;
        return route.fulfill({ status: 422, json: { error: "import.errors.empty" } });
      });
      await page.goto("/metas/importar");
      await settled(page);

      await page.getByLabel(messages.textLabel).fill("   \n ");
      await page.getByRole("button", { name: "Leer el plan" }).click();
      await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveText(messages.errors.blank);
      expect(sent).toBe(0);
    } finally {
      await context.close();
    }
  });

  test("a 5 MB file shows the size notice without sending it", async ({ person, browser, baseURL }) => {
    const context = await browser.newContext({ storageState: person.sessionFile, baseURL: baseURL! });
    try {
      const page = await context.newPage();
      let sent = 0;
      page.on("request", (request) => {
        if (request.url().endsWith("/importar/leer")) sent += 1;
      });
      await page.goto("/metas/importar");
      await settled(page);

      await page.getByLabel(messages.upload).setInputFiles({
        name: "roadmap-escaneado.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.alloc(5 * 1024 * 1024, 1),
      });
      await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveText(
        "«roadmap-escaneado.pdf» pesa 5 MB y el tope es 4 MB. Pega su texto en la caja.",
      );
      expect(sent).toBe(0);
    } finally {
      await context.close();
    }
  });

  test("while it reads, the button says so and the text and the upload are shut", async ({
    person,
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ storageState: person.sessionFile, baseURL: baseURL! });
    try {
      const page = await context.newPage();
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => (release = resolve));
      await page.route("**/importar/leer", async (route) => {
        await gate;
        await route.fulfill({ status: 503, json: { error: "import.errors.noKey" } });
      });
      await page.goto("/metas/importar");
      await settled(page);

      await page.getByLabel(messages.textLabel).fill("algo que leer");
      await page.getByRole("button", { name: "Leer el plan" }).click();

      const reading = page.getByRole("button", { name: "Leyendo el plan…" });
      await expect(reading).toBeDisabled();
      await expect(reading).toHaveAttribute("aria-busy", "true");
      await expect(page.getByText(messages.slow, { exact: true })).toBeVisible();
      await expect(page.getByLabel(messages.textLabel)).toBeDisabled();
      await expect(page.getByLabel(messages.upload)).toBeDisabled();

      release();
      await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveText(NO_KEY);
    } finally {
      await context.close();
    }
  });

  for (const width of [360, 1280]) {
    test(`at ${width} the screen holds: nothing overflows and the template shows`, async ({
      person,
      browser,
      baseURL,
    }) => {
      const context = await browser.newContext({
        storageState: person.sessionFile,
        baseURL: baseURL!,
        viewport: { width, height: 800 },
      });
      try {
        const page = await context.newPage();
        await page.goto("/metas/importar");
        await settled(page);

        await expect(page.getByText(PRIVACY, { exact: true })).toBeVisible();
        await expect(page.getByText(messages.template.note, { exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "copiar la plantilla" })).toBeVisible();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
        const read = await boxOf(page.getByRole("button", { name: "Leer el plan" }));
        expect(read.x).toBeGreaterThanOrEqual(0);
        expect(read.x + read.width).toBeLessThanOrEqual(width);
      } finally {
        await context.close();
      }
    });

    test(`at ${width} a broken line shows «ver la plantilla» under its error and nothing overflows`, async ({
      person,
      browser,
      baseURL,
    }) => {
      const context = await browser.newContext({
        storageState: person.sessionFile,
        baseURL: baseURL!,
        viewport: { width, height: 800 },
      });
      try {
        const page = await context.newPage();
        await page.goto("/metas/importar");
        await settled(page);

        await page.getByLabel(messages.textLabel).fill(EXAMPLE.replace("- 2026-11 · 20 h", "- 2026-13 · 20 h"));
        await page.getByRole("button", { name: "Leer el plan" }).click();
        const alert = page.getByRole("alert").filter({ hasText: /Línea 12/ });
        await expect(alert).toBeVisible();
        const show = page.getByRole("button", { name: "ver la plantilla" });
        await expect(show).toBeVisible();
        expect((await boxOf(show)).y).toBeGreaterThan((await boxOf(alert)).y);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
      } finally {
        await context.close();
      }
    });
  }

  for (const width of [360, 1280]) {
    test(`the header repeats nothing and the quiet lines read in Archivo at ${width}`, async ({ person, browser, baseURL }) => {
      const context = await browser.newContext({ storageState: person.sessionFile, baseURL: baseURL!, viewport: { width, height: 800 } });
      try {
        const page = await context.newPage();
        await page.goto("/metas/importar");
        await settled(page);
        // The way back and the title line: no eyebrow that says «metas» twice.
        await expect(page.locator("main > header > *")).toHaveCount(2);
        for (const line of [messages.privacy, messages.template.note]) {
          const family = await page.getByText(line, { exact: true }).evaluate((el) => getComputedStyle(el).fontFamily);
          expect(family).not.toMatch(/mono/i);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      } finally {
        await context.close();
      }
    });
  }
});
