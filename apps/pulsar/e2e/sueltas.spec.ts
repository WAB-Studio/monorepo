import type postgres from "postgres";

import { test, expect } from "./fixtures";
import { civilDateToDate, dateToCivilDate, todayInZone } from "@/lib/zone";

// The one-offs with no day wait in `/sueltas` (`SueltasSinDia.dc.html`): each
// is done, given a day or deleted from there (RP-21, RNP-07).

function plusDays(days: number): string {
  const date = civilDateToDate(todayInZone());
  date.setUTCDate(date.getUTCDate() + days);
  return dateToCivilDate(date);
}

async function seedDayless(
  db: postgres.Sql,
  personId: string,
  name: string,
  goalId?: string,
): Promise<string> {
  const [row] = await db<{ id: string }[]>`
    insert into goals.one_offs (user_id, name, day, goal_id)
    values (${personId}, ${name}, null, ${goalId ?? null}) returning id
  `;
  return row.id;
}

async function rowOf(db: postgres.Sql, oneOffId: string) {
  return db<{ day: string | null }[]>`
    select day::text as day from goals.one_offs where id = ${oneOffId}
  `;
}

test("Hoy's link opens the list, which names the goal, marks Hoy's tab and holds at 360 (RP-21, RNP-07)", async ({
  page,
  db,
  personId,
}) => {
  const stamp = Date.now();
  const name = `Suelta sin día lista ${stamp}`;
  const goalName = `Meta De Sueltas ${stamp}`;
  const [goal] = await db<{ id: string }[]>`
    insert into goals.goals (user_id, name, horizon)
    values (${personId}, ${goalName}, ${plusDays(90)}) returning id
  `;
  const oneOffId = await seedDayless(db, personId, name, goal.id);

  try {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/");
    await page.getByRole("link", { name: /(espera|esperan)$/ }).click();
    await expect(page).toHaveURL(/\/sueltas$/);

    await expect(page.getByRole("button", { name: new RegExp(`^${name} de `) })).toBeVisible();
    await expect(page.getByText(`de ${goalName.toLocaleLowerCase("es")}`)).toBeVisible();
    await expect(page.getByRole("navigation").getByRole("link", { name: "Hoy" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);

    await page.getByRole("button", { name: new RegExp(`^${name} de `) }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  } finally {
    await db`delete from goals.one_offs where id = ${oneOffId}`;
    await db`delete from goals.goals where id = ${goal.id} and user_id = ${personId}`;
  }
});

test("given «hoy» it leaves the list and draws on Hoy (RP-21)", async ({ page, db, personId }) => {
  const name = `Suelta para hoy ${Date.now()}`;
  const oneOffId = await seedDayless(db, personId, name);

  try {
    await page.goto("/sueltas");
    await page.getByRole("button", { name, exact: true }).click();
    await page.getByRole("radio", { name: "hoy" }).click();
    await page.getByRole("button", { name: "Ponerle ese día" }).click();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
    expect(await rowOf(db, oneOffId)).toMatchObject([{ day: todayInZone() }]);

    await page.goto("/");
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  } finally {
    await db`delete from goals.one_offs where id = ${oneOffId}`;
  }
});

test("given «mañana» it leaves the list and does not draw on Hoy (RP-21)", async ({
  page,
  db,
  personId,
}) => {
  const name = `Suelta para mañana ${Date.now()}`;
  const oneOffId = await seedDayless(db, personId, name);

  try {
    await page.goto("/sueltas");
    await page.getByRole("button", { name, exact: true }).click();
    await page.getByRole("radio", { name: "mañana" }).click();
    await page.getByRole("button", { name: "Ponerle ese día" }).click();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
    expect(await rowOf(db, oneOffId)).toMatchObject([{ day: plusDays(1) }]);

    await page.goto("/");
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
  } finally {
    await db`delete from goals.one_offs where id = ${oneOffId}`;
  }
});

test("completed from the list it lands in «hechas hoy» (RP-21, RP-19)", async ({ page, db, personId }) => {
  const name = `Suelta hecha desde la lista ${Date.now()}`;
  const oneOffId = await seedDayless(db, personId, name);

  try {
    await page.goto("/sueltas");
    await page.getByRole("button", { name: `Dar por hecha: ${name}` }).click();
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);

    await page.goto("/");
    await expect(page.getByText("Hechas hoy")).toBeVisible();
    await expect(page.getByRole("button", { name: `Deshacer: ${name}` })).toBeVisible();
  } finally {
    await db`delete from goals.one_offs where id = ${oneOffId}`;
  }
});

test("deleted from the sheet its row is gone from the database, and the last one draws the empty state (RP-22)", async ({
  page,
  db,
  personId,
}) => {
  const name = `Suelta a borrar de la lista ${Date.now()}`;
  const oneOffId = await seedDayless(db, personId, name);

  try {
    await page.goto("/sueltas");
    await page.getByRole("button", { name, exact: true }).click();
    await page.getByRole("button", { name: "Borrarla" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toContainText("¿Borrarla?");
    await sheet.getByRole("button", { name: "Borrarla" }).click();

    await expect(page.getByText("Nada espera sin día.")).toBeVisible();
    await expect(page.getByRole("link", { name: "volver a hoy" })).toHaveAttribute("href", "/");
    expect(await rowOf(db, oneOffId)).toHaveLength(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      page.viewportSize()?.width ?? 1280,
    );
  } finally {
    await db`delete from goals.one_offs where id = ${oneOffId}`;
  }
});
