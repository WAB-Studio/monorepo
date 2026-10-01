import { test, expect } from "./fixtures";
import { dayBefore } from "@/lib/day/weeks";
import { monthOf, nextMonth } from "@/lib/plan/months";
import { todayInZone } from "@/lib/zone";

// `Mes`, `MesArrastre`, `MesVacio`, `MesCerrado`, `MesCorrer` (module 139,
// RP-30, RP-31, RP-32, RP-34): one month of a goal, its carried tasks first,
// and the shift a closed month offers. Calendar-bound as 135: the seeded
// «last month» is always the month before today, so the proposal's window is
// always open.

const NAMES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

function label(month: string): string {
  return NAMES[Number(month.slice(5, 7)) - 1];
}

const thisMonth = monthOf(todayInZone());
const lastMonth = monthOf(dayBefore(thisMonth));
const twoBack = monthOf(dayBefore(lastMonth));
const following = nextMonth(thisMonth);
const horizon = nextMonth(following);
const seg = (month: string) => month.slice(0, 7);

type Db = import("postgres").Sql;

async function seedGoal(db: Db, personId: string, name: string, openedIn = lastMonth) {
  const [goal] = await db<{ id: string }[]>`
    insert into goals.goals (user_id, name, horizon, measure_name, measure_unit, created_at)
    values (${personId}, ${name}, ${horizon}::date, 'minutos', 'minutos', (${openedIn}::date + 14) + time '12:00' at time zone 'UTC')
    returning id
  `;
  return goal.id;
}

async function seedBudget(db: Db, personId: string, goalId: string, month: string, amount: number) {
  await db`
    insert into goals.month_budgets (user_id, goal_id, month, amount)
    values (${personId}, ${goalId}, ${month}::date, ${amount})
  `;
}

async function seedTask(
  db: Db,
  personId: string,
  goalId: string,
  name: string,
  month: string | null,
  estimate: number | null,
  parentId: string | null = null,
  doneOn: string | null = null,
) {
  const [task] = await db<{ id: string }[]>`
    insert into goals.one_offs (user_id, goal_id, name, planned_month, estimate, parent_id)
    values (${personId}, ${goalId}, ${name}, ${month === null ? null : db`${month}::date`}, ${estimate}, ${parentId})
    returning id
  `;
  if (doneOn !== null) {
    await db`
      insert into goals.facts (user_id, goal_id, one_off_id, day)
      values (${personId}, ${goalId}, ${task.id}, ${doneOn}::date)
    `;
  }
  return task.id;
}

test("this month lists the carried parent first, then its own task; marking the child done keeps the parent on the list as done; last month shows its share and adds nothing; a month outside the span is not found (RP-30, RP-31, RP-32)", async ({
  person,
  browser,
  baseURL,
  db,
}) => {
  const stamp = Date.now();
  const goalId = await seedGoal(db, person.id, `Meta mes ${stamp}`);
  await seedBudget(db, person.id, goalId, lastMonth, 720);
  await seedBudget(db, person.id, goalId, thisMonth, 720);
  const parent = await seedTask(db, person.id, goalId, `Padre ${stamp}`, lastMonth, null);
  await seedTask(db, person.id, goalId, `Hijo hecho ${stamp}`, null, 60, parent, `${lastMonth.slice(0, 8)}15`);
  await seedTask(db, person.id, goalId, `Hijo pendiente ${stamp}`, null, 180, parent);
  await seedTask(db, person.id, goalId, `Propia ${stamp}`, thisMonth, 120);

  const context = await browser.newContext({ storageState: person.sessionFile, baseURL: baseURL! });
  try {
    const page = await context.newPage();
    await page.setViewportSize({ width: 360, height: 740 });

    await page.goto(`/metas/${goalId}/meses/${seg(thisMonth)}`);
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.getByText(`meta mes ${stamp}`, { exact: true })).toBeVisible();
    const title = label(thisMonth).charAt(0).toUpperCase() + label(thisMonth).slice(1);
    await expect(page.getByText(title, { exact: true })).toBeVisible();
    await expect(page.getByText("este mes", { exact: true })).toBeVisible();
    await expect(page.getByText("de 12 h", { exact: true })).toBeVisible();

    // Carried first: its section precedes the month's own, and the parent
    // reads what it still owes.
    const carriedSection = page.getByText(`de ${label(lastMonth)}`, { exact: true });
    const ownSection = page.getByText(/^de .* · 2 h$/);
    await expect(carriedSection).toBeVisible();
    await expect(ownSection).toBeVisible();
    const carriedBox = await carriedSection.boundingBox();
    const ownBox = await ownSection.boundingBox();
    expect(carriedBox!.y).toBeLessThan(ownBox!.y);
    const parentRow = page.locator("[data-done]");
    await expect(parentRow).toHaveCount(1);
    await expect(parentRow).toContainText(`Padre ${stamp}`);
    await expect(parentRow).toContainText(`de ${label(lastMonth)} · debe 3 h`);
    await expect(parentRow).toHaveAttribute("data-done", "false");
    // The parent has no mark of its own: only the leaves do.
    await expect(parentRow.locator("[data-state]")).toHaveCount(0);
    // Two children and the own task, plus the dashed mark of the add link.
    await expect(page.locator("[data-state]")).toHaveCount(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);

    const add = page.getByRole("link", { name: `Otra tarea de ${label(thisMonth)}` });
    await expect(add).toHaveAttribute("href", `/metas/${goalId}/meses/${seg(thisMonth)}/tarea/nueva`);

    // The first undone mark is the pending child's: carried rows lead.
    await page.getByRole("button", { name: "Marcar como hecho" }).first().click();
    await expect(parentRow).toHaveAttribute("data-done", "true");
    await expect(page.locator("[data-state=declared]")).toHaveCount(2);
    await expect(parentRow).toContainText(`Padre ${stamp}`);
    await expect(page.getByText("incluye 3 h de tareas hechas")).toBeVisible();

    // Undone again with no reload: the done child is the one to take back.
    await page.getByRole("button", { name: `Deshacer: Hijo pendiente ${stamp}` }).click();
    await expect(parentRow).toHaveAttribute("data-done", "false");

    // Last month: closed, its share, nothing to add.
    await page.goto(`/metas/${goalId}/meses/${seg(lastMonth)}`);
    await expect(page.getByText("cerrado", { exact: true })).toBeVisible();
    await expect(page.getByText("cerrado · se arrastró 75 % · 3 h de 4 h")).toBeVisible();
    await expect(page.getByText("Un mes cerrado no toma tareas nuevas.")).toBeVisible();
    await expect(page.getByRole("link", { name: /Otra tarea|Escribir una tarea/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Escribir una tarea/ })).toHaveCount(0);

    // Outside the span, and not a month at all.
    for (const mes of [seg(nextMonth(horizon)), seg(twoBack), "2026-13", "abril"]) {
      await page.goto(`/metas/${goalId}/meses/${mes}`);
      await expect(page.getByRole("heading", { name: "Esta página no existe" }), mes).toBeVisible();
    }
  } finally {
    await context.close();
  }
});

test("an empty month says so and offers the first task (RP-30)", async ({
  person,
  browser,
  baseURL,
  db,
}) => {
  const stamp = Date.now();
  const goalId = await seedGoal(db, person.id, `Meta vacío ${stamp}`);
  await seedBudget(db, person.id, goalId, thisMonth, 720);

  const context = await browser.newContext({ storageState: person.sessionFile, baseURL: baseURL! });
  try {
    const page = await context.newPage();
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(`/metas/${goalId}/meses/${seg(thisMonth)}`);
    await expect(page.getByText("0 min", { exact: true })).toBeVisible();
    await expect(page.getByText(/no tiene tareas\. Las que escribas aquí suman su tiempo a la meta/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Escribir una tarea" })).toHaveAttribute(
      "href",
      `/metas/${goalId}/meses/${seg(thisMonth)}/tarea/nueva`,
    );
  } finally {
    await context.close();
  }
});

test("a closed month over half carried proposes the shift; the sheet lists the moves; accepting moves the plan a month and the proposal is gone; at exactly half or two months back there is none (RP-34)", async ({
  person,
  browser,
  baseURL,
  db,
}) => {
  const stamp = Date.now();
  const moved = await seedGoal(db, person.id, `Meta corre ${stamp}`);
  await seedBudget(db, person.id, moved, thisMonth, 600);
  await seedBudget(db, person.id, moved, following, 300);
  await seedTask(db, person.id, moved, `Sigue ${stamp}`, lastMonth, 100);
  await seedTask(db, person.id, moved, `Se mueve ${stamp}`, thisMonth, 60);

  const half = await seedGoal(db, person.id, `Meta mitad ${stamp}`);
  await seedTask(db, person.id, half, `Hecha ${stamp}`, lastMonth, 100, null, `${lastMonth.slice(0, 8)}15`);
  await seedTask(db, person.id, half, `Falta ${stamp}`, lastMonth, 100);

  const old = await seedGoal(db, person.id, `Meta vieja ${stamp}`, twoBack);
  await seedTask(db, person.id, old, `Antigua ${stamp}`, twoBack, 100);

  const context = await browser.newContext({ storageState: person.sessionFile, baseURL: baseURL! });
  try {
    const page = await context.newPage();
    await page.setViewportSize({ width: 360, height: 740 });
    const proposal = /Se arrastró más de la mitad de/;

    await page.goto(`/metas/${half}/meses/${seg(lastMonth)}`);
    await expect(page.getByText("cerrado · se arrastró 50 % · 1 h 40 min de 3 h 20 min")).toBeVisible();
    await expect(page.getByText(proposal)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "ver qué se corre" })).toHaveCount(0);
    await page.goto(`/metas/${old}/meses/${seg(twoBack)}`);
    await expect(page.getByText("cerrado", { exact: true })).toBeVisible();
    await expect(page.getByText(proposal)).toHaveCount(0);

    await page.goto(`/metas/${moved}/meses/${seg(lastMonth)}`);
    await expect(page.getByText(`Se arrastró más de la mitad de ${label(lastMonth)}.`)).toBeVisible();
    // The box is drawn on the phone: a border, not a bare column.
    const box = page.getByText(`Se arrastró más de la mitad de ${label(lastMonth)}.`).locator("xpath=ancestor::div[1]/..");
    expect(await box.evaluate((el) => parseFloat(getComputedStyle(el).borderTopWidth))).toBeGreaterThan(0);
    await expect(page.getByText(/^se puede hasta el \d+ de /)).toBeVisible();
    await expect(page.getByText(`sigue en ${label(thisMonth)}`)).toBeVisible();
    await page.getByRole("button", { name: "ver qué se corre" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("heading", { name: "Correr un mes lo que sigue" })).toBeVisible();
    await expect(sheet.getByText("1 tarea planeada")).toBeVisible();
    await expect(sheet.getByText(/^montos de /)).toBeVisible();
    await sheet.getByRole("button", { name: "Correr un mes" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText(proposal)).toHaveCount(0);

    // One month later, read from a reload.
    await page.reload();
    await expect(page.getByText(proposal)).toHaveCount(0);
    await page.goto(`/metas/${moved}/meses/${seg(following)}`);
    await expect(page.getByText(`Se mueve ${stamp}`)).toBeVisible();
    await expect(page.getByText("de 10 h", { exact: true })).toBeVisible();
    const budgets = await db<{ month: string; amount: number }[]>`
      select to_char(month, 'YYYY-MM') as month, amount from goals.month_budgets
      where goal_id = ${moved} order by month
    `;
    expect(budgets.map((b) => `${b.month}:${b.amount}`)).toEqual([
      `${seg(following)}:600`,
      `${seg(nextMonth(following))}:300`,
    ]);
  } finally {
    await context.close();
  }
});
