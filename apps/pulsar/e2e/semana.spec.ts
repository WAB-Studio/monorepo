import type postgres from "postgres";

import { test, expect } from "./fixtures";

// Seeded by `harness:seed-goal`: the one goal and its one one-off, already
// attributed to it (RP-20).
const GOAL_NAME = "Inglés B1/B2 → B2+ laboral";
const ONE_OFF_NAME = "Grabar el audio de referencia (semana 1)";

// The same civil-day technique `lib/zone.ts`'s `civilDateInZone`/`weekOf`
// use and `components/week/week-screen.tsx`'s own `dayLabel` formats with —
// read-only here, never imported, so this spec proves the screen's own
// output rather than assuming its implementation.
const TIME_ZONE = "America/Bogota";
const WEEKDAY_SHORT = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

function civilLabel(date: Date): string {
  const civil = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(date);
  const day = Number(civil.slice(8, 10));
  const weekdayIndex = (new Date(`${civil}T12:00:00Z`).getUTCDay() + 6) % 7;
  return `${WEEKDAY_SHORT[weekdayIndex]} ${day}`;
}

function todayLabel(): string {
  return civilLabel(new Date());
}

// A day guaranteed not to be today, so its dots are asserted independently
// of whatever the "complete the one-off" test below does to today's own row.
function otherDayLabel(): string {
  const other = new Date();
  other.setUTCDate(other.getUTCDate() - 1);
  const label = civilLabel(other);
  return label === todayLabel() ? civilLabel(new Date(other.getTime() - 86_400_000)) : label;
}

async function oneOffId(db: postgres.Sql, personId: string): Promise<string> {
  const [row] = await db<{ id: string }[]>`
    select id from goals.one_offs where user_id = ${personId} and name = ${ONE_OFF_NAME}
  `;
  if (!row) {
    throw new Error(`no one-off named "${ONE_OFF_NAME}" for ${personId} — run harness:seed-goal first`);
  }
  return row.id;
}

// Deletes the fact that would mark it done, by the exact id just looked up —
// never a blanket `user_id` delete, since other lanes share this identity's
// table.
async function resetOneOff(db: postgres.Sql, id: string): Promise<void> {
  await db`delete from goals.facts where one_off_id = ${id}`;
}

test("seven rows per goal at 360px, no horizontal overflow (RP-16)", async ({ page }) => {
  await page.goto("/semana");

  const goalSection = page.locator("section", { hasText: GOAL_NAME });
  await expect(goalSection).toBeVisible();
  await expect(goalSection.getByRole("button")).toHaveCount(7);

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(360);
});

test("a day with no facts carries no filled dot (RP-16)", async ({ page }) => {
  await page.goto("/semana");

  const goalSection = page.locator("section", { hasText: GOAL_NAME });
  const row = goalSection.locator("button", { hasText: otherDayLabel() });
  await expect(row).toBeVisible();

  const labels = await row.locator('[role="img"]').evaluateAll((els) =>
    els.map((el) => el.getAttribute("aria-label")),
  );
  // A fresh seed writes no fact anywhere: every dot reads "pendiente"
  // (`week.dot.commitment`/`week.dot.done`/`week.dot.pending`,
  // `messages/es/week.json`), none "hecho" — the mark's own fill, read back
  // through its accessible name rather than a CSS class the build hashes.
  expect(labels.length).toBeGreaterThan(0);
  expect(labels.some((label) => label?.includes("hecho"))).toBe(false);
});

test("a one-off under a goal completed today fills a dot in that goal's today row (RP-20)", async ({
  page,
  db,
  personId,
}) => {
  const id = await oneOffId(db, personId);
  await resetOneOff(db, id);

  try {
    await page.goto("/semana");
    const goalSection = page.locator("section", { hasText: GOAL_NAME });
    const todayRow = goalSection.locator("button", { hasText: todayLabel() });
    await expect(todayRow).toBeVisible();
    const before = await todayRow.locator('[role="img"]').count();

    // Completed from the day screen (`OneOffRow`, `app/actions/one-
    // offs.ts`), never by writing the fact directly — the same gesture a
    // person uses.
    await page.goto("/");
    await page.locator("button", { hasText: ONE_OFF_NAME }).click();
    await expect(page.locator("button", { hasText: ONE_OFF_NAME })).toHaveCount(0);

    await page.goto("/semana");
    const afterRow = goalSection.locator("button", { hasText: todayLabel() });
    const dots = afterRow.locator('[role="img"]');
    await expect(dots).toHaveCount(before + 1);

    const labels = await dots.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
    expect(labels.some((label) => label?.includes("suelta hecha"))).toBe(true);
  } finally {
    await resetOneOff(db, id);
  }
});
