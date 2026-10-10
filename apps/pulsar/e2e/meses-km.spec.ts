import { test, expect } from "./fixtures";
import { dayBefore } from "@/lib/day/weeks";
import { monthOf, nextMonth } from "@/lib/plan/months";
import { todayInZone } from "@/lib/zone";

// RP-69 (RP-65): «Por mes» of a goal measured in km says how many tasks each
// month's list holds, and that goal's empty month never promises time.

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
const label = (month: string) => NAMES[Number(month.slice(5, 7)) - 1];
const seg = (month: string) => month.slice(0, 7);

const thisMonth = monthOf(todayInZone());
const lastMonth = monthOf(dayBefore(thisMonth));
const followingMonth = nextMonth(thisMonth);
const horizon = nextMonth(followingMonth);

type Db = import("postgres").Sql;

async function seedGoal(db: Db, personId: string, name: string, measure: "km" | "minutos") {
  const [goal] = await db<{ id: string }[]>`
    insert into goals.goals (user_id, name, horizon, measure_name, measure_unit, created_at)
    values (${personId}, ${name}, ${horizon}::date, ${measure}, ${measure}, (${lastMonth}::date + 14) + time '12:00' at time zone 'UTC')
    returning id
  `;
  return goal.id;
}

async function seedTask(db: Db, personId: string, goalId: string, name: string, month: string, estimate: number | null) {
  await db`
    insert into goals.one_offs (user_id, goal_id, name, planned_month, estimate)
    values (${personId}, ${goalId}, ${name}, ${month}::date, ${estimate})
  `;
}

async function seedBudget(db: Db, personId: string, goalId: string, month: string, amount: number) {
  await db`
    insert into goals.month_budgets (user_id, goal_id, month, amount)
    values (${personId}, ${goalId}, ${month}::date, ${amount})
  `;
}

async function rows(
  page: import("@playwright/test").Page,
  goalId: string,
  width: number,
): Promise<(month: string) => import("@playwright/test").Locator> {
  await page.setViewportSize({ width, height: width >= 1024 ? 900 : 740 });
  await page.goto(`/metas/${goalId}/meses`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  return (month) => page.locator("main ol li:visible", { hasText: new RegExp(`^${label(month)}`, "i") }).first();
}

async function open(browser: import("@playwright/test").Browser, baseURL: string | undefined, sessionFile: string) {
  return browser.newContext({ storageState: sessionFile, baseURL: baseURL! });
}

for (const width of [360, 1440]) {
  test(`km goal, this month with two tasks: the row reads «en curso · 2 tareas» at ${width} (RP-69)`, async ({
    person,
    browser,
    baseURL,
    db,
  }) => {
    const stamp = Date.now();
    const goalId = await seedGoal(db, person.id, `Meta km en curso ${stamp}`, "km");
    await seedBudget(db, person.id, goalId, thisMonth, 40);
    await seedTask(db, person.id, goalId, `Uno ${stamp}`, thisMonth, 5);
    await seedTask(db, person.id, goalId, `Dos ${stamp}`, thisMonth, 8);
    const context = await open(browser, baseURL, person.sessionFile);
    try {
      const row = await rows(await context.newPage(), goalId, width);
      await expect(row(thisMonth)).toContainText("en curso · 2 tareas");
    } finally {
      await context.close();
    }
  });
}

test("km goal, next month with one task and an amount reads «planeado · 1 tarea», and this month, empty, does not borrow it (RP-69)", async ({
  person,
  browser,
  baseURL,
  db,
}) => {
  const stamp = Date.now();
  const goalId = await seedGoal(db, person.id, `Meta km futuro ${stamp}`, "km");
  await seedBudget(db, person.id, goalId, thisMonth, 40);
  await seedBudget(db, person.id, goalId, followingMonth, 30);
  await seedTask(db, person.id, goalId, `Futura ${stamp}`, followingMonth, 6);
  const context = await open(browser, baseURL, person.sessionFile);
  try {
    const row = await rows(await context.newPage(), goalId, 360);
    await expect(row(followingMonth)).toContainText("planeado · 1 tarea");
    await expect(row(followingMonth)).not.toContainText("1 tareas");
    await expect(row(thisMonth)).toContainText("en curso");
    await expect(row(thisMonth)).not.toContainText("tarea");
  } finally {
    await context.close();
  }
});

test("km goal: a task left undone from a past month counts in the current month, as its list shows it (RP-69)", async ({
  person,
  browser,
  baseURL,
  db,
}) => {
  const stamp = Date.now();
  const goalId = await seedGoal(db, person.id, `Meta km arrastrada ${stamp}`, "km");
  await seedBudget(db, person.id, goalId, thisMonth, 40);
  await seedTask(db, person.id, goalId, `Vieja ${stamp}`, lastMonth, 7);
  await seedTask(db, person.id, goalId, `Propia ${stamp}`, thisMonth, 5);
  const context = await open(browser, baseURL, person.sessionFile);
  try {
    const page = await context.newPage();
    // The month's own list is the reference for how many it holds.
    await page.goto(`/metas/${goalId}/meses/${seg(thisMonth)}`);
    await expect(page.getByText(`Vieja ${stamp}`).first()).toBeVisible();
    await expect(page.getByText(`Propia ${stamp}`).first()).toBeVisible();
    const row = await rows(page, goalId, 360);
    await expect(row(thisMonth)).toContainText("en curso · 2 tareas");
  } finally {
    await context.close();
  }
});

test("km goal, no task in any month: no row says «tarea» and none says «0 tareas» (RP-69)", async ({
  person,
  browser,
  baseURL,
  db,
}) => {
  const stamp = Date.now();
  const goalId = await seedGoal(db, person.id, `Meta km sin tareas ${stamp}`, "km");
  await seedBudget(db, person.id, goalId, thisMonth, 40);
  await seedBudget(db, person.id, goalId, followingMonth, 30);
  const context = await open(browser, baseURL, person.sessionFile);
  try {
    const row = await rows(await context.newPage(), goalId, 360);
    for (const month of [lastMonth, thisMonth, followingMonth]) {
      await expect(row(month), month).toBeVisible();
      await expect(row(month), month).not.toContainText("tarea");
    }
    await expect(row(thisMonth)).toContainText("en curso");
    await expect(row(followingMonth)).toContainText("planeado");
  } finally {
    await context.close();
  }
});

test("km goal, empty month: the list does not say its tasks add time, and says what to do (RP-69, RP-65)", async ({
  person,
  browser,
  baseURL,
  db,
}) => {
  const stamp = Date.now();
  const goalId = await seedGoal(db, person.id, `Meta km vacío ${stamp}`, "km");
  await seedBudget(db, person.id, goalId, thisMonth, 40);
  const context = await open(browser, baseURL, person.sessionFile);
  try {
    const page = await context.newPage();
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(`/metas/${goalId}/meses/${seg(thisMonth)}`);
    await expect(page.getByText(/no tiene tareas\. Escribe las que quieras hacer este mes\./).first()).toBeAttached();
    await expect(page.getByText("suman su tiempo")).toHaveCount(0);
    expect(await page.locator("body").innerText()).not.toContain("suman su tiempo");
    expect(await page.content()).not.toContain("suman su tiempo");
  } finally {
    await context.close();
  }
});

test("minutes goal: no «Por mes» row says «tarea», and its empty month still says its tasks add time (RP-69, RP-32)", async ({
  person,
  browser,
  baseURL,
  db,
}) => {
  const stamp = Date.now();
  const goalId = await seedGoal(db, person.id, `Meta min tareas ${stamp}`, "minutos");
  await seedBudget(db, person.id, goalId, thisMonth, 720);
  await seedTask(db, person.id, goalId, `Uno ${stamp}`, followingMonth, 60);
  await seedTask(db, person.id, goalId, `Dos ${stamp}`, followingMonth, 30);
  const context = await open(browser, baseURL, person.sessionFile);
  try {
    const page = await context.newPage();
    const row = await rows(page, goalId, 360);
    for (const month of [lastMonth, thisMonth, followingMonth]) {
      await expect(row(month), month).toBeVisible();
      await expect(row(month), month).not.toContainText("tarea");
    }
    await expect(row(thisMonth)).toContainText("en curso");
    await page.goto(`/metas/${goalId}/meses/${seg(thisMonth)}`);
    await expect(page.getByText(/suman su tiempo a la meta/).first()).toBeAttached();
  } finally {
    await context.close();
  }
});
