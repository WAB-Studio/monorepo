import { randomUUID } from "node:crypto";

import type { Page } from "@playwright/test";
import type postgres from "postgres";

import { test, expect } from "./fixtures";
import { todayInZone } from "../lib/zone";

// `Semana.dc.html`'s own weekday order (`week.weekdayShort`), read back here
// rather than imported — `week-screen.tsx` composes it from next-intl, and
// this file never opens a component to borrow one string.
const WEEKDAY_SHORT = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

function weekRowLabel(civilDay: string): string {
  const weekdayIndex = (new Date(`${civilDay}T12:00:00Z`).getUTCDay() + 6) % 7;
  return `${WEEKDAY_SHORT[weekdayIndex]} ${Number(civilDay.slice(8, 10))}`;
}

// 23:30 in Bogotá, a fixed -05:00 offset: Colombia keeps no daylight-saving
// time, so this instant is always 04:30 UTC the *next* calendar day
// (docs/TRAPS.md "A timestamptz read as a day lands on tomorrow every
// evening in Bogotá"). `readReadingLookups` has to convert it back to `day`
// through its own `at time zone`, never a bare `::date`, or this whole test
// would see the row on the wrong side of midnight.
function eveningInBogota(day: string): Date {
  return new Date(`${day}T23:30:00-05:00`);
}

type CommitmentRow = { id: string; source_id: string | null; threshold: number | null };

async function commitmentByName(
  db: postgres.Sql,
  personId: string,
  name: string,
): Promise<CommitmentRow | null> {
  const [row] = await db<CommitmentRow[]>`
    select id, source_id, threshold from goals.commitments
    where user_id = ${personId} and name = ${name}
  `;
  return row ?? null;
}

// Same door `compromiso.spec.ts` already opens (RP-11): the horizon field
// keeps its own board default, only the name is this helper's.
async function createGoal(page: Page, name: string): Promise<string> {
  await page.goto("/metas/nueva");
  await page.getByLabel("nombre").fill(name);
  await page.getByRole("button", { name: "Abrirla" }).click();
  await page.waitForURL(/\/metas\/[0-9a-f-]{36}$/);
  return page.url().split("/metas/")[1];
}

async function openNewCommitmentForm(page: Page, goalId: string): Promise<void> {
  await page.goto(`/metas/${goalId}`);
  await page.getByRole("link", { name: "Añadir un compromiso" }).click();
  await page.waitForURL(`**/metas/${goalId}/compromisos/nuevo`);
}

async function deleteGoal(db: postgres.Sql, personId: string, goalId: string): Promise<void> {
  await db`delete from goals.goals where id = ${goalId} and user_id = ${personId}`;
}

// Inserted over the owner connection (`MIGRATION_DATABASE_URL`, RLS bypassed
// the same way every other probe in this suite writes), under the spec's own
// signed-in identity — decided by the user 2026-09-28: a registered harness
// identity may own its own `reading.lookups` rows. One device, one local id
// per row: `lookups`' own primary key is `(user_id, device_id, local_id)`,
// never a surrogate `id` column.
async function insertLookup(
  db: postgres.Sql,
  personId: string,
  deviceId: string,
  localId: number,
  at: Date,
): Promise<void> {
  await db`insert into reading.lookups
    (user_id, device_id, local_id, at, text, normalised, kind, outcome, headword, rule, senses, translation, dictionary_ready, origin, record_schema)
    values (${personId}, ${deviceId}, ${localId}, ${at}, 'evidencia', 'evidencia', 'word', 'miss', null, null, 0, null, true, null, 2)`;
}

// Scoped to the exact device this spec minted — never a blanket delete by
// `personId` alone, and never by any other spec's rows (docs/TRAPS.md "A
// cleanup keyed by a fixture's name deletes every lane's fixtures").
// Idempotent: safe to run once from the test body and again from `finally`.
async function deleteLookups(db: postgres.Sql, personId: string, deviceId: string): Promise<void> {
  await db`delete from reading.lookups where user_id = ${personId} and device_id = ${deviceId}`;
}

async function othersLookupCount(db: postgres.Sql, personId: string): Promise<number> {
  const [row] = await db<{ count: number }[]>`
    select count(*)::int as count from reading.lookups where user_id != ${personId}
  `;
  return row.count;
}

async function factCount(db: postgres.Sql, commitmentId: string): Promise<number> {
  const [row] = await db<{ count: number }[]>`
    select count(*)::int as count from goals.facts where commitment_id = ${commitmentId}
  `;
  return row.count;
}

test("an evidence commitment names diccionario at creation, stays empty below its threshold, marks and names the source at it undoable by nothing, and draws as evidence on /semana (RP-07, RP-08, RP-09)", async ({
  page,
  db,
  personId,
}) => {
  const goalName = `Meta evidencia ${Date.now()}`;
  const commitmentName = `Compromiso evidencia ${Date.now()}`;
  const day = todayInZone();
  const deviceId = randomUUID();
  const threshold = 2;

  // Read before this spec writes a single row, so the isolation claim below
  // is a real before/after, not an assumption.
  const before = await othersLookupCount(db, personId);

  const goalId = await createGoal(page, goalName);

  try {
    await openNewCommitmentForm(page, goalId);
    await page.getByLabel("qué es").fill(commitmentName);

    await page.getByRole("button", { name: "lo que ya sabe otra app", exact: true }).click();
    // The catalogue's one source, read by its own labelKey — never typed
    // here, `sources.json`'s own word.
    await expect(page.getByRole("button", { name: "diccionario", exact: true })).toBeVisible();

    const thresholdField = page.getByLabel("umbral");
    await expect(thresholdField).toHaveValue("1");
    await thresholdField.fill(String(threshold));

    await page.getByRole("button", { name: "Añadirlo" }).click();
    await page.waitForURL(`**/metas/${goalId}`);

    // The goal screen's own words for it (`commitment-list.tsx`'s
    // `satisfactionWords`): the threshold just typed, plural, over the
    // source's own name.
    await expect(page.getByText(`${threshold} búsquedas · diccionario`)).toBeVisible();

    const commitment = await commitmentByName(db, personId, commitmentName);
    expect(commitment).not.toBeNull();
    expect(commitment!.threshold).toBe(threshold);
    expect(commitment!.source_id).not.toBeNull();
    const commitmentId = commitment!.id;

    // Before any lookup: the day's row is empty, names no act (no source
    // text yet), and there is no tap that could write a fact for it — the
    // row is a disabled button, and evidence never reaches `declareFact`
    // regardless (RP-05).
    await page.goto("/");
    const row = page.locator("button", { hasText: commitmentName });
    await expect(row).toBeVisible();
    await expect(row.locator("[data-state]")).toHaveAttribute("data-state", "empty");
    await expect(row).not.toContainText("diccionario");
    await expect(row).toBeDisabled();
    expect(await factCount(db, commitmentId)).toBe(0);

    // One fewer than the threshold, stamped at 23:30 Bogotá: still empty.
    await insertLookup(db, personId, deviceId, 1, eveningInBogota(day));
    await page.reload();
    await expect(row.locator("[data-state]")).toHaveAttribute("data-state", "empty");
    await expect(row).not.toContainText("diccionario");

    // The threshold itself, stamped the same evening: the evidence mark
    // (never the declared one), named, and still nothing to undo — the same
    // disabled row, never a second one that appears once satisfied.
    await insertLookup(db, personId, deviceId, 2, eveningInBogota(day));
    await page.reload();
    await expect(row.locator("[data-state]")).toHaveAttribute("data-state", "evidence");
    await expect(row).toContainText("diccionario");
    await expect(row).toBeDisabled();
    expect(await factCount(db, commitmentId)).toBe(0);

    // /semana draws that same day's dot as evidence, named the same way
    // `week.dot.evidence` composes it.
    await page.goto("/semana");
    const goalSection = page.locator("section", { hasText: goalName });
    const todayRow = goalSection.locator("button", { hasText: weekRowLabel(day) });
    await expect(todayRow).toBeVisible();
    const dot = todayRow.locator(`[role="img"][aria-label="${commitmentName}: diccionario"]`);
    await expect(dot).toHaveCount(1);
    await expect(dot).toHaveAttribute("data-state", "evidence");
  } finally {
    // Deleted by the exact ids this spec minted — the identity's own purge
    // (module 53's `dropRun`, `ON DELETE CASCADE`) is the backstop, not the
    // only door.
    await deleteLookups(db, personId, deviceId);
    await deleteGoal(db, personId, goalId);
  }

  // Nothing landed under, or survived under, any identity but this spec's
  // own: the count of every other row is exactly what it was before this
  // spec wrote anything.
  const after = await othersLookupCount(db, personId);
  expect(after).toBe(before);
});
