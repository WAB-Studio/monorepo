import type { Page } from "@playwright/test";

import { test, expect } from "./fixtures";

async function createGoal(page: Page, name: string, horizonWeeks: string): Promise<string> {
  await page.goto("/metas/nueva");
  await page.getByLabel("nombre").fill(name);
  await page.getByLabel("horizonte").fill(horizonWeeks);
  await page.getByRole("button", { name: "Abrirla" }).click();
  await page.waitForURL(/\/metas\/[0-9a-f-]{36}$/);
  return page.url().split("/metas/")[1];
}

// RP-15: the weeks the form offers are weeks its own checks accept.
test("the default span submits and lands; with no week left the fields open empty", async ({
  person,
  browser,
}) => {
  const context = await browser.newContext({ storageState: person.sessionFile });
  try {
    const page = await context.newPage();
    const goalId = await createGoal(page, `Meta fase defecto ${Date.now()}`, "2");

    await page.goto(`/metas/${goalId}/fases/nueva`);
    await expect(page.getByLabel("desde la semana")).toHaveValue("1");
    await expect(page.getByLabel("hasta la semana")).toHaveValue("2");
    await page.getByLabel("qué busca").fill(`Defecto ${Date.now()}`);
    await page.getByRole("button", { name: "Añadirla" }).click();
    await page.waitForURL(`**/metas/${goalId}`);
    await expect(page.getByText("semanas 1–2")).toBeVisible();

    // The horizon is spent: nothing to offer, so nothing is prefilled.
    await page.goto(`/metas/${goalId}/fases/nueva`);
    await expect(page.getByLabel("desde la semana")).toHaveValue("");
    await expect(page.getByLabel("hasta la semana")).toHaveValue("");
  } finally {
    await context.close();
  }
});
