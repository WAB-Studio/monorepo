import { test, expect } from "./fixtures";

// `NoEncontrada.dc.html` (RNP-01): inside the app the layout's nav is the
// only one, and outside it the not-found draws its own, once.
const UNKNOWN_GOAL = "00000000-0000-4000-8000-000000000000";

for (const path of ["/dia/zzz", `/metas/${UNKNOWN_GOAL}`, "/metas/xyz", "/nada"]) {
  test(`${path} says the page does not exist and draws one navigation`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "Esta página no existe" })).toBeVisible();
    await expect(page.getByRole("navigation")).toHaveCount(1);
    await expect(page.getByText("Si era una meta")).toHaveCount(0);
  });
}
