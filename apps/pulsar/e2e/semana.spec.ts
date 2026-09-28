import type { Locator } from "@playwright/test";
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

// A day guaranteed not to be today and inside today's own week, so its dots
// are asserted independently of whatever the "complete the one-off" test below
// does to today's own row. Yesterday on a Monday belongs to the week before.
function otherDayLabel(): string {
  const today = todayLabel();
  const isMonday = today.startsWith(`${WEEKDAY_SHORT[0]} `);
  const step = isMonday ? 1 : -1;
  for (let hours = 24; hours <= 48; hours += 12) {
    const label = civilLabel(new Date(Date.now() + step * hours * 3_600_000));
    if (label !== today) return label;
  }
  throw new Error("no other day of this week found");
}

// The state `components/ui/mark.tsx` should have painted for a given dot,
// read off nothing but its own accessible name (`week.dot.*`,
// `messages/es/week.json`) — never `commitmentDotState`'s own source, so a
// mutation that paints the wrong fill while leaving the label alone (module
// 17's own surviving mutant) has somewhere to be caught.
function expectedStateFor(label: string): string {
  if (label === "suelta hecha") return "declared";
  if (label.endsWith(": pendiente")) return "empty";
  if (label.endsWith(": hecho")) return "declared";
  return "evidence";
}

// A past day's row is a `div` with a link (`Semana.dc.html`), today's and a
// future day's a `button`: the label's own text finds either.
function dayRow(section: Locator, label: string): Locator {
  return section.locator("button, div").filter({ hasText: label });
}

async function dotStates(locator: Locator): Promise<{ label: string | null; state: string | null }[]> {
  return locator.locator('[role="img"]').evaluateAll((els) =>
    els.map((el) => ({ label: el.getAttribute("aria-label"), state: el.getAttribute("data-state") })),
  );
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
  await expect(goalSection.locator("button, a")).toHaveCount(7);

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(360);
});

test("a day with no facts carries no filled dot (RP-16)", async ({ page }) => {
  await page.goto("/semana");

  const goalSection = page.locator("section", { hasText: GOAL_NAME });
  const row = dayRow(goalSection, otherDayLabel());
  await expect(row).toBeVisible();

  const dots = await dotStates(row);
  // A fresh seed writes no fact anywhere: every dot reads "pendiente"
  // (`week.dot.commitment`/`week.dot.done`/`week.dot.pending`,
  // `messages/es/week.json`), none "hecho" — the mark's own fill, read back
  // through its accessible name rather than a CSS class the build hashes.
  expect(dots.length).toBeGreaterThan(0);
  expect(dots.some(({ label }) => label?.includes("hecho"))).toBe(false);
  // The label alone is not the mark: a dot could still paint its accent fill
  // while its own name still read "pendiente" (module 17's surviving
  // mutant, `commitmentDotState` pinned to "declared"). Every dot on an
  // untouched day must paint `empty`, and every one of them must paint what
  // its own name says it should — the same rule a satisfied or an evidence
  // day would be held to.
  for (const { label, state } of dots) {
    expect(state).toBe(expectedStateFor(label ?? ""));
  }
  expect(dots.every(({ state }) => state === "empty")).toBe(true);
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
    const todayRow = dayRow(goalSection, todayLabel());
    await expect(todayRow).toBeVisible();
    const before = await todayRow.locator('[role="img"]').count();

    // Completed from the day screen (`OneOffRow`, `app/actions/one-
    // offs.ts`), never by writing the fact directly — the same gesture a
    // person uses. The mark, not the name (RP-22 split the row in two: the
    // name alone opens the delete sheet).
    await page.goto("/");
    const nameButton = page.locator("button", { hasText: ONE_OFF_NAME });
    const rowContainer = nameButton.locator("xpath=ancestor::div[1]");
    await rowContainer.getByRole("button", { name: "Marcar como hecho" }).click();
    await expect(nameButton).toHaveCount(0);

    await page.goto("/semana");
    const afterRow = dayRow(goalSection, todayLabel());
    await expect(afterRow.locator('[role="img"]')).toHaveCount(before + 1);

    const dots = await dotStates(afterRow);
    const oneOff = dots.find(({ label }) => label?.includes("suelta hecha"));
    expect(oneOff).toBeDefined();
    // The one-off's own dot paints the accent fill exactly like a satisfied
    // commitment's — never left `empty` under a label that already says
    // "hecha", and never a third colour of its own.
    expect(oneOff?.state).toBe("declared");
    for (const { label, state } of dots) {
      expect(state).toBe(expectedStateFor(label ?? ""));
    }
  } finally {
    await resetOneOff(db, id);
  }
});

test("a one-off belonging to nothing, done today, fills a dot in the Sueltas row on /semana (RP-20)", async ({
  page,
  db,
  personId,
}) => {
  const name = `Suelta sin meta ${Date.now()}`;

  // Written from the day's own field, never a goal's group (`NewOneOff`'s
  // own `goalId` left undefined) — `.last()` is not needed here since this
  // spec writes no other one-off first, but the field at the foot of
  // "Sueltas" is still the last "Algo suelto" on the page.
  await page.goto("/");
  const field = page.getByLabel("Algo suelto").last();
  await field.fill(name);
  await field.press("Enter");

  const nameButton = page.locator("button", { hasText: name });
  await expect(nameButton).toBeVisible();

  const [row] = await db<{ id: string }[]>`
    select id from goals.one_offs where user_id = ${personId} and name = ${name} and goal_id is null
  `;
  if (!row) throw new Error(`no goalless one-off named "${name}" landed for ${personId}`);
  const id = row.id;

  try {
    const rowContainer = nameButton.locator("xpath=ancestor::div[1]");
    await rowContainer.getByRole("button", { name: "Marcar como hecho" }).click();
    await expect(nameButton).toHaveCount(0);

    await page.goto("/semana");
    // `loadWeek`'s own `oneOffFacts` (RP-20's second half): a fact with no
    // goal still has a day, so this group draws even with no goal open.
    const sueltas = page.locator("section", { hasText: "Sueltas" });
    await expect(sueltas).toBeVisible();
    const todayRow = dayRow(sueltas, todayLabel());
    await expect(todayRow).toBeVisible();

    const dots = await dotStates(todayRow);
    const oneOff = dots.find(({ label }) => label?.includes("suelta hecha"));
    expect(oneOff).toBeDefined();
    expect(oneOff?.state).toBe("declared");
  } finally {
    // Deletes the fact along with it (`facts.one_off_id`'s own cascade) —
    // never a blanket delete by name, only this exact row's id.
    await db`delete from goals.one_offs where id = ${id} and user_id = ${personId}`;
  }
});
