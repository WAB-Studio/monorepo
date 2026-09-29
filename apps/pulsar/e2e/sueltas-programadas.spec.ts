import type postgres from "postgres";

import { test, expect } from "./fixtures";
import { civilDateToDate, dateToCivilDate, todayInZone } from "@/lib/zone";

// `/sueltas` holds the one-offs dated after today under «programadas»: each
// is moved, done or deleted from there, and a done one says where it went
// (`SueltasProgramadas.dc.html`, `SueltaMover.dc.html`; RP-21, RP-22, RNP-07).

function plusDays(days: number): string {
  const date = civilDateToDate(todayInZone());
  date.setUTCDate(date.getUTCDate() + days);
  return dateToCivilDate(date);
}

async function seed(
  db: postgres.Sql,
  personId: string,
  name: string,
  day: string | null,
  goalId?: string,
): Promise<string> {
  const [row] = await db<{ id: string }[]>`
    insert into goals.one_offs (user_id, name, day, goal_id)
    values (${personId}, ${name}, ${day}, ${goalId ?? null}) returning id
  `;
  return row.id;
}

const WEEKDAYS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

function words(day: string): string {
  const date = civilDateToDate(day);
  return `${WEEKDAYS[(date.getUTCDay() + 6) % 7]} ${date.getUTCDate()}`;
}

test("a one-off for tomorrow is listed under «programadas» with tomorrow's words, its goal as written (RP-21, RNP-07)", async ({
  page,
  db,
  personId,
}) => {
  const stamp = Date.now();
  const name = `Programada de mañana ${stamp}`;
  const goalName = `Inglés ${stamp}`;
  const [goal] = await db<{ id: string }[]>`
    insert into goals.goals (user_id, name, horizon)
    values (${personId}, ${goalName}, ${plusDays(90)}) returning id
  `;
  const oneOffId = await seed(db, personId, name, plusDays(1), goal.id);

  try {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/sueltas");

    await expect(page.getByRole("heading", { name: "Lo que espera" }).or(page.getByText("Lo que espera"))).toBeVisible();
    await expect(page.getByText(/programadas?$/)).toBeVisible();
    const row = page.getByRole("button", { name: new RegExp(`^${name}`) });
    await expect(row).toContainText(`${words(plusDays(1))}`);
    await expect(row).toContainText(`de ${goalName}`);
    await expect(page.getByRole("navigation").getByRole("link", { name: "Hoy" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  } finally {
    await db`delete from goals.one_offs where id = ${oneOffId}`;
    await db`delete from goals.goals where id = ${goal.id} and user_id = ${personId}`;
  }
});

test("moved to today it leaves the list and draws on Hoy; moved to another day it reads the new one (RP-21)", async ({
  page,
  db,
  personId,
}) => {
  const name = `Programada a mover ${Date.now()}`;
  const oneOffId = await seed(db, personId, name, plusDays(3));

  try {
    await page.goto("/sueltas");
    await page.getByRole("button", { name: new RegExp(`^${name}`) }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toContainText(`ahora: ${words(plusDays(3))}`);
    await expect(sheet.getByRole("radio", { name: "sin día" })).toHaveCount(0);

    await sheet.getByRole("radio", { name: "otro día" }).click();
    await sheet.getByLabel("qué día").fill(plusDays(5));
    await sheet.getByRole("button", { name: "Moverla" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: new RegExp(`^${name}`) })).toContainText(
      words(plusDays(5)),
    );

    await page.getByRole("button", { name: new RegExp(`^${name}`) }).click();
    await page.getByRole("dialog").getByRole("radio", { name: "hoy" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Moverla" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: new RegExp(`^${name}`) })).toHaveCount(0);

    await page.goto("/");
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  } finally {
    await db`delete from goals.one_offs where id = ${oneOffId}`;
  }
});

test("a past day is refused in the move sheet and the one-off stays where it was (RP-21)", async ({
  page,
  db,
  personId,
}) => {
  const name = `Programada sin pasado ${Date.now()}`;
  const oneOffId = await seed(db, personId, name, plusDays(2));

  try {
    await page.goto("/sueltas");
    await page.getByRole("button", { name: new RegExp(`^${name}`) }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByLabel("qué día").fill(plusDays(-1));
    await sheet.getByRole("button", { name: "Moverla" }).click();

    await expect(sheet).toContainText("Ese día ya pasó");
    const [row] = await db<{ day: string }[]>`select day::text as day from goals.one_offs where id = ${oneOffId}`;
    expect(row.day).toBe(plusDays(2));
    await sheet.getByRole("button", { name: "Dejarla como está" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  } finally {
    await db`delete from goals.one_offs where id = ${oneOffId}`;
  }
});

test("done from the list it leaves, the status line survives and Hoy holds it in «hechas hoy» (RP-21, RP-19)", async ({
  page,
  db,
  personId,
}) => {
  const name = `Programada hecha ${Date.now()}`;
  const oneOffId = await seed(db, personId, name, plusDays(2));

  try {
    await page.goto("/sueltas");
    await page.getByRole("button", { name: `Dar por hecha: ${name}` }).click();

    await expect(page.getByRole("button", { name: new RegExp(`^${name}`) })).toHaveCount(0);
    const status = page.getByRole("status");
    await expect(status).toContainText(`«${name}» quedó en «hechas hoy».`);
    await status.getByRole("link", { name: "ver hoy" }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("button", { name: `Deshacer: ${name}` })).toBeVisible();
  } finally {
    await db`delete from goals.one_offs where id = ${oneOffId}`;
  }
});

test("a dayless one done from the list shows the same line (RP-21)", async ({ page, db, personId }) => {
  const name = `Suelta hecha con línea ${Date.now()}`;
  const oneOffId = await seed(db, personId, name, null);

  try {
    await page.goto("/sueltas");
    await page.getByRole("button", { name: `Dar por hecha: ${name}` }).click();
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
    await expect(page.getByRole("status")).toContainText(`«${name}» quedó en «hechas hoy».`);
  } finally {
    await db`delete from goals.one_offs where id = ${oneOffId}`;
  }
});

test("deleted from the move sheet its row is gone from the database (RP-22)", async ({
  page,
  db,
  personId,
}) => {
  const name = `Programada a borrar ${Date.now()}`;
  const oneOffId = await seed(db, personId, name, plusDays(4));

  try {
    await page.goto("/sueltas");
    await page.getByRole("button", { name: new RegExp(`^${name}`) }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Borrarla" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toContainText("¿Borrarla?");
    await sheet.getByRole("button", { name: "Borrarla" }).click();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: new RegExp(`^${name}`) })).toHaveCount(0);
    const rows = await db`select id from goals.one_offs where id = ${oneOffId}`;
    expect(rows).toHaveLength(0);
  } finally {
    await db`delete from goals.one_offs where id = ${oneOffId}`;
  }
});
