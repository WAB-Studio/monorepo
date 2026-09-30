import { test, expect } from "./fixtures";

// `lib/theme.ts`'s blocking `<head>` script is the only thing that decides
// the very first frame (RNP-08); React never repaints it correctly a second
// time on its own — a mount effect only reacts to a later click. A read at
// the navigation's "commit" is no observation of that frame: the new
// document may have no `<html>` yet, or an `<html>` the head script has not
// reached. So an init script samples the class on every animation frame of
// the reloaded page — a frame callback runs right before that frame is
// painted — and the test reads the samples once the page has settled.
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

  await page.addInitScript(() => {
    const frames: string[] = [];
    (window as unknown as { __themeFrames: string[] }).__themeFrames = frames;
    const sample = () => {
      const root = document.documentElement;
      if (root) frames.push(root.className);
      if (document.readyState !== "complete") requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.reload();

  // Settled: the content, not the loading fallback, is standing.
  await expect(page.locator("main")).toHaveCount(1);
  const frames = await page.evaluate(
    () => (window as unknown as { __themeFrames: string[] }).__themeFrames,
  );
  expect(frames.length).toBeGreaterThan(0);
  expect(frames[0]).toMatch(/\bdark\b/);
  for (const frame of frames) {
    expect(frame).toMatch(/\bdark\b/);
    expect(frame).not.toMatch(/\blight\b/);
  }

  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
});
