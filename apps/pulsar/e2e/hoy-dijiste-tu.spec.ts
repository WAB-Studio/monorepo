import { test, expect } from "./fixtures";
import { civilDateToDate, dateToCivilDate, todayInZone } from "@/lib/zone";

// What a row says about who wrote it (`HoyEscritorio.dc.html`, module 100):
// a marked one says «lo dijiste tú» after its hour, an unmarked quantity one
// says «pide el número» after its target, an unmarked tap row says neither.

test("Hoy says «lo dijiste tú» on a marked row and «pide el número» on an unmarked quantity row", async ({
  person,
  browser,
  db,
}) => {
  const context = await browser.newContext({ storageState: person.sessionFile });
  const today = todayInZone();
  const ahead = civilDateToDate(today);
  ahead.setUTCDate(ahead.getUTCDate() + 90);
  const horizon = dateToCivilDate(ahead);
  const [goal] = await db<{ id: string }[]>`
    insert into goals.goals (user_id, name, horizon, created_at)
    values (${person.id}, 'Dijiste', ${horizon}, now() - interval '20 days')
    returning id
  `;
  const insertCommitment = async (name: string, satisfaction: string, target: number | null, unit: string | null) => {
    const [row] = await db<{ id: string }[]>`
      insert into goals.commitments (user_id, goal_id, name, cadence_kind, satisfaction, target_quantity, unit, created_at)
      values (${person.id}, ${goal.id}, ${name}, 'daily', ${satisfaction}, ${target}, ${unit}, now() - interval '20 days')
      returning id
    `;
    return row.id;
  };
  const marked = await insertCommitment("Marcada", "tap", null, null);
  const counted = await insertCommitment("Contada", "quantity", 10, "minutos");
  await insertCommitment("Sin marcar", "tap", null, null);
  await insertCommitment("Sin número", "quantity", 3, "min");
  for (const [id, quantity] of [[marked, null], [counted, 10]] as const) {
    await db`
      insert into goals.facts (user_id, commitment_id, goal_id, day, quantity, written_at)
      values (${person.id}, ${id}, ${goal.id}, ${today}, ${quantity}, ${`${today}T07:40:00-05:00`})
    `;
  }

  try {
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.getByText("Marcada", { exact: true })).toBeVisible();

    await expect(page.getByText("07:40 · lo dijiste tú", { exact: true })).toBeVisible();
    await expect(page.getByText("10 minutos · 07:40 · lo dijiste tú", { exact: true })).toBeVisible();
    await expect(page.getByText("3 min · pide el número", { exact: true })).toBeVisible();
    // Only the unmarked quantity row asks for a number.
    await expect(page.getByText("pide el número")).toHaveCount(1);
    await expect(page.getByText("lo dijiste tú")).toHaveCount(2);
  } finally {
    await context.close();
    await db`delete from goals.goals where id = ${goal.id} and user_id = ${person.id}`;
  }
});
