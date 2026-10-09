import { expect, STUB_HEADER, test } from "./fixtures";
import type { Page } from "@playwright/test";

import messages from "../messages/es.json";
import manifest from "../public/dictionary/manifest.json";

// RL-55: a word the dictionary has no entry for is recorded when, and only
// when, the network's answer (RL-44) arrived for that same text.

async function deleteTranslator(page: Page): Promise<void> {
  await page.addInitScript(() => {
    delete (window as unknown as { Translator?: unknown }).Translator;
  });
}

async function openReady(page: Page): Promise<void> {
  const assetResponse = page.waitForResponse(
    (response) => response.url().includes(manifest.asset.path) && response.ok(),
  );
  await page.goto("/");
  await assetResponse;
  await page.waitForTimeout(1000);
}

type Row = {
  text: string;
  normalised: string;
  kind: string;
  outcome: string;
  headword: string | null;
  senses: number;
  translation: string | null;
  origin: unknown;
};

async function readLogRows(page: Page): Promise<Row[]> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("reading-log");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const tx = request.result.transaction("lookups", "readonly");
          const getAll = tx.objectStore("lookups").getAll();
          getAll.onsuccess = () => resolve(getAll.result);
          getAll.onerror = () => reject(getAll.error);
        };
      }),
  );
}

const BODY = {
  translations: ["¿en dónde?", "adónde"],
  definition: "At what place.",
  example: { en: "Whereat did he look?", es: "¿Hacia dónde miró?" },
  lemma: null,
  rule: null,
};

// Settling is the reader moving on: the box is cleared, as log.spec.ts does.
async function settle(page: Page, box: ReturnType<Page["getByRole"]>): Promise<void> {
  await box.fill("");
  await page.waitForTimeout(400);
}

function isUnlistedPost(url: string): boolean {
  return new URL(url).pathname === "/api/word/unlisted";
}

test("respondida: whereat with a 200 answer leaves one unlisted row carrying the body's translation", async ({
  page,
  stubUnlisted,
}) => {
  await deleteTranslator(page);
  await stubUnlisted(BODY);
  await openReady(page);

  const box = page.getByRole("textbox", { name: messages.search.label });
  await box.fill("whereat");
  await expect(page.getByText(messages.word.networkAnswerTitle)).toBeVisible({ timeout: 2000 });
  await settle(page, box);

  const rows = (await readLogRows(page)).filter((row) => row.normalised === "whereat");
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    kind: "word",
    outcome: "unlisted",
    headword: "whereat",
    senses: 0,
    translation: "¿en dónde?, adónde",
    origin: null,
  });
});

test("fallida: whereat answered 204 leaves no row", async ({ page }) => {
  await deleteTranslator(page);
  await openReady(page);

  const box = page.getByRole("textbox", { name: messages.search.label });
  const answered = page.waitForResponse((r) => isUnlistedPost(r.url()));
  await box.fill("whereat");
  expect((await answered).status()).toBe(204);
  await page.waitForTimeout(300);
  await settle(page, box);

  expect((await readLogRows(page)).filter((row) => row.normalised === "whereat")).toHaveLength(0);
});

test("pendiente: an answer held while the reader clears the box leaves no row, even once it arrives", async ({
  page,
  stubUnlisted,
}) => {
  await deleteTranslator(page);
  await stubUnlisted(BODY);

  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let requested = false;
  await page.route(
    (url) => isUnlistedPost(url.toString()),
    async (route) => {
      requested = true;
      await gate;
      await route.fallback();
    },
  );
  await openReady(page);

  const box = page.getByRole("textbox", { name: messages.search.label });
  await box.fill("whereat");
  await expect.poll(() => requested, { timeout: 3000 }).toBe(true);
  await settle(page, box);
  expect((await readLogRows(page)).filter((row) => row.normalised === "whereat")).toHaveLength(0);

  release();
  await page.waitForTimeout(1500);
  expect((await readLogRows(page)).filter((row) => row.normalised === "whereat")).toHaveLength(0);
});

test("forma con lema: ran, even with a network lemma, stays inflected and writes no unlisted row", async ({
  page,
  stubUnlisted,
}) => {
  await deleteTranslator(page);
  await stubUnlisted({ ...BODY, translations: ["corrió"], lemma: "run", rule: "irregular" });
  await openReady(page);

  const box = page.getByRole("textbox", { name: messages.search.label });
  await box.fill("ran");
  await page.waitForTimeout(1500);
  await settle(page, box);

  const rows = (await readLogRows(page)).filter((row) => row.normalised === "ran");
  expect(rows).toHaveLength(1);
  expect(rows[0].outcome).toBe("inflected");
  expect(rows[0].headword).toBe("run");
});

test("caché de la pestaña: a second visit to whereat after another word leaves a second row", async ({
  page,
  stubUnlisted,
}) => {
  await deleteTranslator(page);
  await stubUnlisted(BODY);
  await openReady(page);

  const box = page.getByRole("textbox", { name: messages.search.label });
  for (const word of ["whereat", "coccidiosis", "whereat"]) {
    await box.fill(word);
    await expect(page.getByText(messages.word.networkAnswerTitle)).toBeVisible({ timeout: 2000 });
    await settle(page, box);
  }

  const rows = await readLogRows(page);
  expect(rows.filter((row) => row.normalised === "whereat" && row.outcome === "unlisted")).toHaveLength(2);
  expect(rows.filter((row) => row.normalised === "coccidiosis" && row.outcome === "unlisted")).toHaveLength(1);
});

test("corte: translations joined past 120 characters are stored cut, never longer", async ({
  page,
  stubUnlisted,
}) => {
  await deleteTranslator(page);
  const long = Array.from({ length: 12 }, (_, i) => `traduccion${i}xx`);
  const joined = long.join(", ");
  expect(joined.length).toBeGreaterThan(120);
  await stubUnlisted({ ...BODY, translations: long });
  await openReady(page);

  const box = page.getByRole("textbox", { name: messages.search.label });
  await box.fill("whereat");
  await expect(page.getByText(messages.word.networkAnswerTitle)).toBeVisible({ timeout: 2000 });
  await settle(page, box);

  const rows = (await readLogRows(page)).filter((row) => row.normalised === "whereat");
  expect(rows).toHaveLength(1);
  const stored = rows[0].translation as string;
  expect(stored.length).toBeLessThanOrEqual(120);
  expect(stored.length).toBeGreaterThan(100);
  expect(joined.startsWith(stored)).toBe(true);
  expect(stored).not.toMatch(/[,\s]$/u);
});

test("bajo su búsqueda: an answer for coccidiosis that arrives after the box moved to another word leaves no unlisted row", async ({
  page,
  stubUnlisted,
}) => {
  await deleteTranslator(page);
  await stubUnlisted(BODY);

  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let calls = 0;
  // The first request (coccidiosis) is held; any later one is refused with a
  // 204, so a row under the second word could only come from the held answer.
  await page.route(
    (url) => isUnlistedPost(url.toString()),
    async (route) => {
      calls += 1;
      if (calls === 1) {
        await gate;
        await route.fallback();
      } else {
        await route.fulfill({ status: 204, headers: { [STUB_HEADER]: "1" } });
      }
    },
  );
  await openReady(page);

  const box = page.getByRole("textbox", { name: messages.search.label });
  await box.fill("coccidiosis");
  await expect.poll(() => calls, { timeout: 10000 }).toBe(1);
  await box.fill("whereat");
  await expect.poll(() => calls, { timeout: 10000 }).toBe(2);
  await page.waitForTimeout(400);

  release();
  await page.waitForTimeout(1500);
  await settle(page, box);

  const rows = await readLogRows(page);
  expect(rows.filter((row) => row.outcome === "unlisted")).toHaveLength(0);
});

test("una vez: a focus change and a colour-scheme change after the answer was recorded leave one row", async ({
  page,
  stubUnlisted,
}) => {
  await deleteTranslator(page);
  await stubUnlisted(BODY);
  await openReady(page);

  const box = page.getByRole("textbox", { name: messages.search.label });
  await box.fill("whereat");
  await expect(page.getByText(messages.word.networkAnswerTitle)).toBeVisible({ timeout: 10000 });

  await box.blur();
  await box.focus();
  await page.emulateMedia({ colorScheme: "dark" });
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForTimeout(500);
  await settle(page, box);

  const rows = (await readLogRows(page)).filter((row) => row.normalised === "whereat");
  expect(rows).toHaveLength(1);
  expect(rows[0].outcome).toBe("unlisted");
});

test("bajo su búsqueda: returning to a word whose answer the tab holds records each row under the text it was typed, headword included", async ({
  page,
  stubUnlisted,
}) => {
  await deleteTranslator(page);
  await stubUnlisted(BODY);
  await openReady(page);

  const box = page.getByRole("textbox", { name: messages.search.label });
  for (const word of ["whereat", "coccidiosis", "whereat"]) {
    await box.fill(word);
    await expect(page.getByText(messages.word.networkAnswerTitle)).toBeVisible({ timeout: 10000 });
    await settle(page, box);
  }

  const unlisted = (await readLogRows(page)).filter((row) => row.outcome === "unlisted");
  expect(unlisted.map((row) => row.text)).toEqual(["whereat", "coccidiosis", "whereat"]);
  for (const row of unlisted) expect(row.headword).toBe(row.normalised);
});
