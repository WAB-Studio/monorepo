import type { Page } from "@playwright/test";
import type postgres from "postgres";

import { horizonForWeeks } from "@/lib/day/weeks";
import { civilDateInZone } from "@/lib/zone";

import { test, expect } from "./fixtures";

// RNP-11: the goal opens in two columns from 1024 — the commitments left, the
// end, the figure and the phases right — and «Renombrar» and «Archivar» sit
// beside the title. Below 1024 the order is the phone's own.

async function seedGoal(db: postgres.Sql, personId: string, name: string): Promise<string> {
  const createdAt = new Date(Date.now() - 2 * 86_400_000);
  const openedOn = civilDateInZone(createdAt);
  const [goal] = await db<{ id: string }[]>`
    insert into goals.goals (user_id, name, horizon, created_at)
    values (${personId}, ${name}, ${horizonForWeeks(openedOn, 12)}, ${createdAt})
    returning id
  `;
  await db`
    insert into goals.commitments (user_id, goal_id, name, cadence_kind, satisfaction)
    values (${personId}, ${goal.id}, 'Compromiso ancho', 'daily', 'tap')
  `;
  await db`
    insert into goals.phases (user_id, goal_id, aim, starts_on, ends_on)
    values (${personId}, ${goal.id}, 'Fase ancha', ${openedOn}, ${openedOn})
  `;
  return goal.id;
}

// `load` fires with the loading fallback still standing, so a box read
// straight after `goto` measures the skeleton or nothing.
async function settled(page: Page) {
  await expect(page.getByText("Compromiso ancho", { exact: true })).toBeVisible();
  await expect(page.getByText("Fase ancha", { exact: true })).toBeVisible();
  await expect(page.locator("main")).toHaveCount(1);
}

async function boxOf(page: Page, text: string) {
  return page.getByRole("main").getByText(text, { exact: true }).evaluate((el) => {
    const { x, y } = el.getBoundingClientRect();
    return { x, y };
  });
}

test("at 1280 the commitments sit left, the end and the phases right, one of each act visible (RNP-11)", async ({
  page,
  db,
  personId,
}) => {
  const name = `Meta ancha ${Date.now()}`;
  const goalId = await seedGoal(db, personId, name);
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/metas/${goalId}`);
    await settled(page);

    const commitment = await boxOf(page, "Compromiso ancho");
    const phase = await boxOf(page, "Fase ancha");
    const end = await page.getByText(/^12 semanas · hasta el /).evaluate((el) => {
      const { x, y } = el.getBoundingClientRect();
      return { x, y };
    });
    expect(phase.x).toBeGreaterThan(commitment.x + 300);
    expect(end.x).toBeGreaterThan(commitment.x + 300);
    expect(end.y).toBeLessThan(phase.y);

    // Each group sits in a bordered white card: commitments, the end, the phases.
    for (const text of ["Compromiso ancho", "Fase ancha", "el final"]) {
      const card = await page.getByText(text, { exact: true }).evaluate((el) => {
        for (let node = el.parentElement; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.borderTopWidth === "1px" && style.borderTopLeftRadius === "14px") {
            return { radius: style.borderTopLeftRadius, padding: style.paddingLeft };
          }
        }
        return null;
      });
      expect(card, text).toEqual({ radius: "14px", padding: "24px" });
    }

    await expect(page.getByRole("button", { name: "Renombrar" })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Archivar" })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "mover el final" })).toHaveCount(1);
    const title = await boxOf(page, name);
    const rename = await page.getByRole("button", { name: "Renombrar" }).boundingBox();
    expect(rename!.x).toBeGreaterThan(title.x);
    expect(Math.abs(rename!.y - title.y)).toBeLessThan(40);
  } finally {
    await db`delete from goals.goals where id = ${goalId} and user_id = ${personId}`;
  }
});

// Elements drawing the Panel card: a 1px border with a 14px radius.
async function panelCards(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      [...document.querySelectorAll("body *")].filter((el) => {
        const style = getComputedStyle(el);
        return style.borderTopWidth === "1px" && style.borderTopLeftRadius === "14px";
      }).length,
  );
}

test("at 800 the goal draws no Panel card (RNP-11)", async ({ page, db, personId }) => {
  const goalId = await seedGoal(db, personId, `Meta media ${Date.now()}`);
  try {
    await page.setViewportSize({ width: 800, height: 800 });
    await page.goto(`/metas/${goalId}`);
    await expect(page.getByText("Compromiso ancho", { exact: true })).toBeVisible();
    expect(await panelCards(page)).toBe(0);
  } finally {
    await db`delete from goals.goals where id = ${goalId} and user_id = ${personId}`;
  }
});

test("at 360 the order is the phone's: end, commitments, phases, then «Archivar esta meta» (RNP-11)", async ({
  page,
  db,
  personId,
}) => {
  const goalId = await seedGoal(db, personId, `Meta angosta ${Date.now()}`);
  try {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(`/metas/${goalId}`);
    await settled(page);

    const end = await page.getByText(/^12 semanas · hasta el /).boundingBox();
    const commitment = await page.getByText("Compromiso ancho", { exact: true }).boundingBox();
    const phase = await page.getByText("Fase ancha", { exact: true }).boundingBox();
    const archive = await page.getByRole("button", { name: "Archivar esta meta" }).boundingBox();
    expect(end!.y).toBeLessThan(commitment!.y);
    expect(commitment!.y).toBeLessThan(phase!.y);
    expect(phase!.y).toBeLessThan(archive!.y);

    expect(await panelCards(page)).toBe(0);
    await expect(page.getByRole("button", { name: "Renombrar" })).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
  } finally {
    await db`delete from goals.goals where id = ${goalId} and user_id = ${personId}`;
  }
});

test("at 1280 a goal with no measure draws no empty card, and «Añadir una fase» sits right of the phases label (RNP-11)", async ({
  page,
  db,
  personId,
}) => {
  const goalId = await seedGoal(db, personId, `Meta sin cifra ${Date.now()}`);
  await db`delete from goals.phases where goal_id = ${goalId}`;
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/metas/${goalId}`);
    await expect(page.getByText("cero fases", { exact: true })).toBeVisible();
    await expect(page.locator("main")).toHaveCount(1);

    const cards = await page.locator("main").evaluate((main) =>
      Array.from(main.querySelectorAll("*"))
        .filter((el) => {
          const style = getComputedStyle(el);
          return style.borderTopWidth === "1px" && style.borderTopLeftRadius === "14px";
        })
        .map((el) => (el as HTMLElement).innerText.trim()),
    );
    expect(cards).toHaveLength(3);
    for (const text of cards) expect(text).not.toBe("");

    const label = await boxOf(page, "cero fases");
    const add = await page.getByRole("link", { name: "Añadir una fase" }).boundingBox();
    expect(add!.x).toBeGreaterThan(label.x + 150);
    expect(Math.abs(add!.y + add!.height / 2 - (label.y + 8))).toBeLessThan(30);
  } finally {
    await db`delete from goals.goals where id = ${goalId} and user_id = ${personId}`;
  }
});

// `MetaRiel.dc.html` (module 211): the name is the page's one h1, the actions
// sit on its line, and the rail marks this goal.
test("at 1280 and 1440 the goal's name is the one h1, «Renombrar» and «Archivar» sit on its line, the rail marks the goal (RP-23, RNP-16)", async ({
  page,
  db,
  personId,
}) => {
  const name = `Meta encabezado ${Date.now()}`;
  const goalId = await seedGoal(db, personId, name);
  try {
    for (const width of [1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/metas/${goalId}`);
      await settled(page);

      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      const h1 = page.getByRole("heading", { level: 1, name });
      await expect(h1).toBeVisible();
      const title = (await h1.boundingBox())!;
      for (const action of ["Renombrar", "Archivar"]) {
        const box = (await page.getByRole("button", { name: action }).boundingBox())!;
        expect(box.x, action).toBeGreaterThan(title.x);
        const gap = Math.abs(box.y + box.height / 2 - (title.y + title.height / 2));
        expect(gap, action).toBeLessThan(title.height);
      }
      await expect(page.getByRole("link", { name: "Volver a Metas" })).toHaveAttribute("href", "/metas");
      await expect(page.getByRole("navigation").getByRole("link", { name, exact: true })).toHaveAttribute(
        "aria-current",
        "page",
      );
    }
  } finally {
    await db`delete from goals.goals where id = ${goalId} and user_id = ${personId}`;
  }
});
