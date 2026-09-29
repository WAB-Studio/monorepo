import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import type { Locator } from "@playwright/test";
import type postgres from "postgres";

import { test, expect, laneNumber, seededPerson } from "./fixtures";
import { civilDateToDate, dateToCivilDate, todayInZone } from "@/lib/zone";

// Hoy at 1024 and beyond (`HoyEscritorio.dc.html`, RNP-11): the goals left, the
// week's figure, the sueltas, «N esperan» and «hechas hoy» right; at 360 the
// order is the phone's own. «N esperan» counts dayless plus scheduled (RP-21).

function plusDays(days: number): string {
  const date = civilDateToDate(todayInZone());
  date.setUTCDate(date.getUTCDate() + days);
  return dateToCivilDate(date);
}

// A person of this spec's own: the counts span the identity, so only a fresh
// one can promise them. Registered under the suite's run, whose teardown drops it.
function mintDisposablePerson(lane: number, baseUrl: string): { id: string; sessionFile: string } {
  execFileSync(
    process.execPath,
    ["--import", "tsx", "--env-file=.env.local", "scripts/harness/mint-session.ts"],
    { env: { ...process.env, HARNESS_LANE: String(lane), PULSAR_BASE_URL: baseUrl }, stdio: "pipe" },
  );
  const sessionFile = resolve(process.cwd(), `private/session-${lane}.json`);
  const previous = process.env.HARNESS_LANE;
  process.env.HARNESS_LANE = String(lane);
  try {
    return { id: seededPerson().id, sessionFile };
  } finally {
    if (previous === undefined) delete process.env.HARNESS_LANE;
    else process.env.HARNESS_LANE = previous;
  }
}

async function box(locator: Locator) {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error("no box");
  return rect;
}

async function seedGoals(db: postgres.Sql, personId: string, stamp: number) {
  const [measured] = await db<{ id: string }[]>`
    insert into goals.goals (user_id, name, horizon, measure_name, measure_unit)
    values (${personId}, ${`Meta con cifra ${stamp}`}, ${plusDays(90)}, ${`minutos hablados ${stamp}`}, 'min')
    returning id
  `;
  const [plain] = await db<{ id: string }[]>`
    insert into goals.goals (user_id, name, horizon)
    values (${personId}, ${`Meta sin cifra ${stamp}`}, ${plusDays(90)}) returning id
  `;
  const [commitment] = await db<{ id: string }[]>`
    insert into goals.commitments
      (user_id, goal_id, name, cadence_kind, satisfaction, target_quantity, unit)
    values (${personId}, ${measured.id}, ${`Hablar ${stamp}`}, 'daily', 'quantity', 5, 'min')
    returning id
  `;
  await db`
    insert into goals.commitments (user_id, goal_id, name, cadence_kind, satisfaction)
    values (${personId}, ${plain.id}, ${`Tocar ${stamp}`}, 'daily', 'tap')
  `;
  await db`
    insert into goals.facts (user_id, commitment_id, goal_id, day, quantity)
    values (${personId}, ${commitment.id}, ${measured.id}, ${todayInZone()}, 12)
  `;
  return { measuredId: measured.id, plainId: plain.id };
}

test("at 1280 the goals sit left and the figure, sueltas, «N esperan» and «hechas hoy» right, with no overlap, one theme toggle and the figure of the review's current week (RNP-11, RP-26)", async ({
  browser,
  baseURL,
  db,
}) => {
  const person = mintDisposablePerson(9850 + laneNumber(), baseURL ?? "http://localhost:3200");
  const context = await browser.newContext({ storageState: person.sessionFile });
  const stamp = Date.now();
  const { measuredId } = await seedGoals(db, person.id, stamp);
  const doneName = `Hecha ${stamp}`;
  const [done] = await db<{ id: string }[]>`
    insert into goals.one_offs (user_id, name, day) values (${person.id}, ${doneName}, ${todayInZone()}) returning id
  `;
  await db`
    insert into goals.facts (user_id, one_off_id, day) values (${person.id}, ${done.id}, ${todayInZone()})
  `;
  await db`insert into goals.one_offs (user_id, name, day) values (${person.id}, ${`Sin día ${stamp}`}, null)`;
  await db`insert into goals.one_offs (user_id, name, day) values (${person.id}, ${`Para luego ${stamp}`}, ${plusDays(3)})`;

  try {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/metas/${measuredId}/revision`);
    const current = await page.locator("li[data-current]").innerText();
    const revisionNumber = current.match(/(\d+)\s*min\s*en curso/)?.[1];
    expect(revisionNumber).toBe("12");

    await page.goto("/");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);

    const goalLeft = await box(page.getByText(`Meta con cifra ${stamp}`, { exact: true }));
    const goalPlain = await box(page.getByText(`Meta sin cifra ${stamp}`, { exact: true }));
    const label = page.getByText(`minutos hablados ${stamp}`, { exact: true });
    const figure = await box(label);
    const sueltas = await box(page.getByText("Sueltas", { exact: true }));
    const waiting = await box(page.getByRole("link", { name: "2 esperan" }));
    const doneLabel = await box(page.getByText("Hechas hoy", { exact: true }));

    // The figure card carries the number the review's current week reads.
    const card = page.locator("section, div").filter({ has: label }).last();
    await expect(card).toContainText(`${revisionNumber}`);
    await expect(card).toContainText("esta semana");
    await expect(card.getByRole("link", { name: "Ver por semana" })).toHaveAttribute(
      "href",
      `/metas/${measuredId}/revision`,
    );

    // Goals in one left column, the rest in the right one, top to bottom.
    expect(goalLeft.x + goalLeft.width).toBeLessThan(figure.x);
    expect(goalPlain.x + goalPlain.width).toBeLessThan(figure.x);
    expect(figure.y).toBeLessThan(sueltas.y);
    expect(sueltas.y).toBeLessThan(doneLabel.y);
    expect(waiting.x).toBeGreaterThan(goalLeft.x + goalLeft.width);
    expect(waiting.y).toBeGreaterThan(figure.y);
    expect(waiting.y).toBeLessThan(doneLabel.y);

    // A goal with no measure draws no card of its own.
    await expect(page.getByText("esta semana", { exact: true })).toHaveCount(1);
    await expect(page.getByRole("button", { name: /Cambiar a modo/ })).toHaveCount(1);
  } finally {
    await context.close();
    await db`delete from goals.goals where user_id = ${person.id}`;
    await db`delete from goals.one_offs where user_id = ${person.id}`;
  }
});

test("at 360 the sections come in the phone's own order and the figure is not drawn (RNP-07)", async ({
  browser,
  baseURL,
  db,
}) => {
  const person = mintDisposablePerson(9850 + laneNumber(), baseURL ?? "http://localhost:3200");
  const context = await browser.newContext({ storageState: person.sessionFile });
  const stamp = Date.now();
  await seedGoals(db, person.id, stamp);
  const doneName = `Hecha ${stamp}`;
  const [done] = await db<{ id: string }[]>`
    insert into goals.one_offs (user_id, name, day) values (${person.id}, ${doneName}, ${todayInZone()}) returning id
  `;
  await db`
    insert into goals.facts (user_id, one_off_id, day) values (${person.id}, ${done.id}, ${todayInZone()})
  `;

  try {
    const page = await context.newPage();
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);

    const order = await page.locator("main section").evaluateAll((sections) =>
      sections
        .map((section) => {
          const rect = section.getBoundingClientRect();
          return { text: section.textContent ?? "", x: rect.x, width: rect.width };
        })
        .filter((entry) => entry.width > 0),
    );
    expect(order.map((entry) => entry.text.slice(0, 7))).toEqual([
      "Meta co",
      "Meta si",
      "Sueltas",
      "Hechas ",
    ]);
    // Every section is the page's own column, the width a phone gives it.
    for (const entry of order) expect(entry.width).toBeCloseTo(order[0].width, 0);

    await expect(page.getByText("esta semana", { exact: true })).toBeHidden();
    await expect(page.getByRole("button", { name: /Cambiar a modo/ })).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Ver por semana" })).toBeHidden();
  } finally {
    await context.close();
    await db`delete from goals.goals where user_id = ${person.id}`;
    await db`delete from goals.one_offs where user_id = ${person.id}`;
  }
});

test("«N esperan» is dayless plus scheduled at the same moment, and opens /sueltas (RP-21)", async ({
  browser,
  baseURL,
  db,
}) => {
  const person = mintDisposablePerson(9850 + laneNumber(), baseURL ?? "http://localhost:3200");
  const context = await browser.newContext({ storageState: person.sessionFile });
  const stamp = Date.now();
  await db`insert into goals.one_offs (user_id, name, day) values (${person.id}, ${`Sin día ${stamp}`}, null)`;

  try {
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByRole("link", { name: "1 espera" })).toBeVisible();

    await db`insert into goals.one_offs (user_id, name, day) values (${person.id}, ${`Para luego ${stamp}`}, ${plusDays(4)})`;
    await db`insert into goals.one_offs (user_id, name, day) values (${person.id}, ${`Para más luego ${stamp}`}, ${plusDays(9)})`;
    const [counts] = await db<{ n: string }[]>`
      select count(*)::text as n from goals.one_offs o
      where o.user_id = ${person.id}
        and (o.day is null or o.day > ${todayInZone()})
        and not exists (select 1 from goals.facts f where f.one_off_id = o.id)
    `;
    expect(counts.n).toBe("3");

    await page.reload();
    const link = page.getByRole("link", { name: `${counts.n} esperan` });
    await expect(link).toBeVisible();
    await link.click();
    await page.waitForURL("**/sueltas");
  } finally {
    await context.close();
    await db`delete from goals.one_offs where user_id = ${person.id}`;
  }
});

test("a one-off done at a known instant reads its HH:mm in «hechas hoy» (RP-19)", async ({ browser, baseURL, db }) => {
  const person = mintDisposablePerson(9850 + laneNumber(), baseURL ?? "http://localhost:3200");
  const context = await browser.newContext({ storageState: person.sessionFile });
  const name = `Hecha con hora ${Date.now()}`;
  const [done] = await db<{ id: string }[]>`
    insert into goals.one_offs (user_id, name, day) values (${person.id}, ${name}, ${todayInZone()}) returning id
  `;
  // Bogotá holds UTC-5 the whole year.
  await db`
    insert into goals.facts (user_id, one_off_id, day, written_at)
    values (${person.id}, ${done.id}, ${todayInZone()}, ${new Date(`${todayInZone()}T19:40:00-05:00`)})
  `;

  try {
    const page = await context.newPage();
    await page.goto("/");
    const row = page.getByRole("button", { name: `Deshacer: ${name}` });
    await expect(row).toBeVisible();
    await expect(row).toContainText("19:40");
  } finally {
    await context.close();
    await db`delete from goals.one_offs where user_id = ${person.id}`;
  }
});
