import { expect, test } from "./fixtures";
import type { Locator, Page } from "@playwright/test";

import { FUNCTION_WORDS, functionWordTranslation } from "../lib/phrase/function-words";
import messages from "../messages/es.json";
import manifest from "../public/dictionary/manifest.json";

// Module 690 (RL-59, which succeeds RL-57): a function word typed alone leads
// with the hand-written table's translation, and the dictionary's block sits
// behind one 44px control, as 681 folds it inside a sentence. Expected texts
// come from the table itself; the dictionary lines are what the dictionary
// answers today for the same word (critic captures, 2026-10-09).
const FOLDED_LABEL = messages.search.noEntry.showDictionary;
const OPEN_LABEL = messages.search.noEntry.hideDictionary;

// First dictionary line the word answers today, to be folded away.
const DICTIONARY_LEAD: Record<string, string> = {
  it: "tecnología de la información",
  would: "por favor",
  will: "anhelar, desear",
  something: "basurita",
};

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

const searchBox = (page: Page) => page.getByRole("textbox", { name: messages.search.label });

function visible(page: Page, text: string, exact = true): Locator {
  return page.locator("main").getByText(text, { exact }).locator("visible=true");
}

function control(page: Page): Locator {
  return page.locator("main").locator("button[aria-expanded]");
}

async function top(locator: Locator): Promise<number> {
  const box = await locator.first().boundingBox();
  if (!box) throw new Error("no box");
  return box.y;
}

for (const width of [360, 1280]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: width === 360 ? 740 : 800 } });

    for (const word of Object.keys(DICTIONARY_LEAD)) {
      test(`«${word}» typed alone leads with the table; the dictionary is folded behind one 44px control and opens on tap`, async ({
        page,
      }) => {
        const table = functionWordTranslation(word);
        expect(table, `${word} is in the table`).not.toBeNull();
        const dictionary = DICTIONARY_LEAD[word];

        await deleteTranslator(page);
        await openReady(page);
        await searchBox(page).fill(word);

        await expect(visible(page, table as string), "the table's translation is on screen").toHaveCount(1);
        const toggle = control(page);
        await expect(toggle).toHaveCount(1);
        await expect(toggle).toHaveAttribute("aria-expanded", "false");
        await expect(toggle).toHaveText(FOLDED_LABEL);
        expect((await toggle.boundingBox())?.height).toBeGreaterThanOrEqual(44);
        await expect(visible(page, dictionary, false), "the dictionary line is folded away").toHaveCount(0);
        await expect(visible(page, messages.word.translations), "no dictionary group label shows").toHaveCount(0);
        expect(await top(visible(page, table as string)), "the table leads, above the control").toBeLessThan(await top(toggle));

        await toggle.click();
        await expect(toggle).toHaveAttribute("aria-expanded", "true");
        await expect(toggle).toHaveText(OPEN_LABEL);
        await expect(visible(page, dictionary, false)).toHaveCount(1);
        expect(await top(visible(page, table as string)), "and still above the dictionary").toBeLessThan(
          await top(visible(page, dictionary, false)),
        );

        await toggle.click();
        await expect(toggle).toHaveAttribute("aria-expanded", "false");
        await expect(visible(page, dictionary, false)).toHaveCount(0);
      });
    }

    test("a word not in the table answers as before: its dictionary lines, unfolded, no control", async ({ page }) => {
      expect(functionWordTranslation("apple")).toBeNull();
      await deleteTranslator(page);
      await openReady(page);
      await searchBox(page).fill("apple");

      await expect(visible(page, "manzana", false).first()).toBeVisible();
      await expect(visible(page, messages.word.translations).first()).toBeVisible();
      await expect(control(page)).toHaveCount(0);
      await expect(page.getByText(FOLDED_LABEL)).toHaveCount(0);
    });
  });
}

test("every word of the table, typed alone, shows its own table translation and a folded control", async ({ page }) => {
  test.setTimeout(180_000);
  await deleteTranslator(page);
  await openReady(page);
  const failures: string[] = [];
  for (const [word, table] of FUNCTION_WORDS) {
    // Clear first: two words share a gloss ("su"), and the last word's line
    // must not stand in for this one's.
    await searchBox(page).fill("");
    await expect(page.locator("main").getByText(messages.search.empty)).toBeVisible();
    await searchBox(page).fill(word);
    const ok = await visible(page, table)
      .first()
      .waitFor({ timeout: 1500 })
      .then(() => true, () => false);
    // Words the dictionary holds no entry for (am, could) answer with
    // suggestions; what the table owes them is not in the contract.
    if (!ok && (await page.getByText(messages.word.suggestions).count()) > 0) continue;
    const folded = ok && (await control(page).first().getAttribute("aria-expanded", { timeout: 1500 }).catch(() => null)) === "false";
    if (!ok || !folded) failures.push(word);
    if (failures.length >= 3) break;
  }
  expect(failures).toEqual([]);
});

test("offline, a function word typed alone still answers from the table, folded, with no request", async ({
  page,
  context,
}) => {
  await deleteTranslator(page);
  await openReady(page);
  await context.setOffline(true);
  const urls: string[] = [];
  page.on("request", (request) => urls.push(request.url()));

  const table = functionWordTranslation("would") as string;
  await searchBox(page).fill("would");
  await expect(visible(page, table)).toHaveCount(1);
  await expect(control(page)).toHaveAttribute("aria-expanded", "false");
  await expect(visible(page, DICTIONARY_LEAD.would, false)).toHaveCount(0);
  await control(page).click();
  await expect(visible(page, DICTIONARY_LEAD.would, false)).toHaveCount(1);

  await page.waitForTimeout(900);
  // The word's own paid routes may try the network and fail; the phrase
  // route is not a word's business.
  expect(urls.filter((url) => url.includes("/api/translate"))).toEqual([]);
});
