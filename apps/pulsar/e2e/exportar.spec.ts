import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { test, expect, type Person } from "./fixtures";
import { civilDateToDate, dateToCivilDate, todayInZone } from "@/lib/zone";
import type postgres from "postgres";

// `Reporte.dc.html`, `ReporteImpreso.dc.html`, `ReporteSinEvidencia.dc.html`,
// `ReporteVacio.dc.html` (module 131, RP-33, RP-35): `/exportar` is a page the
// browser prints. The unreadable case needs the second `next start` the
// `fuente` project already names (`PULSAR_FAULT_BASE_URL`).
const FAULT = process.env.PULSAR_FAULT_BASE_URL;

function plusDays(days: number): string {
  const date = civilDateToDate(todayInZone());
  date.setUTCDate(date.getUTCDate() + days);
  return dateToCivilDate(date);
}

type Seed = { goalId: string; name: string; taskName: string; childName: string; phaseName: string };

// A goal in minutes: 90 declared today against a 12 h month amount, a phase,
// and a task planned last month that nobody did, so it carries into this one.
async function seed(db: postgres.Sql, person: Person): Promise<Seed> {
  const stamp = Date.now();
  const today = todayInZone();
  const monthStart = `${today.slice(0, 7)}-01`;
  const name = `Meta exportada ${stamp}`;
  const taskName = `Tarea arrastrada ${stamp}`;
  const childName = `Subtarea arrastrada ${stamp}`;
  const phaseName = `Fase de exportar ${stamp}`;

  const [goal] = await db<{ id: string }[]>`
    insert into goals.goals (user_id, name, horizon, measure_name, measure_unit, created_at)
    values (${person.id}, ${name}, ${plusDays(90)}, 'minutos', 'minutos', now() - interval '70 days')
    returning id
  `;
  await db`
    insert into goals.month_budgets (user_id, goal_id, month, amount)
    values (${person.id}, ${goal.id}, ${monthStart}::date, 720)
  `;
  await db`
    insert into goals.phases (user_id, goal_id, aim, starts_on, ends_on)
    values (${person.id}, ${goal.id}, ${phaseName}, ${plusDays(-30)}, ${plusDays(30)})
  `;
  const [commitment] = await db<{ id: string }[]>`
    insert into goals.commitments
      (user_id, goal_id, name, cadence_kind, satisfaction, target_quantity, unit, created_at)
    values (${person.id}, ${goal.id}, ${`Sesión ${stamp}`}, 'daily', 'quantity', 30, 'minutos', now() - interval '70 days')
    returning id
  `;
  await db`
    insert into goals.facts (user_id, goal_id, commitment_id, day, quantity)
    values (${person.id}, ${goal.id}, ${commitment.id}, ${today}::date, 90)
  `;
  const [task] = await db<{ id: string }[]>`
    insert into goals.one_offs (user_id, goal_id, name, planned_month)
    values (${person.id}, ${goal.id}, ${taskName}, (${monthStart}::date - interval '1 month')::date)
    returning id
  `;
  await db`
    insert into goals.one_offs (user_id, goal_id, parent_id, name, estimate)
    values (${person.id}, ${goal.id}, ${task.id}, ${childName}, 45)
  `;
  return { goalId: goal.id, name, taskName, childName, phaseName };
}

test.describe("the report page (RP-33, RP-35)", () => {
  test("draws the goal, its month in hours and minutes and a carried task; signed out lands on /entrar", async ({
    person,
    browser,
    baseURL,
    db,
  }, testInfo) => {
    const seeded = await seed(db, person);
    const context = await browser.newContext({ storageState: person.sessionFile, baseURL: baseURL! });
    const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] }, baseURL: baseURL! });
    try {
      const page = await context.newPage();
      const response = await page.goto("/exportar");
      expect(response?.status()).toBe(200);
      const signedInUrl = page.url();
      expect(new URL(signedInUrl).pathname).toBe("/exportar");

      await expect(page.locator("main")).toHaveCount(1);
      const seen = (text: string) => page.getByText(text, { exact: true }).locator("visible=true");
      await expect(seen(seeded.name)).toHaveCount(1);
      await expect(seen("1 h 30 min").first()).toBeVisible();
      await expect(seen("12 h").first()).toBeVisible();
      await expect(seen(seeded.taskName)).toHaveCount(1);
      await expect(seen(seeded.childName)).toHaveCount(1);
      await expect(seen(seeded.phaseName)).toHaveCount(1);
      await expect(seen("Tu plan")).toHaveCount(1);
      await expect(seen("1 meta abierta")).toHaveCount(1);
      await expect(seen("hasta hoy")).toHaveCount(1);
      await expect(page.getByText(/^exportar · /)).toBeVisible();
      await expect(page).toHaveTitle(/^pulsar · /);
      // The evidence read, so no notice.
      await expect(page.getByText(/No pudimos leer el diccionario/)).toHaveCount(0);
      await expect(page.getByText("solo lo que dijiste tú")).toHaveCount(0);

      const out = await anonymous.newPage();
      await out.goto("/exportar");
      await out.waitForURL(/\/entrar/);
      const signedOutUrl = out.url();
      expect(new URL(signedOutUrl).pathname).toBe("/entrar");
      await expect(out.getByText(seeded.name)).toHaveCount(0);

      testInfo.annotations.push({ type: "final-urls", description: `signed in ${signedInUrl} · signed out ${signedOutUrl}` });
    } finally {
      await anonymous.close();
      await context.close();
      await db`delete from goals.goals where id = ${seeded.goalId} and user_id = ${person.id}`;
    }
  });

  test("the button prints on tap and never on load; in print the button and the nav are gone, black on white under dark", async ({
    person,
    browser,
    baseURL,
    db,
  }) => {
    const seeded = await seed(db, person);
    const context = await browser.newContext({ storageState: person.sessionFile, baseURL: baseURL! });
    try {
      const page = await context.newPage();
      await page.addInitScript(() => {
        localStorage.setItem("theme", "dark");
        const calls = { n: 0 };
        (window as unknown as { __prints: { n: number } }).__prints = calls;
        window.print = () => {
          calls.n += 1;
        };
      });
      await page.goto("/exportar");
      await expect(page.locator("html")).toHaveClass(/\bdark\b/);
      const button = page.getByRole("button", { name: "Descargar PDF" });
      await expect(button).toBeVisible();
      await expect(page.getByText(seeded.name, { exact: true })).toBeVisible();

      const prints = () => page.evaluate(() => (window as unknown as { __prints: { n: number } }).__prints.n);
      expect(await prints()).toBe(0);
      await button.click();
      expect(await prints()).toBe(1);

      const ground = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      const ink = () =>
        page.getByText(seeded.name, { exact: true }).evaluate((node) => getComputedStyle(node).color);
      expect(await ground(), "screen ground under dark").not.toBe("rgb(255, 255, 255)");

      await page.emulateMedia({ media: "print" });
      await expect(button).toBeHidden();
      await expect(page.locator("nav").locator("visible=true")).toHaveCount(0);
      await expect(page.getByText(seeded.name, { exact: true })).toBeVisible();
      expect(await ground()).toBe("rgb(255, 255, 255)");
      expect(await ink()).toBe("rgb(0, 0, 0)");

      // Chromium's own PDF: the page's text is in the file.
      const pdf = await page.pdf({ format: "A4" });
      const dir = resolve(process.cwd(), "private/export-pdf");
      mkdirSync(dir, { recursive: true });
      const file = resolve(dir, `${seeded.goalId}.pdf`);
      writeFileSync(file, pdf);
      const text = execFileSync("pdftotext", [file, "-"], { encoding: "utf8" });
      expect(text).toContain(seeded.name);
      expect(text).toContain("1 h 30 min");
      expect(text).not.toContain("Descargar PDF");
    } finally {
      await context.close();
      await db`delete from goals.goals where id = ${seeded.goalId} and user_id = ${person.id}`;
    }
  });

  test("a goal that measures nothing prints its phases and no figure", async ({ person, browser, baseURL, db }) => {
    const stamp = Date.now();
    const name = `Meta sin medida ${stamp}`;
    const phaseName = `Fase sola ${stamp}`;
    const [goal] = await db<{ id: string }[]>`
      insert into goals.goals (user_id, name, horizon, created_at)
      values (${person.id}, ${name}, ${plusDays(60)}, now() - interval '10 days')
      returning id
    `;
    await db`
      insert into goals.phases (user_id, goal_id, aim, starts_on, ends_on)
      values (${person.id}, ${goal.id}, ${phaseName}, ${plusDays(-5)}, ${plusDays(30)})
    `;
    const context = await browser.newContext({ storageState: person.sessionFile, baseURL: baseURL! });
    try {
      const page = await context.newPage();
      await page.goto("/exportar");
      await expect(page.getByText(name, { exact: true })).toBeVisible();
      await expect(page.getByText(phaseName)).toBeVisible();
      await expect(page.getByText(/^no mide nada · hasta el /)).toBeVisible();
      for (const absent of ["hasta hoy", "por mes", "por semana"]) {
        await expect(page.getByText(absent, { exact: true })).toHaveCount(0);
      }
      await expect(page.getByText(/\b0\b/)).toHaveCount(0);
    } finally {
      await context.close();
      await db`delete from goals.goals where id = ${goal.id} and user_id = ${person.id}`;
    }
  });

  test("no goal open: one line and the way back to the goals", async ({ person, browser, baseURL }) => {
    const context = await browser.newContext({ storageState: person.sessionFile, baseURL: baseURL! });
    try {
      const page = await context.newPage();
      const response = await page.goto("/exportar");
      expect(response?.status()).toBe(200);
      await expect(page.getByText("No tienes metas abiertas. No hay nada que exportar.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Descargar PDF" })).toHaveCount(0);
      await page.getByRole("link", { name: "volver a metas" }).click();
      await page.waitForURL(/\/metas/);
    } finally {
      await context.close();
    }
  });

  test("an unreadable dictionary says so once and every figure is only what was declared", async ({
    person,
    browser,
    db,
  }) => {
    test.skip(!FAULT, "needs PULSAR_FAULT_BASE_URL, a next start with PULSAR_FAULT_SEAM set");
    const seeded = await seed(db, person);
    const context = await browser.newContext({ storageState: person.sessionFile, baseURL: FAULT! });
    try {
      const page = await context.newPage();
      await page.goto("/exportar");
      await expect(page.getByText(seeded.name, { exact: true })).toBeVisible();
      await expect(
        page.getByText("No pudimos leer el diccionario de lectura. Las cifras que salen de él son solo lo que dijiste tú."),
      ).toHaveCount(1);
      await expect(page.getByText("solo lo que dijiste tú", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("solo lo dicho").first()).toBeVisible();
      await expect(page.getByText("alimentada por el diccionario")).toBeVisible();
      await expect(page.getByText("1 h 30 min").first()).toBeVisible();
    } finally {
      await context.close();
      await db`delete from goals.goals where id = ${seeded.goalId} and user_id = ${person.id}`;
    }
  });
});

// `Exportar.dc.html` (module 137, RP-33, RP-37): `/metas` offers the export
// beside the import under «el plan».
test.describe("the way in from /metas (RP-33, RP-37)", () => {
  test("«Exportar» opens the report; «Importar un plan» points at its page", async ({
    person,
    browser,
    baseURL,
    db,
  }) => {
    const seeded = await seed(db, person);
    const context = await browser.newContext({ storageState: person.sessionFile, baseURL: baseURL! });
    try {
      const page = await context.newPage();
      await page.goto("/metas");
      await expect(page.getByText("el plan", { exact: true })).toBeVisible();
      const exportLink = page.getByRole("link", { name: /^Exportar/ });
      await expect(exportLink).toContainText("un PDF con cada meta, su mes y lo que se arrastró");
      const importLink = page.getByRole("link", { name: /^Importar un plan/ });
      await expect(importLink).toContainText("pégalo o súbelo y revisa antes de crear");
      await expect(importLink).toHaveAttribute("href", "/metas/importar");

      // Below «Nueva meta», in the order the board draws.
      const order = await page.locator("main a").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("href")));
      expect(order.indexOf("/metas/nueva")).toBeLessThan(order.indexOf("/exportar"));
      expect(order.indexOf("/exportar")).toBeLessThan(order.indexOf("/metas/importar"));

      await exportLink.click();
      await page.waitForURL(/\/exportar$/);
      await expect(page.getByText(seeded.name, { exact: true })).toBeVisible();
      await expect(page.getByText(seeded.taskName, { exact: true })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("with every goal archived there is no «Exportar», and «Importar un plan» stays", async ({
    person,
    browser,
    baseURL,
    db,
  }) => {
    await db`
      insert into goals.goals (user_id, name, horizon, archived_at, created_at)
      values (${person.id}, ${`Archivada ${Date.now()}`}, ${plusDays(60)}, now(), now() - interval '20 days')
    `;
    const context = await browser.newContext({ storageState: person.sessionFile, baseURL: baseURL! });
    try {
      const page = await context.newPage();
      await page.goto("/metas");
      await expect(page).toHaveURL(/\/metas$/);
      await expect(page.getByRole("link", { name: /^Importar un plan/ })).toBeVisible();
      await expect(page.getByRole("link", { name: /^Exportar/ })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
