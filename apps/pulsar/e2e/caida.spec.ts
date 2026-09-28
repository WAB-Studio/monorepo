import { test, expect } from "./fixtures";

// Against `PULSAR_DOWN_BASE_URL`: a `next start` of the same build whose
// `DATABASE_URL` points at a port nothing listens on, so the outage is real
// and the app carries no lever for it. Assert by heading, never by status:
// a route that has streamed answers 200 whatever it then draws
// (docs/TRAPS.md, "A `notFound()` after the page has streamed still answers 200").
const DOWN = process.env.PULSAR_DOWN_BASE_URL;
const LIVE = process.env.PULSAR_BASE_URL ?? "http://localhost:3200";

// A uuid nobody owns.
const GHOST = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";

test.describe("a database outage", () => {
  test.skip(!DOWN, "PULSAR_DOWN_BASE_URL unset: no server with an unreachable database to drive");

  for (const path of [
    `/metas/${GHOST}`,
    `/metas/${GHOST}/fases/nueva`,
    `/metas/${GHOST}/compromisos/nuevo`,
    `/metas/${GHOST}/revision`,
    "/",
  ]) {
    test(`${path} draws the failure page, not the not-found`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: "No se pudo abrir" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Intentar otra vez" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Esta página no existe" })).toHaveCount(0);
    });
  }

  test("the live server draws the not-found for a goal nobody owns", async ({ page }) => {
    await page.goto(`${LIVE}/metas/${GHOST}`);
    await expect(page.getByRole("heading", { name: "Esta página no existe" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "No se pudo abrir" })).toHaveCount(0);
  });
});
