import type { Page } from "@playwright/test";
import type postgres from "postgres";

import { test, expect } from "./fixtures";

// Seeded by `harness:seed-goal`: the one goal and its one one-off, already
// attributed to it (RP-20).
const GOAL_NAME = "Inglés B1/B2 → B2+ laboral";
const ONE_OFF_NAME = "Grabar el audio de referencia (semana 1)";

// The same civil-day technique `lib/zone.ts`'s `civilDateInZone`/`weekOf`
// use — read-only here, never imported, so this spec proves the screen's own
// output rather than assuming its implementation.
const TIME_ZONE = "America/Bogota";
const WEEKDAY_LONG = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

function civilName(date: Date): string {
  const civil = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(date);
  const weekdayIndex = (new Date(`${civil}T12:00:00Z`).getUTCDay() + 6) % 7;
  return `${WEEKDAY_LONG[weekdayIndex]} ${Number(civil.slice(8, 10))}`;
}

function todayName(): string {
  return civilName(new Date());
}

// A day guaranteed not to be today and inside today's own week, so its marks
// are asserted independently of whatever the "complete the one-off" test below
// does to today's own column. Yesterday on a Monday belongs to the week before.
function otherDayName(): string {
  const today = todayName();
  const isMonday = today.startsWith(`${WEEKDAY_LONG[0]} `);
  const step = isMonday ? 1 : -1;
  for (let hours = 24; hours <= 48; hours += 12) {
    const name = civilName(new Date(Date.now() + step * hours * 3_600_000));
    if (name !== today) return name;
  }
  throw new Error("no other day of this week found");
}

// The state `components/ui/week-table.tsx` should have painted for a given
// mark, read off nothing but its own accessible name (`week.mark.*`,
// `messages/es/week.json`), so a mutation that paints the wrong fill while
// leaving the label alone has somewhere to be caught.
function expectedStateFor(label: string): string {
  if (label.endsWith(": no pedía")) return "none";
  if (label.endsWith(": no hecho") || label.endsWith(": todavía no")) return "empty";
  if (label.endsWith(": hecho")) return "declared";
  return "evidence";
}

// The marks on screen: the phone's fold and the desktop's table both sit in
// the markup, one of them hidden.
async function marks(page: Page, namePrefix: string): Promise<{ label: string | null; state: string | null }[]> {
  return page.locator('[role="img"]').evaluateAll(
    (els, prefix) =>
      els
        .filter((el) => el.checkVisibility() && (el.getAttribute("aria-label") ?? "").startsWith(prefix))
        .map((el) => ({ label: el.getAttribute("aria-label"), state: el.getAttribute("data-state") })),
    namePrefix,
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

// A commitment asks nothing before the civil day it was written, and the
// seed writes them today: without this, a Sunday's other day (yesterday) and
// a Monday's would hold no dots at all. Moved back by id, restored by id.
async function backdateCommitments(
  db: postgres.Sql,
  personId: string,
): Promise<() => Promise<void>> {
  const originals = await db<{ id: string; created_at: Date }[]>`
    select id, created_at from goals.commitments where user_id = ${personId}
  `;
  const ids = originals.map((row) => row.id);
  if (ids.length > 0) {
    await db`
      update goals.commitments set created_at = created_at - interval '30 days'
      where id in ${db(ids)} and user_id = ${personId}
    `;
  }
  return async () => {
    for (const row of originals) {
      await db`
        update goals.commitments set created_at = ${row.created_at}
        where id = ${row.id} and user_id = ${personId}
      `;
    }
  };
}

test("at 360px a commitment is one row of seven marks, no horizontal overflow (RP-16)", async ({
  page,
  db,
  personId,
}) => {
  const [commitment] = await db<{ name: string }[]>`
    select c.name from goals.commitments c join goals.goals g on g.id = c.goal_id
    where c.user_id = ${personId} and g.name = ${GOAL_NAME} and c.retired_at is null order by c.created_at limit 1
  `;
  await page.goto("/semana");
  await expect(page.getByText(GOAL_NAME, { exact: false }).locator("visible=true").first()).toBeVisible();

  expect((await marks(page, `${commitment.name}, `)).length).toBe(7);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(360);
});

test("a day with no facts carries no filled mark (RP-16)", async ({ page, db, personId }) => {
  const restore = await backdateCommitments(db, personId);
  try {
    await checkEmptyOtherDay(page);
  } finally {
    await restore();
  }
});

async function checkEmptyOtherDay(page: Page): Promise<void> {
  await page.goto("/semana");
  await expect(page.getByText(GOAL_NAME, { exact: false }).locator("visible=true").first()).toBeVisible();

  const day = otherDayName();
  const dots = (await marks(page, "")).filter(({ label }) => label?.includes(`, ${day}: `));
  // A fresh seed writes no fact anywhere: every mark of the day reads «no
  // hecho» (or «todavía no» on a Monday's tomorrow), none «hecho».
  expect(dots.length).toBeGreaterThan(0);
  expect(dots.some(({ label }) => label?.endsWith(": hecho") || label?.includes("por evidencia"))).toBe(false);
  // The label alone is not the mark: a dot could still paint its accent fill
  // while its own name read «no hecho» (`slotStatus` pinned to done). Every
  // mark must paint what its own name says.
  for (const { label, state } of dots) {
    expect(state).toBe(expectedStateFor(label ?? ""));
  }
  expect(dots.every(({ state }) => state === "empty" || state === "none")).toBe(true);
}

test("a one-off under a goal completed today fills a mark in that goal's today column (RP-20)", async ({
  page,
  db,
  personId,
}) => {
  const id = await oneOffId(db, personId);
  await resetOneOff(db, id);

  try {
    await page.goto("/semana");
    await expect(page.getByText(GOAL_NAME, { exact: false }).locator("visible=true").first()).toBeVisible();
    // Undone, the one-off has no fact and so no row.
    expect((await marks(page, `${ONE_OFF_NAME}, `)).length).toBe(0);

    // Completed from the day screen (`OneOffRow`, `app/actions/one-
    // offs.ts`), never by writing the fact directly — the same gesture a
    // person uses. The mark, not the name (RP-22 split the row in two: the
    // name alone opens the delete sheet).
    await page.goto("/");
    const nameButton = page.locator("button", { hasText: ONE_OFF_NAME });
    const rowContainer = nameButton.locator("xpath=ancestor::div[1]");
    await rowContainer.getByRole("button", { name: "Marcar como hecho" }).click();
    // Done, it stays on Hoy under «hechas hoy», its mark now the undo (module 68).
    await expect(page.getByRole("button", { name: `Deshacer: ${ONE_OFF_NAME}` })).toBeVisible();

    await page.goto("/semana");
    await expect(page.getByText(ONE_OFF_NAME).locator("visible=true").first()).toBeVisible();
    const dots = await marks(page, `${ONE_OFF_NAME}, `);
    expect(dots.length).toBe(7);
    const mark = dots.find(({ label }) => label === `${ONE_OFF_NAME}, ${todayName()}: hecho`);
    expect(mark).toBeDefined();
    // The one-off's own mark paints the accent fill exactly like a satisfied
    // commitment's — never left `empty` under a label that already says
    // «hecho», and never a third colour of its own.
    expect(mark?.state).toBe("declared");
    for (const { label, state } of dots) {
      expect(state).toBe(expectedStateFor(label ?? ""));
    }
  } finally {
    await resetOneOff(db, id);
  }
});

test("a one-off belonging to nothing, done today, fills a mark in the Sueltas group on /semana (RP-20)", async ({
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
    await expect(page.getByRole("button", { name: `Deshacer: ${name}` })).toBeVisible();

    await page.goto("/semana");
    // `loadWeek`'s own `oneOffFacts` (RP-20's second half): a fact with no
    // goal still has a day, so this group draws even with no goal open.
    await expect(page.getByText("Sueltas", { exact: true }).locator("visible=true")).toBeVisible();

    const dots = await marks(page, `${name}, `);
    const mark = dots.find(({ label }) => label === `${name}, ${todayName()}: hecho`);
    expect(mark).toBeDefined();
    expect(mark?.state).toBe("declared");
  } finally {
    // Deletes the fact along with it (`facts.one_off_id`'s own cascade) —
    // never a blanket delete by name, only this exact row's id.
    await db`delete from goals.one_offs where id = ${id} and user_id = ${personId}`;
  }
});
