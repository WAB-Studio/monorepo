import type postgres from "postgres";

import { test, expect } from "./fixtures";

// Seeded by `harness:seed-goal` (module 20): a plain `tap` commitment, daily,
// with no quantity and no evidence behind it — the one row a single click
// satisfies outright (RP-02).
const TAP_COMMITMENT = "Cerrar el ciclo: tarjetas de los errores";

async function commitmentId(db: postgres.Sql, personId: string, name: string): Promise<string> {
  const [row] = await db<{ id: string }[]>`
    select id from goals.commitments
    where user_id = ${personId} and name = ${name} and retired_at is null
  `;
  if (!row) {
    throw new Error(`no commitment named "${name}" for ${personId} — run harness:seed-goal first`);
  }
  return row.id;
}

// Deletes by the exact ids a lookup just named, never by a blanket
// `user_id` — other pulsar lanes can share this identity.
async function clearFactsFor(db: postgres.Sql, commitmentId: string): Promise<void> {
  const rows = await db<{ id: string }[]>`
    select id from goals.facts where commitment_id = ${commitmentId} and day = current_date
  `;
  if (rows.length > 0) {
    await db`delete from goals.facts where id = any(${rows.map((row) => row.id)})`;
  }
}

test("holds at 360px, no horizontal overflow, every control at least 32px on its shorter side (RNP-07)", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Hoy")).toBeVisible();

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(360);

  const boxes = await page.evaluate(() =>
    Array.from(document.querySelectorAll("button, input"))
      .filter((el) => (el as HTMLElement).offsetParent !== null)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      }),
  );
  // The day, the header control and at least one row: a suite that finds
  // nothing to measure would pass by having proved nothing.
  expect(boxes.length).toBeGreaterThan(0);
  for (const box of boxes) {
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(32);
  }
});

test("one tap on a tap commitment fills its mark in under five seconds (RNP-02, RP-02)", async ({
  page,
  db,
  personId,
}) => {
  const id = await commitmentId(db, personId, TAP_COMMITMENT);
  await clearFactsFor(db, id);

  try {
    await page.goto("/");
    const row = page.locator("button", { hasText: TAP_COMMITMENT });
    await expect(row).toBeVisible();
    // Empty, before the tap: no check mark drawn at all (`Mark`'s own
    // contract — the "empty" state renders nothing inside).
    await expect(row.locator("svg")).toHaveCount(0);

    const start = Date.now();
    await row.click();
    await expect(row.locator("svg")).toBeVisible();
    expect(Date.now() - start).toBeLessThan(5000);
  } finally {
    await clearFactsFor(db, id);
  }
});
