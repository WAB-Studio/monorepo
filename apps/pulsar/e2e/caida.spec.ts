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

  test("/ keeps the nav: the outage lands under the layout, not in global-error", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "No se pudo abrir" })).toBeVisible();
    await expect(page.getByRole("navigation")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Esta página no existe" })).toHaveCount(0);
  });

  test("at 1280 the rail draws its four tabs and no goal section when the goals read fails", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    const nav = page.getByRole("navigation");
    await expect(nav).toBeVisible();
    await expect(nav.getByRole("link")).toHaveCount(4);
    await expect(nav.getByText("metas abiertas", { exact: true })).toHaveCount(0);
  });

  test("Intentar otra vez asks the server again", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "No se pudo abrir" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Ir a hoy" })).toHaveAttribute("href", "/");

    // `retry()` re-fetches the boundary's children with an `rsc` header; a
    // `Link` prefetch carries it too, so the prefetch header is excluded.
    const refetch = page.waitForRequest(async (request) => {
      if (new URL(request.url()).origin !== new URL(DOWN ?? "").origin) return false;
      const headers = await request.allHeaders();
      return headers["rsc"] === "1" && headers["next-router-prefetch"] === undefined;
    });
    await page.getByRole("button", { name: "Intentar otra vez" }).click();
    await refetch;

    await expect(page.getByRole("heading", { name: "No se pudo abrir" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Esta página no existe" })).toHaveCount(0);
  });

  // The pool's reconnect backoff decides how soon a retried page redraws: with
  // the default (up to 20 s) the third or fourth press sits on the skeleton.
  // Each press must have the failure heading back within this bound.
  const REDRAW_MS = 3000;

  test("pressing Intentar otra vez five times in a row redraws the failure each time, fast", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "No se pudo abrir" })).toBeVisible();
    const again = page.getByRole("button", { name: "Intentar otra vez" });

    for (let press = 1; press <= 5; press += 1) {
      const refetched = page.waitForResponse(
        (response) =>
          new URL(response.url()).origin === new URL(DOWN ?? "").origin &&
          response.request().headers()["rsc"] === "1" &&
          response.request().headers()["next-router-prefetch"] === undefined,
      );
      const started = Date.now();
      await again.click();
      await refetched;
      await expect(page.getByRole("heading", { name: "No se pudo abrir" })).toBeVisible({ timeout: REDRAW_MS });
      await expect(again).toBeVisible({ timeout: REDRAW_MS });
      expect(Date.now() - started, `press ${press} took too long to redraw`).toBeLessThan(REDRAW_MS);
    }
    await expect(page.getByRole("heading", { name: "Esta página no existe" })).toHaveCount(0);
  });

  test("the live server draws the not-found for a goal nobody owns", async ({ page }) => {
    await page.goto(`${LIVE}/metas/${GHOST}`);
    await expect(page.getByRole("heading", { name: "Esta página no existe" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "No se pudo abrir" })).toHaveCount(0);
  });
});
