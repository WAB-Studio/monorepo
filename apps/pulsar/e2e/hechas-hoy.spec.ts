import type postgres from "postgres";

import { test, expect } from "./fixtures";
import { todayInZone } from "@/lib/zone";

// «Hechas hoy» (`HoyHechas.dc.html`): a one-off done today stays on Hoy with a
// filled mark, and the mark takes the fact back (RP-19, RP-05).

async function seedOneOff(db: postgres.Sql, personId: string, name: string): Promise<string> {
  const [row] = await db<{ id: string }[]>`
    insert into goals.one_offs (user_id, name, day)
    values (${personId}, ${name}, ${todayInZone()}) returning id
  `;
  return row.id;
}

async function factCount(db: postgres.Sql, oneOffId: string): Promise<number> {
  const rows = await db`select id from goals.facts where one_off_id = ${oneOffId}`;
  return rows.length;
}

test("a completed one-off moves to «hechas hoy» with a filled mark, survives a reload, and a second tap puts it back and deletes its fact (RP-19, RP-05)", async ({
  page,
  db,
  personId,
}) => {
  const name = `Suelta hecha ${Date.now()}`;
  const oneOffId = await seedOneOff(db, personId, name);

  try {
    await page.goto("/");
    await expect(page.getByText("Hechas hoy")).toHaveCount(0);
    await page.getByRole("button", { name: "Marcar como hecho" }).last().click();
    await expect(page.getByRole("button", { name: `Deshacer: ${name}` })).toBeVisible();
    await expect(page.getByText("Hechas hoy")).toBeVisible();
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(1);
    expect(await factCount(db, oneOffId)).toBe(1);

    await page.reload();
    const undo = page.getByRole("button", { name: `Deshacer: ${name}` });
    await expect(undo).toBeVisible();
    await expect(undo.locator("svg")).toBeVisible();

    await undo.click();
    await expect(page.getByRole("button", { name: `Deshacer: ${name}` })).toHaveCount(0);
    await expect(page.getByText("Hechas hoy")).toHaveCount(0);
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
    await expect.poll(() => factCount(db, oneOffId)).toBe(0);
  } finally {
    await db`delete from goals.one_offs where id = ${oneOffId}`;
  }
});

test("the name of a done one-off opens nothing, and the screen holds at 360px (RP-22, RNP-07)", async ({
  page,
  db,
  personId,
}) => {
  const name = `Suelta hecha sin hoja ${Date.now()}`;
  const oneOffId = await seedOneOff(db, personId, name);

  try {
    await page.goto("/");
    await page.getByRole("button", { name: "Marcar como hecho" }).last().click();
    await expect(page.getByRole("button", { name: `Deshacer: ${name}` })).toBeVisible();

    await page.getByText(name, { exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await factCount(db, oneOffId)).toBe(1);

    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  } finally {
    await db`delete from goals.one_offs where id = ${oneOffId}`;
  }
});
