import type postgres from "postgres";

import { test, expect } from "./fixtures";
import { todayInZone } from "@/lib/zone";

// Seeded by `harness:seed-goal`: a plain `tap` commitment (RP-02) and a
// `quantity` one, target 10 `minutos` (RP-03) — the same two rows `dia.spec
// .ts` and `cantidad.spec.ts` already drive.
const TAP_COMMITMENT = "Cerrar el ciclo: tarjetas de los errores";
const QUANTITY_COMMITMENT = "Anki";

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

// Scoped by exact id, never by `user_id` alone: other pulsar lanes share this
// identity (`docs/TRAPS.md`, "A cleanup keyed by a fixture's name…").
async function clearFactsFor(db: postgres.Sql, commitmentId: string): Promise<void> {
  const rows = await db<{ id: string }[]>`
    select id from goals.facts where commitment_id = ${commitmentId} and day = ${todayInZone()}::date
  `;
  if (rows.length > 0) {
    await db`delete from goals.facts where id = any(${rows.map((row) => row.id)})`;
  }
}

async function factCountFor(db: postgres.Sql, commitmentId: string): Promise<number> {
  const rows = await db<{ id: string }[]>`
    select id from goals.facts where commitment_id = ${commitmentId} and day = ${todayInZone()}::date
  `;
  return rows.length;
}

// Serial: both specs drive the same seeded commitment for the same person,
// and the suite's own `workers: 2` would otherwise run them at once, each
// clearing and writing the other's facts underneath it.
test.describe.serial("a done tap row undoes on its second tap (RP-05)", () => {
  test("tap, tap again, tap a third time — one fact, zero, one", async ({ page, db, personId }) => {
    const id = await commitmentId(db, personId, TAP_COMMITMENT);
    await clearFactsFor(db, id);

    try {
      await page.goto("/");
      const row = page.locator("button", { hasText: TAP_COMMITMENT });

      await row.click();
      await expect(row.locator("svg")).toBeVisible();
      await expect.poll(() => factCountFor(db, id)).toBe(1);

      await row.click();
      await expect(row.locator("svg")).toHaveCount(0);
      await expect.poll(() => factCountFor(db, id)).toBe(0);

      await row.click();
      await expect(row.locator("svg")).toBeVisible();
      await expect.poll(() => factCountFor(db, id)).toBe(1);
    } finally {
      await clearFactsFor(db, id);
    }
  });

  test("two rapid taps on an undone row leave exactly one fact (RNP-02's own guard)", async ({
    page,
    db,
    personId,
  }) => {
    const id = await commitmentId(db, personId, TAP_COMMITMENT);
    await clearFactsFor(db, id);

    try {
      await page.goto("/");
      const row = page.locator("button", { hasText: TAP_COMMITMENT });

      await Promise.all([row.click(), row.click()]);
      await expect(row.locator("svg")).toBeVisible();
      await expect.poll(() => factCountFor(db, id)).toBe(1);
    } finally {
      await clearFactsFor(db, id);
    }
  });
});

test("a quantity row shows what was logged, with its note, and undoes from the sheet (RP-04, RP-05)", async ({
  page,
  db,
  personId,
}) => {
  const id = await commitmentId(db, personId, QUANTITY_COMMITMENT);
  await clearFactsFor(db, id);
  const note = `nota de prueba ${Date.now()}`;
  const chosen = 25;

  try {
    await page.goto("/");
    const row = page.locator("button", { hasText: QUANTITY_COMMITMENT });

    await row.click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();

    await sheet.getByRole("button", { name: "Escribir otra cantidad" }).click();
    await sheet.getByLabel("Otra cantidad").fill(String(chosen));
    await sheet.getByLabel("Una línea, si quieres").fill(note);
    await sheet.getByRole("button", { name: "Anotar" }).click();
    await expect(sheet).toBeHidden();

    // What was logged, never the plan's own target (RP-04's own "done row").
    await expect(row).toContainText(`${chosen} minutos`);
    await expect(page.getByText(note)).toBeVisible();
    await expect.poll(() => factCountFor(db, id)).toBe(1);

    // Reopen: the sheet reads the logged figure and note back, and offers
    // «Deshacer» beside changing the amount.
    await row.click();
    await expect(sheet).toBeVisible();
    await expect(sheet.getByLabel("Otra cantidad")).toHaveValue(String(chosen));
    await expect(sheet.getByLabel("Una línea, si quieres")).toHaveValue(note);

    await sheet.getByRole("button", { name: "Deshacer" }).click();
    await expect(sheet).toBeHidden();

    await expect.poll(() => factCountFor(db, id)).toBe(0);
    await expect(page.getByText(note)).toHaveCount(0);
  } finally {
    await clearFactsFor(db, id);
  }
});
