
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

// A person of this spec's own: the lane's shared one may hold other specs'
// rows, so only a fresh identity can promise that nothing else waits. Minted
// at a disposable lane (offset from `fases.spec.ts` and `varias-metas.spec.ts`)
// and registered under the suite's run, whose teardown drops it.
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
    await expect(page.getByText(`de ${goalName}`)).toBeVisible();
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
    await page.getByRole("dialog").getByRole("button", { name: "Darle un día" }).click();
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
    await page.getByRole("dialog").getByRole("button", { name: "Darle un día" }).click();
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
  person,
  browser,
  db,
}) => {
  const name = `Suelta a borrar de la lista ${Date.now()}`;
  const oneOffId = await seedDayless(db, person.id, name);
  const context = await browser.newContext({ storageState: person.sessionFile });

  try {
    const page = await context.newPage();
    await page.goto("/sueltas");
    await page.getByRole("button", { name, exact: true }).click();
    await page.getByRole("button", { name: "Borrar la tarea" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toContainText("¿Borrarla?");
    await sheet.getByRole("button", { name: "Borrarla" }).click();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await rowOf(db, oneOffId)).toHaveLength(0);
    await expect(page.getByText("Nada espera, ni sin día ni para otro día.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Volver a hoy", exact: true })).toHaveAttribute("href", "/");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      page.viewportSize()?.width ?? 1280,
    );
  } finally {
    await context.close();
    await db`delete from goals.one_offs where id = ${oneOffId}`;
  }
});

for (const width of [360, 390, 1280, 1440]) {
  test(`the header is one h1 and a way back to Hoy, at ${width} (RP-21, RNP-16, RNP-17)`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 1024 ? 800 : 900 });
    await page.goto("/sueltas");

    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1, name: "Lo que espera" })).toBeVisible();
    await expect(page.getByRole("navigation").getByRole("link", { name: "Hoy" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

    await page.getByRole("link", { name: "Volver a Hoy", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
  });
}

// Module 311: the groups are `Section`s spaced by their parent (32, 40 from
// 1024), a goal's name is a sentence in Archivo while the day beside it stays
// a figure in mono, and «ver hoy» is the one accent link.
for (const [width, gap] of [
  [360, "32px"],
  [1280, "40px"],
] as const) {
  test(`the groups sit ${gap} apart, the goal's line is a sentence, its day a figure, «ver hoy» a link, at ${width} (RP-21, RNP-07)`, async ({
    page,
    db,
    personId,
  }) => {
    const stamp = Date.now();
    const goalName = `Meta de espaciado ${stamp}`;
    const waiting = `Suelta de espaciado ${stamp}`;
    const planned = `Programada de espaciado ${stamp}`;
    const [goal] = await db<{ id: string }[]>`
      insert into goals.goals (user_id, name, horizon)
      values (${personId}, ${goalName}, ${plusDays(90)}) returning id
    `;
    const waitingId = await seedDayless(db, personId, waiting, goal.id);
    const [scheduled] = await db<{ id: string }[]>`
      insert into goals.one_offs (user_id, name, day, goal_id)
      values (${personId}, ${planned}, ${plusDays(2)}, ${goal.id}) returning id
    `;

    try {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/sueltas");

      const sections = page.locator("main section");
      await expect.soft(sections).toHaveCount(2);
      expect.soft(await sections.first().evaluate((el) => getComputedStyle(el.parentElement!).rowGap)).toBe(gap);
      expect.soft(await sections.first().evaluate((el) => getComputedStyle(el).rowGap)).toBe("12px");

      const line = page.getByText(`de ${goalName}`).first();
      expect.soft(await line.evaluate((el) => getComputedStyle(el).fontFamily)).not.toMatch(/mono/i);
      const dayFigure = page.getByRole("button", { name: new RegExp(`^${planned}`) }).locator("span", {
        hasText: /^[a-záéíóú]+ \d+/,
      });
      expect.soft(await dayFigure.last().evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/mono/i);

      await page.getByRole("button", { name: `Dar por hecha: ${waiting}` }).click();
      const seeToday = page.getByRole("link", { name: "ver hoy" });
      await expect.soft(seeToday).toBeVisible();
      expect.soft(await seeToday.evaluate((el) => getComputedStyle(el).fontWeight)).toBe("500");
      await expect.soft(seeToday.locator("span")).toHaveCount(0);
    } finally {
      await db`delete from goals.one_offs where id in (${waitingId}, ${scheduled.id})`;
      await db`delete from goals.goals where id = ${goal.id} and user_id = ${personId}`;
    }
  });
}
