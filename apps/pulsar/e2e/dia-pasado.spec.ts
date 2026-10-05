import type postgres from "postgres";

import { test, expect } from "./fixtures";
import { civilDateToDate, dateToCivilDate, todayInZone } from "@/lib/zone";

// RP-06's own screen (`DiaPasado.dc.html`): a day already past, reached by a
// step back from Hoy. Each test seeds its own goal and commitment straight
// into the database — backdated, since `declareFact` refuses a day before a
// commitment existed — and drops the goal by the id it got back.
// Paths by day: none; «empezó el» names a day inside the seven back, in any week.

// Seven, as `PAST_DAY_LIMIT` (`lib/validation/fact.ts`) says: typed again
// here on purpose, so a limit changed there is a limit this spec notices.
const LIMIT = 7;

// «Yesterday» is today minus one civil day in the person's zone, whatever
// week it falls in: on a Monday it is last week's Sunday (`docs/TRAPS.md`,
// the Monday entry), and nothing here reads a week, so that day is as good
// as any other.
function pastDay(daysAgo: number): string {
  const date = civilDateToDate(todayInZone());
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return dateToCivilDate(date);
}

// ICU's Spanish weekday, never the catalogue's list the screen reads.
function writtenLabel(day: string): string {
  const date = civilDateToDate(day);
  const weekday = new Intl.DateTimeFormat("es", { weekday: "long", timeZone: "UTC" }).format(date);
  return `anotado el ${weekday} ${date.getUTCDate()}`;
}

async function seedGoal(
  db: postgres.Sql,
  personId: string,
  commitment: { name: string; kind: "tap" } | { name: string; kind: "quantity"; target: number; unit: string },
): Promise<{ goalId: string; commitmentId: string }> {
  const stamp = Date.now();
  // The goal opens before the commitment it backdates: a day before its goal
  // is not drawn (RNP-07).
  const createdAt = new Date(Date.now() - (LIMIT + 3) * 86_400_000);
  const [goal] = await db<{ id: string }[]>`
    insert into goals.goals (user_id, name, horizon, created_at)
    values (
      ${personId}, ${`Meta día pasado ${stamp}`}, ${pastDay(-60)},
      ${new Date(createdAt.getTime() - 86_400_000)}
    ) returning id
  `;
  const [row] = await db<{ id: string }[]>`
    insert into goals.commitments
      (user_id, goal_id, name, cadence_kind, satisfaction, target_quantity, unit, created_at)
    values (
      ${personId}, ${goal.id}, ${commitment.name}, 'daily', ${commitment.kind},
      ${commitment.kind === "quantity" ? commitment.target : null},
      ${commitment.kind === "quantity" ? commitment.unit : null},
      ${createdAt}
    ) returning id
  `;
  return { goalId: goal.id, commitmentId: row.id };
}

async function deleteGoal(db: postgres.Sql, personId: string, goalId: string): Promise<void> {
  await db`delete from goals.goals where id = ${goalId} and user_id = ${personId}`;
}

async function factsFor(db: postgres.Sql, commitmentId: string) {
  return db<{ day: string; quantity: number | null }[]>`
    select day::text as day, quantity from goals.facts where commitment_id = ${commitmentId}
  `;
}

test("from Hoy, steps back reach yesterday and then the seventh day back, and no eighth step is drawn (RP-06)", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Ver ayer" }).click();
  await page.waitForURL(`**/dia/${pastDay(1)}`);
  await expect(page.getByRole("link", { name: "volver a hoy" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Semana" })).toHaveAttribute("aria-current", "page");

  for (let back = 2; back <= LIMIT; back++) {
    await page.getByRole("link", { name: "Ver el día anterior" }).click();
    await page.waitForURL(`**/dia/${pastDay(back)}`);
  }

  await expect(page.getByRole("link", { name: "volver a hoy" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Ver el día anterior" })).toHaveCount(0);

  await page.getByRole("link", { name: "volver a hoy" }).click();
  await page.waitForURL((url) => url.pathname === "/");
});

test("on yesterday a tap writes one fact for yesterday, read as written today; Hoy is untouched; a second tap undoes it (RP-06, RP-05)", async ({
  page,
  db,
  personId,
}) => {
  const name = `Compromiso día pasado ${Date.now()}`;
  const { goalId, commitmentId } = await seedGoal(db, personId, { name, kind: "tap" });
  const yesterday = pastDay(1);

  try {
    await page.goto(`/dia/${yesterday}`);
    const row = page.locator("button", { hasText: name });
    await expect(row.locator("svg")).toHaveCount(0);

    await row.click();
    await expect(row.locator("svg")).toBeVisible();
    await expect(row).toContainText(writtenLabel(todayInZone()));
    expect(await factsFor(db, commitmentId)).toEqual([{ day: yesterday, quantity: null }]);

    await page.goto("/");
    const todayRow = page.locator("button", { hasText: name });
    await expect(todayRow).toBeVisible();
    await expect(todayRow.locator("svg")).toHaveCount(0);
    await expect(todayRow).not.toContainText("anotado");

    await page.goto(`/dia/${yesterday}`);
    await expect(row.locator("svg")).toBeVisible();
    await row.click();
    await expect(row.locator("svg")).toHaveCount(0);
    await expect(row).not.toContainText("anotado");
    await expect.poll(() => factsFor(db, commitmentId).then((rows) => rows.length)).toBe(0);
  } finally {
    await deleteGoal(db, personId, goalId);
  }
});

test("a quantity row on a past day asks for that day and writes its number there (RP-03, RP-06)", async ({
  page,
  db,
  personId,
}) => {
  const name = `Cantidad día pasado ${Date.now()}`;
  const { goalId, commitmentId } = await seedGoal(db, personId, {
    name,
    kind: "quantity",
    target: 10,
    unit: "minutos",
  });
  const day = pastDay(3);

  try {
    await page.goto(`/dia/${day}`);
    await page.locator("button", { hasText: name }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toContainText("¿Cuánto hiciste ese día?");
    await sheet.getByRole("button", { name: "Anotar" }).click();
    await expect(sheet).toBeHidden();

    expect(await factsFor(db, commitmentId)).toEqual([{ day, quantity: 10 }]);
    await expect(page.locator("button", { hasText: name })).toContainText(
      new RegExp(`10 min · \\d{2}:\\d{2} · lo dijiste tú · ${writtenLabel(todayInZone())}`),
    );
  } finally {
    await deleteGoal(db, personId, goalId);
  }
});

test("a past day draws no one-offs and no field, and holds at 360px (RP-06, RP-19, RNP-07)", async ({
  page,
  db,
  personId,
}) => {
  const name = `Suelta vista desde ayer ${Date.now()}`;
  const { goalId } = await seedGoal(db, personId, { name: `Compromiso ${name}`, kind: "tap" });
  const [oneOff] = await db<{ id: string }[]>`
    insert into goals.one_offs (user_id, name, day)
    values (${personId}, ${name}, ${pastDay(2)}) returning id
  `;

  try {
    await page.goto(`/dia/${pastDay(1)}`);
    await expect(page.getByRole("link", { name: "volver a hoy" })).toBeVisible();
    await expect(page.getByText(/hechos \d+ de \d+/).first()).toBeVisible();
    await expect(page.getByText(name, { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Algo suelto")).toHaveCount(0);

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(360);
    await page.screenshot({ path: "private/dia-pasado-360.png", fullPage: true });
  } finally {
    await db`delete from goals.one_offs where id = ${oneOff.id}`;
    await deleteGoal(db, personId, goalId);
  }
});

test("a commitment created today and a goal opened today are absent from yesterday (RNP-07)", async ({
  page,
  db,
  personId,
}) => {
  const stamp = Date.now();
  const goalName = `Meta recién abierta ${stamp}`;
  const commitmentName = `Compromiso recién nacido ${stamp}`;
  const [goal] = await db<{ id: string }[]>`
    insert into goals.goals (user_id, name, horizon)
    values (${personId}, ${goalName}, ${pastDay(-60)}) returning id
  `;

  try {
    await db`
      insert into goals.commitments (user_id, goal_id, name, cadence_kind, satisfaction)
      values (${personId}, ${goal.id}, ${commitmentName}, 'daily', 'tap')
    `;

    await page.goto("/");
    await expect(page.getByText(goalName, { exact: true })).toBeVisible();
    await expect(page.locator("button", { hasText: commitmentName })).toBeVisible();

    await page.goto(`/dia/${pastDay(1)}`);
    await expect(page.getByRole("link", { name: "volver a hoy" })).toBeVisible();
    await expect(page.getByText(goalName, { exact: true })).toHaveCount(0);
    await expect(page.locator("button", { hasText: commitmentName })).toHaveCount(0);
  } finally {
    await deleteGoal(db, personId, goal.id);
  }
});

test("a day before every goal this person holds says it asked for nothing, with no way to create one (RNP-07)", async ({
  person,
  browser,
  db,
}) => {
  const day = pastDay(LIMIT);
  const opened = pastDay(LIMIT - 2);
  const stamp = Date.now();
  const weekday = new Intl.DateTimeFormat("es", { weekday: "long", timeZone: "UTC" }).format(civilDateToDate(opened));
  const context = await browser.newContext({ storageState: person.sessionFile });
  try {
    // Opened after `day`, so the day before it draws the line naming it.
    await db`
      insert into goals.goals (user_id, name, horizon, created_at)
      values (${person.id}, ${`Tardía ${stamp}`}, ${pastDay(-60)}, ${new Date(`${opened}T17:00:00Z`)})
    `;
    const page = await context.newPage();
    await page.goto(`/dia/${day}`);
    await expect(page.getByText("Ese día no pedía nada")).toBeVisible();
    await expect(page.getByRole("link", { name: "Abrir una meta" })).toHaveCount(0);
    await expect(page.getByText(/hechos \d+ de \d+/)).toHaveCount(0);
    await expect(page.getByText(`tardía ${stamp} empezó el ${weekday} ${civilDateToDate(opened).getUTCDate()}`)).toBeVisible();

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(360);
  } finally {
    await context.close();
    await db`delete from goals.goals where user_id = ${person.id}`;
  }
});

test("the seventh day back draws why there is no step further, the sixth draws the step (RP-06)", async ({
  page,
}) => {
  const reason = "Siete días atrás es lo más lejos que se anota.";

  await page.goto(`/dia/${pastDay(LIMIT)}`);
  await expect(page.getByText(reason)).toBeVisible();
  await expect(page.getByRole("link", { name: "Ver el día anterior" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);

  await page.goto(`/dia/${pastDay(LIMIT - 1)}`);
  await expect(page.getByRole("link", { name: "Ver el día anterior" })).toBeVisible();
  await expect(page.getByText(reason)).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});

// Asserted by the not-found's heading, never by its status (`docs/TRAPS.md`):
// an error boundary would draw no day either.
for (const [label, fecha] of [
  ["tomorrow", pastDay(-1)],
  ["a word", "banana"],
  ["a day that does not exist", "2026-02-31"],
  ["the eighth day back", pastDay(LIMIT + 1)],
] as const) {
  test(`/dia/<${label}> draws no day (RP-06)`, async ({ page }) => {
    await page.goto(`/dia/${fecha}`);
    await expect(page.getByRole("heading", { name: "Esta página no existe" })).toBeVisible();
    await expect(page.getByText(/hechos \d+ de \d+/)).toHaveCount(0);
    await expect(page.getByRole("link", { name: "volver a hoy" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Ver (ayer|el día anterior)/ })).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe(`/dia/${fecha}`);
  });
}

test("/dia/<today> is Hoy itself (RP-06)", async ({ page }) => {
  await page.goto(`/dia/${todayInZone()}`);
  await page.waitForURL((url) => url.pathname === "/");
  await expect(page.getByRole("link", { name: "Ver ayer" })).toBeVisible();
});
