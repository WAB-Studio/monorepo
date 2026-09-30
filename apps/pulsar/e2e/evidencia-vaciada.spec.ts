import { randomUUID } from "node:crypto";

import { test, expect } from "./fixtures";
import { civilDateToDate, dateToCivilDate, todayInZone } from "../lib/zone";

// `Semana.dc.html`'s own weekday order, read back here rather than imported.
const WEEKDAY_SHORT = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

function weekRowLabel(civilDay: string): string {
  const weekdayIndex = (new Date(`${civilDay}T12:00:00Z`).getUTCDay() + 6) % 7;
  return `${WEEKDAY_SHORT[weekdayIndex]} ${Number(civilDay.slice(8, 10))}`;
}

test("emptying the reading record empties the evidence mark on Hoy and on Semana, and writes no fact (RP-10, RP-09)", async ({
  person,
  browser,
  baseURL,
  db,
}) => {
  const stamp = Date.now();
  const goalName = `Meta vaciada ${stamp}`;
  const commitmentName = `Compromiso vaciado ${stamp}`;
  const today = todayInZone();
  const deviceId = randomUUID();
  // 23:30 Bogotá is 04:30 UTC the next day: the row is today's only through the zone.
  const at = new Date(`${today}T23:30:00-05:00`);

  const horizonDate = civilDateToDate(today);
  horizonDate.setUTCDate(horizonDate.getUTCDate() + 90);
  const [goal] = await db<{ id: string }[]>`
    insert into goals.goals (user_id, name, horizon, created_at)
    values (${person.id}, ${goalName}, ${dateToCivilDate(horizonDate)}, now() - interval '20 days')
    returning id
  `;
  const [commitment] = await db<{ id: string }[]>`
    insert into goals.commitments
      (user_id, goal_id, name, cadence_kind, satisfaction, source_id, threshold, created_at)
    values (
      ${person.id}, ${goal.id}, ${commitmentName}, 'daily', 'evidence',
      (select id from goals.evidence_sources where key = 'reading_lookups'), 1,
      now() - interval '20 days'
    )
    returning id
  `;
  const facts = async () => {
    const [row] = await db<{ count: number }[]>`
      select count(*)::int as count from goals.facts where commitment_id = ${commitment.id}
    `;
    return row.count;
  };

  const context = await browser.newContext({ storageState: person.sessionFile, baseURL: baseURL! });
  try {
    await db`insert into reading.lookups
      (user_id, device_id, local_id, at, text, normalised, kind, outcome, headword, rule, senses, translation, dictionary_ready, origin, record_schema)
      values (${person.id}, ${deviceId}, 1, ${at}, 'evidencia', 'evidencia', 'word', 'miss', null, null, 0, null, true, null, 2)`;

    const page = await context.newPage();
    const row = page.locator("button", { hasText: commitmentName });
    const dot = page
      .locator("section", { hasText: goalName })
      .locator("button", { hasText: weekRowLabel(today) })
      .locator(`[role="img"][aria-label^="${commitmentName}"]`);

    await page.goto("/");
    await expect(page.locator("main")).toHaveCount(1);
    await expect(row.locator("[data-state]")).toHaveAttribute("data-state", "evidence");
    await expect(row).toContainText("diccionario");
    await page.goto("/semana");
    await expect(page.locator("main")).toHaveCount(1);
    await expect(dot).toHaveAttribute("data-state", "evidence");
    expect(await facts()).toBe(0);

    // Voyager's own clear (`app/api/log/clear/route.ts`), scoped to this person.
    await db`delete from reading.lookups where user_id = ${person.id}`;

    await page.goto("/");
    await expect(page.locator("main")).toHaveCount(1);
    await expect(row.locator("[data-state]")).toHaveAttribute("data-state", "empty");
    await expect(row).not.toContainText("diccionario");
    await page.goto("/semana");
    await expect(page.locator("main")).toHaveCount(1);
    await expect(dot).toHaveCount(1);
    await expect(dot).not.toHaveAttribute("data-state", "evidence");
    expect(await facts()).toBe(0);
  } finally {
    await context.close();
    await db`delete from reading.lookups where user_id = ${person.id} and device_id = ${deviceId}`;
    await db`delete from goals.goals where id = ${goal.id} and user_id = ${person.id}`;
  }
});
