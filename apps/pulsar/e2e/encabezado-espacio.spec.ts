import { test, expect } from "./fixtures";

// Module 306: the header spaces eyebrow -> title at 6 px (`SistemaEspacio.dc.html`).

for (const path of ["/metas/nueva", "/metas/importar", "/semana"]) {
  test(`${path} holds 6 px between its eyebrow and its title`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const eyebrow = (await page.locator("main > header > div").first().boundingBox())!;
    const title = (await page.getByRole("heading", { level: 1 }).boundingBox())!;
    const gap = title.y - (eyebrow.y + eyebrow.height);
    expect(gap).toBeGreaterThanOrEqual(6);
    expect(gap).toBeLessThanOrEqual(8);
  });
}
