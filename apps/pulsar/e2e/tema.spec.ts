import { test, expect } from "./fixtures";

// `lib/theme.ts`'s blocking `<head>` script is the only thing that decides
// the very first frame (RNP-08); React never repaints it correctly a second
// time on its own — a mount effect only reacts to a later click. Reading the
// class any later than the page's own "commit" — the earliest point control
// ever returns to this file, before the frame is painted — would only prove
// the class was eventually right, which a real flash could still have beaten
// on screen. `waitUntil: "commit"` plus an immediate `evaluate` is the
// closest a test gets to what the eye actually sees first.
test("the theme control, used once, survives a reload with no flash of the other face (RNP-08)", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");

  // No choice made yet: opens in the system's mode (RNP-08's own second
  // half), never a face `applyTheme` had to write first. `<html>` also
  // carries the two font-variable classes from `app/layout.tsx`, so a
  // regexp is matched rather than the whole attribute.
  await expect(page.locator("html")).toHaveClass(/\blight\b/);

  await page.getByRole("button", { name: "Cambiar a modo oscuro" }).click();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);

  await page.reload({ waitUntil: "commit" });
  const classAtCommit = await page.evaluate(() => document.documentElement.className);
  expect(classAtCommit).toContain("dark");
  expect(classAtCommit).not.toContain("light");

  // The client render agrees once it settles — the commit-time read above
  // is the one that matters, this is only that it does not later contradict it.
  await expect(page.locator("html")).toHaveClass(/\blight\b/);
});
