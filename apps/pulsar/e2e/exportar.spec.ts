import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { test, expect, settled, type Person } from "./fixtures";
import { dayBefore } from "@/lib/day/weeks";
import { nextMonth } from "@/lib/plan/months";
import {
  civilDateToDate,
  civilDateShort,
  dateToCivilDate,
  todayInZone,
} from "@/lib/zone";
import type postgres from "postgres";
import exportMessages from "../messages/es/export.json";

// `Reporte.dc.html`, `ReporteImpreso.dc.html`, `ReporteSinEvidencia.dc.html`,
// `ReporteVacio.dc.html`, `ReporteTareas.dc.html`, `ReporteMesesSemanas.dc.html`,
// `ReporteImpresoTareas.dc.html` (module 131, 265, RP-49, RP-35): `/exportar` is a page the
// browser prints. The unreadable case needs the second `next start` the
// `fuente` project already names (`PULSAR_FAULT_BASE_URL`).
// Pages the two-goal seeded report takes on A4 with the carried notes
// printed and the month's tasks, measured by `pdfinfo` on 2026-10-06 (module 265; 317 spaced the sections: 11 to 10;
// 379 printed the months alone and let a section run across pages: 10 to 6).
const A4_PAGES = 4;
const FAULT = process.env.PULSAR_FAULT_BASE_URL;

function plusDays(days: number): string {
  const date = civilDateToDate(todayInZone());
  date.setUTCDate(date.getUTCDate() + days);
  return dateToCivilDate(date);
}

type Seed = {
  goalId: string;
  name: string;
  taskName: string;
  childName: string;
  phaseName: string;
  monthTask: string;
  doneTask: string;
  monthNote: string;
  doneNote: string;
  taskNote: string;
  childNote: string;
};

// Three lines for the carried task, 2000 characters for its sub-task.
const TASK_NOTE = "Primera línea de la nota\nSegunda línea de la nota\nTercera línea de la nota";
const CHILD_NOTE = Array.from(
  { length: 400 },
  (_, i) => `n${String(i).padStart(3, "0")}`,
)
  .join(" ")
  .slice(0, 2000);

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
  const monthTask = `Tarea del mes ${stamp}`;
  const doneTask = `Tarea hecha ${stamp}`;
  const monthNote = `Nota de la tarea del mes ${stamp}`;
  const doneNote = `Nota de la tarea hecha ${stamp}`;

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
    insert into goals.one_offs (user_id, goal_id, name, planned_month, note)
    values (${person.id}, ${goal.id}, ${taskName}, (${monthStart}::date - interval '1 month')::date, ${TASK_NOTE})
    returning id
  `;
  await db`
    insert into goals.one_offs (user_id, goal_id, parent_id, name, estimate, note)
    values (${person.id}, ${goal.id}, ${task.id}, ${childName}, 45, ${CHILD_NOTE})
  `;
  await db`
    insert into goals.one_offs (user_id, goal_id, name, estimate, planned_month, note)
    values (${person.id}, ${goal.id}, ${monthTask}, 60, ${monthStart}::date, ${monthNote})
  `;
  const [finished] = await db<{ id: string }[]>`
    insert into goals.one_offs (user_id, goal_id, name, planned_month, note)
    values (${person.id}, ${goal.id}, ${doneTask}, ${monthStart}::date, ${doneNote})
    returning id
  `;
  await db`
    insert into goals.facts (user_id, goal_id, one_off_id, day)
    values (${person.id}, ${goal.id}, ${finished.id}, ${today}::date)
  `;
  return {
    goalId: goal.id,
    name,
    taskName,
    childName,
    phaseName,
    monthTask,
    doneTask,
    monthNote,
    doneNote,
    taskNote: TASK_NOTE,
    childNote: CHILD_NOTE,
  };
}

test.describe("the report page (RP-49, RP-35)", () => {
  test("RP-49: draws the goal, its month in hours and minutes, the month's tasks and a carried one; signed out lands on /entrar", async ({
    person,
    browser,
    baseURL,
    db,
  }, testInfo) => {
    const seeded = await seed(db, person);
    const context = await browser.newContext({
      storageState: person.sessionFile,
      baseURL: baseURL!,
    });
    const anonymous = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      baseURL: baseURL!,
    });
    try {
      const page = await context.newPage();
      const response = await page.goto("/exportar");
      expect(response?.status()).toBe(200);
      const signedInUrl = page.url();
      expect(new URL(signedInUrl).pathname).toBe("/exportar");

      await expect(page.locator("main")).toHaveCount(1);
      const seen = (text: string) =>
        page.getByText(text, { exact: true }).locator("visible=true");
      await expect(seen(seeded.name)).toHaveCount(1);
      await expect(seen("1 h 30 min").first()).toBeVisible();
      await expect(seen("12 h").first()).toBeVisible();
      await expect(seen(seeded.taskName)).toHaveCount(1);
      await expect(seen(seeded.childName)).toHaveCount(1);
      // RP-45: the notes under the carried task and its sub-task, whole.
      await expect(
        page.getByRole("main").getByText("Segunda línea de la nota"),
      ).toHaveCount(1);
      await expect(
        page.getByRole("main").getByText(seeded.childNote, { exact: true }),
      ).toHaveCount(1);
      await expect(
        page.getByRole("main").getByText("Segunda línea de la nota"),
      ).toHaveCSS("white-space", "pre-line");
      await expect(seen(seeded.phaseName)).toHaveCount(1);
      await expect(seen("Tu plan")).toHaveCount(1);
      await expect(seen("1 meta")).toHaveCount(1);
      await expect(seen("hasta hoy")).toHaveCount(1);
      // RP-49: the first figure is named, the month's tasks listed done and not.
      const monthName = new Intl.DateTimeFormat("es-CO", { month: "long", timeZone: "UTC" }).format(
        civilDateToDate(todayInZone()),
      );
      await expect(seen(`este mes · ${monthName}`)).toHaveCount(1);
      await expect(seen(`tareas de ${monthName}`)).toHaveCount(1);
      await expect(seen(seeded.monthTask)).toHaveCount(1);
      await expect(seen(seeded.doneTask)).toHaveCount(1);
      // RP-49: a note sits under its own task, whether the task is carried, this month's or done.
      for (const [task, note] of [
        [seeded.monthTask, seeded.monthNote],
        [seeded.doneTask, seeded.doneNote],
      ]) {
        await expect(
          page.getByText(task, { exact: true }).locator("visible=true").locator("xpath=following-sibling::p[1]"),
        ).toHaveText(note);
      }
      await expect(page.getByText(/^exportar · .* de \d{4}$/)).toBeVisible();
      await expect(page).toHaveTitle(new RegExp(`^${exportMessages.printBrand} · `));
      // The evidence read, so no notice.
      await expect(
        page.getByText(/No pudimos leer el diccionario/),
      ).toHaveCount(0);
      await expect(page.getByText("solo lo que dijiste tú")).toHaveCount(0);

      const out = await anonymous.newPage();
      await out.goto("/exportar");
      await out.waitForURL(/\/entrar/);
      const signedOutUrl = out.url();
      expect(new URL(signedOutUrl).pathname).toBe("/entrar");
      await expect(out.getByText(seeded.name)).toHaveCount(0);

      testInfo.annotations.push({
        type: "final-urls",
        description: `signed in ${signedInUrl} · signed out ${signedOutUrl}`,
      });
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
    const context = await browser.newContext({
      storageState: person.sessionFile,
      baseURL: baseURL!,
    });
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
      await expect(page.getByRole("main").getByText(seeded.name, { exact: true })).toBeVisible();

      const prints = () =>
        page.evaluate(
          () => (window as unknown as { __prints: { n: number } }).__prints.n,
        );
      expect(await prints()).toBe(0);
      await button.click();
      expect(await prints()).toBe(1);

      const ground = () =>
        page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      const ink = () =>
        page.getByRole("main")
          .getByText(seeded.name, { exact: true })
          .evaluate((node) => getComputedStyle(node).color);
      expect(await ground(), "screen ground under dark").not.toBe(
        "rgb(255, 255, 255)",
      );

      await page.emulateMedia({ media: "print" });
      await expect(button).toBeHidden();
      await expect(page.locator("nav").locator("visible=true")).toHaveCount(0);
      await expect(page.getByRole("main").getByText(seeded.name, { exact: true })).toBeVisible();
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
      // RP-45: both notes whole, line breaks kept, none wider than the sheet.
      expect(text).toContain(seeded.taskNote);
      expect(text).toContain("n000 n001");
      expect(text).toContain("n399");
      const widest = await page.evaluate(() =>
        Math.max(
          ...Array.from(document.querySelectorAll("main p")).map(
            (node) => node.getBoundingClientRect().right,
          ),
        ) - document.documentElement.clientWidth,
      );
      expect(widest, "no note overflows the A4 width").toBeLessThanOrEqual(0);
    } finally {
      await context.close();
      await db`delete from goals.goals where id = ${seeded.goalId} and user_id = ${person.id}`;
    }
  });

  test("a goal that measures nothing prints its phases and no figure", async ({
    person,
    browser,
    baseURL,
    db,
  }) => {
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
    const context = await browser.newContext({
      storageState: person.sessionFile,
      baseURL: baseURL!,
    });
    try {
      const page = await context.newPage();
      await page.goto("/exportar");
      await expect(page.getByRole("main").getByText(name, { exact: true })).toBeVisible();
      await expect(page.getByText(phaseName)).toBeVisible();
      await expect(page.getByText(/^no mide nada · hasta el /)).toBeVisible();
      for (const absent of ["hasta hoy", "por semana"]) {
        await expect(page.getByText(absent, { exact: true })).toHaveCount(0);
      }
      await expect(page.getByText(/· por mes$/)).toHaveCount(0);
      await expect(page.getByText(/\b0\b/)).toHaveCount(0);
    } finally {
      await context.close();
      await db`delete from goals.goals where id = ${goal.id} and user_id = ${person.id}`;
    }
  });

  test("no goal open: one line and the way back to the goals", async ({
    person,
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      storageState: person.sessionFile,
      baseURL: baseURL!,
    });
    try {
      const page = await context.newPage();
      const response = await page.goto("/exportar");
      expect(response?.status()).toBe(200);
      await expect(
        page.getByText("No tienes metas abiertas. No hay nada que exportar."),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Descargar PDF" }),
      ).toHaveCount(0);
      await page.getByRole("link", { name: "Volver a Metas" }).click();
      await page.waitForURL(/\/metas/);
    } finally {
      await context.close();
    }
  });

  for (const [width, height] of [
    [360, 740],
    [390, 844],
    [1280, 800],
    [1440, 900],
  ] as const) {
    test(`stands in the shell at ${width}: one h1, the way back to Metas, the nav, and bare paper`, async ({
      person,
      browser,
      baseURL,
      db,
    }) => {
      const seeded = await seed(db, person);
      const context = await browser.newContext({
        storageState: person.sessionFile,
        baseURL: baseURL!,
        viewport: { width, height },
      });
      try {
        const page = await context.newPage();
        await page.goto("/exportar");
        await expect(page.getByRole("main").getByText(seeded.name, { exact: true })).toBeVisible();
        await expect(page.locator("h1")).toHaveCount(1);
        await expect(page.locator("h1")).toHaveText("Tu plan");

        const nav = page.getByRole("navigation");
        await expect(nav).toBeVisible();
        await expect(
          nav.locator("a[aria-current='page']").first(),
        ).toHaveText(/Metas/);
        if (width >= 1024) {
          const box = await page.getByRole("main").boundingBox();
          expect(box!.width).toBeGreaterThan(640);
        }

        const back = page.getByRole("link", { name: "Volver a Metas" });
        await expect(back).toBeVisible();

        await page.emulateMedia({ media: "print" });
        await expect(back).toBeHidden();
        await expect(nav).toBeHidden();
        await expect(page).toHaveTitle(
          `${exportMessages.printBrand} · ${civilDateShort(todayInZone())}`,
        );
        await page.emulateMedia({ media: "screen" });

        await back.click();
        await page.waitForURL(/\/metas$/);
      } finally {
        await context.close();
        await db`delete from goals.goals where id = ${seeded.goalId} and user_id = ${person.id}`;
      }
    });
  }

  // `ReporteFuenteCaida` (module 578, RNP-04): the notice is the report's own
  // sentence, every goal still says what it measures and until when, and only
  // the goal a down source feeds adds that its figure is what was declared.
  async function seedDown(db: postgres.Sql, person: Person) {
      const stamp = Date.now();
      const today = todayInZone();
      const monthStart = `${today.slice(0, 7)}-01`;
      const fedName = `Leer en inglés ${stamp}`;
      const plainName = `Correr 10K ${stamp}`;
      const [fed] = await db<{ id: string }[]>`
        insert into goals.goals (user_id, name, horizon, measure_name, measure_unit, created_at)
        values (${person.id}, ${fedName}, ${plusDays(50)}, 'búsquedas', 'searches', now() - interval '20 days')
        returning id
      `;
      const [evidence] = await db<{ id: string }[]>`
        insert into goals.commitments
          (user_id, goal_id, name, cadence_kind, satisfaction, source_id, threshold, created_at)
        values (
          ${person.id}, ${fed.id}, ${`Buscar ${stamp}`}, 'daily', 'evidence',
          (select id from goals.evidence_sources where key = 'reading_lookups'), 1,
          now() - interval '20 days'
        ) returning id
      `;
      void evidence;
      const [declared] = await db<{ id: string }[]>`
        insert into goals.commitments
          (user_id, goal_id, name, cadence_kind, satisfaction, target_quantity, unit, created_at)
        values (${person.id}, ${fed.id}, ${`Dicho ${stamp}`}, 'daily', 'quantity', 1, 'searches', now() - interval '20 days')
        returning id
      `;
      await db`
        insert into goals.facts (user_id, goal_id, commitment_id, day, quantity)
        values (${person.id}, ${fed.id}, ${declared.id}, ${today}::date, 4)
      `;
      const [plain] = await db<{ id: string }[]>`
        insert into goals.goals (user_id, name, horizon, measure_name, measure_unit, created_at)
        values (${person.id}, ${plainName}, ${plusDays(70)}, 'km', 'km', now() - interval '20 days')
        returning id
      `;
      await db`
        insert into goals.month_budgets (user_id, goal_id, month, amount)
        values (${person.id}, ${plain.id}, ${monthStart}::date, 40)
      `;
      return { fed, plain, fedName, plainName };
  }

  async function openDown(
    browser: import("@playwright/test").Browser,
    person: Person,
    width: number,
  ) {
    const context = await browser.newContext({
      storageState: person.sessionFile,
      baseURL: FAULT!,
      viewport: { width, height: 900 },
    });
    const page = await context.newPage();
    await page.goto("/exportar");
    return { context, page };
  }

  const DATE = String.raw`\d{1,2} de [a-záéíóú]+( de \d{4})?`;
  const panelOf = (page: import("@playwright/test").Page, name: string) =>
    page.getByRole("heading", { name, exact: true }).locator("xpath=ancestor::*[count(.//h2)=1][last()]");
  const needFault = () =>
    test.skip(!FAULT, "needs PULSAR_FAULT_BASE_URL, a next start with PULSAR_FAULT_SEAM set");

  for (const width of [390, 1440]) {
    test(`at ${width} the page says «No pudimos leer una fuente» once, the board's sentence, and never «diccionario»; no overflow`, async ({ person, browser, db }) => {
      needFault();
      const seeded = await seedDown(db, person);
      const { context, page } = await openDown(browser, person, width);
      try {
        await expect(page.getByRole("main").getByText(seeded.fedName, { exact: true })).toBeVisible();
        await expect(
          page.getByText(
            "No pudimos leer una fuente. Las cifras que salen de ella son solo lo que dijiste tú.",
            { exact: true },
          ),
        ).toHaveCount(1);
        expect(await page.locator("main").textContent()).not.toMatch(/diccionario/i);
        const sizes = await page.evaluate(() => [
          document.documentElement.scrollWidth,
          document.documentElement.clientWidth,
        ]);
        expect(sizes[0]).toBeLessThanOrEqual(sizes[1]);
      } finally {
        await context.close();
        await db`delete from goals.goals where id in (${seeded.fed.id}, ${seeded.plain.id}) and user_id = ${person.id}`;
      }
    });

    test(`at ${width} a goal no source feeds still reads «mide km · hasta el …» and adds nothing`, async ({ person, browser, db }) => {
      needFault();
      const seeded = await seedDown(db, person);
      const { context, page } = await openDown(browser, person, width);
      try {
        await expect(page.getByRole("main").getByText(seeded.plainName, { exact: true })).toBeVisible();
        const panel = panelOf(page, seeded.plainName);
        await expect(panel.getByText(new RegExp(`^mide km · hasta el ${DATE}$`))).toBeVisible();
        await expect(panel.getByText("solo lo que dijiste tú")).toHaveCount(0);
      } finally {
        await context.close();
        await db`delete from goals.goals where id in (${seeded.fed.id}, ${seeded.plain.id}) and user_id = ${person.id}`;
      }
    });

    test(`at ${width} the goal a down source feeds reads «mide … · hasta el … · solo lo que dijiste tú» and says it under its figure`, async ({ person, browser, db }) => {
      needFault();
      const seeded = await seedDown(db, person);
      const { context, page } = await openDown(browser, person, width);
      try {
        await expect(page.getByRole("main").getByText(seeded.fedName, { exact: true })).toBeVisible();
        const panel = panelOf(page, seeded.fedName);
        await expect(
          panel.getByText(new RegExp(`^mide búsquedas · hasta el ${DATE} · solo lo que dijiste tú$`)),
        ).toBeVisible();
        await expect(panel.getByText("solo lo que dijiste tú", { exact: true })).toHaveCount(1);
      } finally {
        await context.close();
        await db`delete from goals.goals where id in (${seeded.fed.id}, ${seeded.plain.id}) and user_id = ${person.id}`;
      }
    });
  }
});

// `Exportar.dc.html` (module 137, RP-49, RP-37): `/metas` offers the export
// beside the import under «el plan».
test.describe("the way in from /metas (RP-49, RP-37)", () => {
  test("«Exportar» opens the report; «Importar un plan» points at its page", async ({
    person,
    browser,
    baseURL,
    db,
  }) => {
    const seeded = await seed(db, person);
    const context = await browser.newContext({
      storageState: person.sessionFile,
      baseURL: baseURL!,
    });
    try {
      const page = await context.newPage();
      await page.goto("/metas");
      await expect(page.getByText("el plan", { exact: true })).toBeVisible();
      const exportLink = page.getByRole("link", { name: /^Exportar/ });
      await expect(exportLink).toContainText(
        "cómo va cada meta, en PDF",
      );
      const importLink = page.getByRole("link", { name: /^Importar un plan/ });
      await expect(importLink).toContainText(
        "pégalo o súbelo y revisa antes de crear",
      );
      await expect(importLink).toHaveAttribute("href", "/metas/importar");

      // Below «Abrir otra meta», «Importar un plan» before «Exportar»: the board's order.
      const order = await page
        .locator("main a")
        .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("href")));
      expect(order.indexOf("/metas/nueva")).toBeLessThan(
        order.indexOf("/exportar"),
      );
      expect(order.indexOf("/metas/importar")).toBeLessThan(
        order.indexOf("/exportar"),
      );

      await exportLink.click();
      await page.waitForURL(/\/exportar$/);
      await expect(page.getByRole("main").getByText(seeded.name, { exact: true })).toBeVisible();
      await expect(
        page.getByRole("main").getByText(seeded.taskName, { exact: true }),
      ).toBeVisible();
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
    const context = await browser.newContext({
      storageState: person.sessionFile,
      baseURL: baseURL!,
    });
    try {
      const page = await context.newPage();
      await page.goto("/metas");
      await expect(page).toHaveURL(/\/metas$/);
      await expect(
        page.getByRole("link", { name: /^Importar un plan/ }),
      ).toBeVisible();
      await expect(page.getByRole("link", { name: /^Exportar/ })).toHaveCount(
        0,
      );
    } finally {
      await context.close();
    }
  });
});

// Module 171 (RP-31, RP-32, RP-49, RP-35): what is owed, the goal's last day,
// the months whole, a head that says pulsar, and page 1 used.
test.describe("the report's figures and its paper (RP-31, RP-32, RP-49, RP-35)", () => {
  async function seedExtras(db: postgres.Sql, person: Person, seeded: Seed) {
    const stamp = Date.now();
    const today = todayInZone();
    const monthStart = `${today.slice(0, 7)}-01`;
    const noAmount = `Sin monto ${stamp}`;
    const doneChild = `Hija hecha ${stamp}`;
    const openChild = `Hija abierta ${stamp}`;
    await db`
      insert into goals.month_budgets (user_id, goal_id, month, amount)
      values (${person.id}, ${seeded.goalId}, (${monthStart}::date - interval '1 month')::date, 600)
    `;
    const [parent] = await db<{ id: string }[]>`
      insert into goals.one_offs (user_id, goal_id, name, planned_month)
      values (${person.id}, ${seeded.goalId}, ${noAmount}, (${monthStart}::date - interval '1 month')::date)
      returning id
    `;
    const [done] = await db<{ id: string }[]>`
      insert into goals.one_offs (user_id, goal_id, parent_id, name)
      values (${person.id}, ${seeded.goalId}, ${parent.id}, ${doneChild})
      returning id
    `;
    await db`
      insert into goals.one_offs (user_id, goal_id, parent_id, name)
      values (${person.id}, ${seeded.goalId}, ${parent.id}, ${openChild})
    `;
    await db`
      insert into goals.facts (user_id, goal_id, one_off_id, day)
      values (${person.id}, ${seeded.goalId}, ${done.id}, ${today}::date)
    `;
    return { noAmount, doneChild, openChild };
  }

  const longDate = (day: string) =>
    new Intl.DateTimeFormat("es-CO", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(civilDateToDate(day));

  const monthLong = (day: string) =>
    new Intl.DateTimeFormat("es-CO", { month: "long", timeZone: "UTC" }).format(
      civilDateToDate(day),
    );

  test("a goal reads its last day, never the day after; a carried task with no amount says no «debe»", async ({
    person,
    browser,
    baseURL,
    db,
  }) => {
    const seeded = await seed(db, person);
    const extras = await seedExtras(db, person, seeded);
    const context = await browser.newContext({
      storageState: person.sessionFile,
      baseURL: baseURL!,
    });
    try {
      const page = await context.newPage();
      await page.goto("/exportar");
      const horizon = plusDays(90);
      await expect(
        page.getByText(
          `mide minutos · hasta el ${longDate(dayBefore(horizon))}`,
        ),
      ).toBeVisible();
      await expect(
        page.getByText(`hasta el ${longDate(horizon)}`),
      ).toHaveCount(0);

      const lastMonth = monthLong(`${plusDays(-31).slice(0, 7)}-01`);
      const noAmount = page.getByText(extras.noAmount, { exact: true });
      await expect(noAmount).toBeVisible();
      await expect(noAmount.locator("xpath=following-sibling::p[1]")).toHaveText(
        `de ${lastMonth}`,
      );
      await expect(
        page.getByText(extras.openChild, { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(extras.doneChild, { exact: true }),
      ).toBeVisible();
      // The carried task with an amount says what it owes, at the row's end.
      await expect(page.getByText(`${exportMessages.owes.replace("{owes}", "45 min")}`, { exact: true })).toHaveCount(1);
      await expect(page.getByText(exportMessages.owes.replace("{owes}", "0"))).toHaveCount(0);
    } finally {
      await context.close();
      await db`delete from goals.goals where id = ${seeded.goalId} and user_id = ${person.id}`;
    }
  });

  test("RP-49 months: hecho against planned and estado on both faces, the closed month names where its share went", async ({
    person,
    browser,
    baseURL,
    db,
  }) => {
    const seeded = await seed(db, person);
    await seedExtras(db, person, seeded);
    const context = await browser.newContext({
      storageState: person.sessionFile,
      baseURL: baseURL!,
    });
    try {
      const wide = await context.newPage();
      await wide.setViewportSize({ width: 1280, height: 900 });
      await wide.goto("/exportar");
      const headers = wide
        .locator("table", { hasText: "estado" })
        .first()
        .locator("thead th");
      await expect(headers).toHaveText(["mes", "hecho", "estado"]);
      const closed = wide
        .locator("table tbody tr", { hasText: /\d+ % pasó a \p{L}+/u })
        .first();
      await expect(closed).toBeVisible();
      await expect(closed.locator("td").nth(1)).toContainText("de 10 h");
      await expect(closed.locator("td").nth(2)).toContainText("cerrado");
      // The month the share went to is the one after the closed month.
      const next = monthLong(todayInZone());
      await expect(closed.locator("td").nth(2)).toContainText(`pasó a ${next}`);
      await expect(
        wide
          .locator("table tbody tr[data-current]", { hasText: "en curso" })
          .first(),
      ).toBeVisible();
      await expect(
        wide.getByText(/· por mes$/).locator("visible=true"),
      ).toHaveCount(1);

      const phone = await context.newPage();
      await phone.setViewportSize({ width: 360, height: 740 });
      await phone.goto("/exportar");
      const note = phone
        .locator("ol li", { hasText: /\d+ % pasó a \p{L}+/u })
        .first();
      await expect(note).toBeVisible();
      await expect(note).toContainText("cerrado");
      await expect(
        phone
          .locator("ol li[data-current]", { hasText: /de 12 h/ })
          .first(),
      ).toContainText("en curso");
      await expect(
        phone.getByText(/^\d+ meses$/).locator("visible=true"),
      ).toHaveCount(1);
    } finally {
      await context.close();
      await db`delete from goals.goals where id = ${seeded.goalId} and user_id = ${person.id}`;
    }
  });

  test("RP-49 on paper: the head says pulsar with the year, the tasks sit under their goal, no week prints, every date has its year, page 1 is used", async ({
    person,
    browser,
    baseURL,
    db,
  }, testInfo) => {
    const first = await seed(db, person);
    await seedExtras(db, person, first);
    const second = await seed(db, person);
    await seedExtras(db, person, second);
    const context = await browser.newContext({
      storageState: person.sessionFile,
      baseURL: baseURL!,
    });
    try {
      const page = await context.newPage();
      await page.goto("/exportar");
      await expect(page.getByText(/^exportar · /)).toBeVisible();
      await page.emulateMedia({ media: "print" });
      const year = todayInZone().slice(0, 4);
      await expect(
        page.getByText(new RegExp(`^${exportMessages.printBrand} · .*${year}$`)),
      ).toBeVisible();
      await expect(
        page.getByText(/^exportar · /).locator("visible=true"),
      ).toHaveCount(0);

      const pdf = await page.pdf({ format: "A4" });
      const dir = resolve(process.cwd(), "private/export-pdf");
      mkdirSync(dir, { recursive: true });
      const file = resolve(dir, `171-${first.goalId}.pdf`);
      writeFileSync(file, pdf);
      const pages = Number(
        /Pages:\s+(\d+)/.exec(
          execFileSync("pdfinfo", [file], { encoding: "utf8" }),
        )![1],
      );
      const onFirst = execFileSync(
        "pdftotext",
        ["-f", "1", "-l", "1", file, "-"],
        { encoding: "utf8" },
      );
      testInfo.annotations.push({
        type: "a4-pages",
        description: String(pages),
      });
      expect(pages).toBe(A4_PAGES);
      // Page 1 holds the head and the first goal's name with its first section.
      expect(onFirst).toContain("Tu plan");
      expect(onFirst).toMatch(/Meta exportada \d+/);
      expect(onFirst.toLowerCase()).toContain("hasta hoy");

      // `-layout` keeps the table's reading order; the narrow label column wraps, so the text is read as one run.
      const all = execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" });
      const flat = all.replace(/\s+/g, " ");
      const from = flat.indexOf(first.name);
      const to = flat.indexOf(second.name);
      expect(from).toBeGreaterThanOrEqual(0);
      expect(to).toBeGreaterThan(from);
      const block = flat.slice(from, to);
      for (const task of [first.doneTask, first.monthTask, first.taskName]) {
        expect(block, task).toContain(task);
      }
      // Each note prints after its own task and before the next one.
      const at = (text: string) => block.indexOf(text);
      expect(at(first.monthTask)).toBeGreaterThan(at(first.childName));
      expect(at(first.monthNote)).toBeGreaterThan(at(first.monthTask));
      expect(at(first.monthNote)).toBeLessThan(at(first.doneTask));
      expect(at(first.doneNote)).toBeGreaterThan(at(first.doneTask));
      const months = [
        "enero", "febrero", "marzo", "abril", "mayo", "junio",
        "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
      ];
      // RP-49: only the months print; no week row reaches the sheet.
      expect(flat).not.toMatch(/sem \d+ ·/);
      // Every printed date carries its year: a day and its month are followed by one within a span.
      const dayMonth = new RegExp(`\\d{1,2} (?:de )?(?:${months.map((name) => name.slice(0, 3)).join("|")})[a-z]*`, "g");
      const bare = [...flat.matchAll(dayMonth)]
        .filter((found) => !/\d{4}/.test(flat.slice(found.index, found.index + found[0].length + 22)))
        .map((found) => flat.slice(found.index, found.index + 40));
      expect(bare).toEqual([]);
    } finally {
      await context.close();
      await db`delete from goals.goals where id = any(${[first.goalId, second.goalId]}) and user_id = ${person.id}`;
    }
  });

  test("RP-49 on paper loses nothing: every goal and every month row the screen shows is in the PDF, in its goal", async ({
    person,
    browser,
    baseURL,
    db,
  }) => {
    const first = await seed(db, person);
    await seedExtras(db, person, first);
    const second = await seed(db, person);
    await seedExtras(db, person, second);
    const context = await browser.newContext({
      storageState: person.sessionFile,
      baseURL: baseURL!,
      viewport: { width: 1280, height: 900 },
    });
    try {
      const page = await context.newPage();
      await page.goto("/exportar");
      const main = page.getByRole("main");
      const names = [first.name, second.name];
      for (const name of names) {
        await expect(main.getByRole("heading", { name, exact: true })).toHaveCount(1);
      }
      // On screen: per goal, the first column of its «mes» table.
      const onScreen: string[][] = [];
      for (const name of names) {
        const table = main
          .locator("section", { has: page.getByText(`${name} · por mes`, { exact: true }) })
          .locator("table", { has: page.locator("thead th", { hasText: /^mes$/ }) })
          .first();
        const labels = (await table.locator("tbody tr td:first-child").allTextContents()).map((label) => label.trim());
        expect(labels.length, `${name}: months on screen`).toBeGreaterThanOrEqual(4);
        onScreen.push(labels);
      }

      await page.emulateMedia({ media: "print" });
      const dir = resolve(process.cwd(), "private/export-pdf");
      mkdirSync(dir, { recursive: true });
      const file = resolve(dir, `379-completo-${first.goalId}.pdf`);
      writeFileSync(file, await page.pdf({ format: "A4" }));
      const lines = execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" })
        .split("\n")
        .map((line) => line.trim());

      // Each goal's heading is one line of its own; its months are the label lines up to the next goal.
      const at = names.map((name) => lines.indexOf(name));
      for (const [index, found] of at.entries()) expect(found, `${names[index]} heading in the PDF`).toBeGreaterThanOrEqual(0);
      expect(lines.filter((line) => names.includes(line))).toHaveLength(names.length);
      const label = /^[a-zñ]+ \d{4}$/;
      const printed = at.map((from, index) =>
        lines.slice(from, at[index + 1] ?? lines.length).filter((line) => label.test(line)),
      );
      expect(printed).toEqual(onScreen);
    } finally {
      await context.close();
      await db`delete from goals.goals where id = any(${[first.goalId, second.goalId]}) and user_id = ${person.id}`;
    }
  });
});

// Module 265 (RP-49): the head counts the goals that ended, an ended goal is
// named with its last day and goes last, and the page never overflows.
test.describe("the report's head, its ended goals and its width (RP-49)", () => {
  async function seedEnded(db: postgres.Sql, person: Person) {
    const name = `Meta terminada ${Date.now()}`;
    const [goal] = await db<{ id: string }[]>`
      insert into goals.goals (user_id, name, horizon, measure_name, measure_unit, created_at)
      values (${person.id}, ${name}, ${plusDays(-2)}, 'páginas', 'páginas', now() - interval '100 days')
      returning id
    `;
    return { id: goal.id, name, endedOn: plusDays(-3) };
  }

  const longDate = (day: string) =>
    new Intl.DateTimeFormat("es-CO", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(civilDateToDate(day));

  test("«N metas · M terminadas» counts the ended goal, which is named with its last day and listed after the live one", async ({
    person,
    browser,
    baseURL,
    db,
  }) => {
    const seeded = await seed(db, person);
    const ended = await seedEnded(db, person);
    const context = await browser.newContext({
      storageState: person.sessionFile,
      baseURL: baseURL!,
    });
    try {
      const page = await context.newPage();
      await page.goto("/exportar");
      await expect(page.getByText("2 metas · 1 terminada", { exact: true })).toBeVisible();
      await expect(page.getByRole("main").getByText(/metas? abiertas?/)).toHaveCount(0);
      await expect(
        page.getByText(`terminada el ${longDate(ended.endedOn)}`, { exact: true }),
      ).toBeVisible();
      await expect(page.getByText("al terminar", { exact: true })).toBeVisible();
      const names = await page
        .getByRole("main")
        .locator("h2")
        .allTextContents();
      expect(names.indexOf(seeded.name)).toBeGreaterThanOrEqual(0);
      expect(names.indexOf(ended.name)).toBeGreaterThan(names.indexOf(seeded.name));
    } finally {
      await context.close();
      await db`delete from goals.goals where id = any(${[seeded.goalId, ended.id]}) and user_id = ${person.id}`;
    }
  });

  for (const [width, columns] of [
    [1024, 2],
    [1280, 2],
    [1440, 2],
  ] as const) {
    test(`at ${width} the page does not overflow and the goals take ${columns} columns`, async ({
      person,
      browser,
      baseURL,
      db,
    }) => {
      const seeded = await seed(db, person);
      const context = await browser.newContext({
        storageState: person.sessionFile,
        baseURL: baseURL!,
        viewport: { width, height: 900 },
      });
      try {
        const page = await context.newPage();
        await page.goto("/exportar");
        await expect(page.getByRole("main").getByText(seeded.name, { exact: true })).toBeVisible();
        const sizes = await page.evaluate(() => ({
          page: [document.documentElement.scrollWidth, document.documentElement.clientWidth],
          main: [
            document.querySelector("main")!.scrollWidth,
            document.querySelector("main")!.clientWidth,
          ],
          // Whatever table or list is drawn stays inside the card that holds it.
          tableFits: (() => {
            let card = document.querySelector("main h2")!;
            while (getComputedStyle(card.parentElement!).display !== "grid") card = card.parentElement!;
            const cardBox = card.getBoundingClientRect();
            return [...card.querySelectorAll("table, ol")]
              .filter((node) => (node as HTMLElement).offsetParent !== null)
              .map((node) => {
                const box = node.getBoundingClientRect();
                return [box.left >= cardBox.left, box.right <= cardBox.right, node.scrollWidth <= node.clientWidth];
              })
              .flat()
              .every(Boolean);
          })(),
          columns: (() => {
            let node = document.querySelector("main h2")!.parentElement;
            while (node && getComputedStyle(node).display !== "grid") node = node.parentElement;
            return node ? getComputedStyle(node).gridTemplateColumns.split(" ").length : 0;
          })(),
        }));
        expect(sizes.page[0]).toBeLessThanOrEqual(sizes.page[1]);
        expect(sizes.main[0]).toBeLessThanOrEqual(sizes.main[1]);
        expect(sizes.columns).toBe(columns);
        expect(sizes.tableFits).toBe(true);
      } finally {
        await context.close();
        await db`delete from goals.goals where id = ${seeded.goalId} and user_id = ${person.id}`;
      }
    });
  }

  test("the phone page shows the month's tasks, done and not, with the carried one first", async ({
    person,
    browser,
    baseURL,
    db,
  }) => {
    const seeded = await seed(db, person);
    const context = await browser.newContext({
      storageState: person.sessionFile,
      baseURL: baseURL!,
      viewport: { width: 360, height: 740 },
    });
    try {
      const page = await context.newPage();
      await page.goto("/exportar");
      const main = page.getByRole("main");
      await expect(main.getByText(seeded.taskName, { exact: true })).toBeVisible();
      await expect(main.getByText(seeded.monthTask, { exact: true })).toBeVisible();
      await expect(main.getByText(seeded.doneTask, { exact: true })).toBeVisible();
      const order = await main
        .getByText(/^(Tarea arrastrada|Tarea del mes|Tarea hecha) \d+$/)
        .allTextContents();
      expect(order[0]).toBe(seeded.taskName);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      ).toBe(true);
    } finally {
      await context.close();
      await db`delete from goals.goals where id = ${seeded.goalId} and user_id = ${person.id}`;
    }
  });

  for (const width of [360, 1280]) {
    test(`at ${width} a sub-task's label starts to the right of its parent's`, async ({
      person,
      browser,
      baseURL,
      db,
    }) => {
      const seeded = await seed(db, person);
      const context = await browser.newContext({
        storageState: person.sessionFile,
        baseURL: baseURL!,
        viewport: { width, height: 900 },
      });
      try {
        const page = await context.newPage();
        await page.goto("/exportar");
        await settled(page);
        const main = page.getByRole("main");
        const parent = await main.getByText(seeded.taskName, { exact: true }).boundingBox();
        const child = await main.getByText(seeded.childName, { exact: true }).boundingBox();
        expect(parent).not.toBeNull();
        expect(child).not.toBeNull();
        expect(child!.x - parent!.x).toBeGreaterThanOrEqual(24);
      } finally {
        await context.close();
        await db`delete from goals.goals where id = ${seeded.goalId} and user_id = ${person.id}`;
      }
    });
  }

  // Opened on a Monday in the past, so week 5 (28 sep–4 oct) crosses two months
  // whatever day the suite runs; nothing is planned in any month.
  async function seedBoundary(db: postgres.Sql, person: Person) {
    const name = `Meta de frontera ${Date.now()}`;
    const [goal] = await db<{ id: string }[]>`
      insert into goals.goals (user_id, name, horizon, measure_name, measure_unit, created_at)
      values (${person.id}, ${name}, '2027-12-31', 'minutos', 'minutos', '2026-08-31 12:00:00-05')
      returning id
    `;
    const [commitment] = await db<{ id: string }[]>`
      insert into goals.commitments
        (user_id, goal_id, name, cadence_kind, satisfaction, target_quantity, unit, created_at)
      values (${person.id}, ${goal.id}, 'Sesión', 'daily', 'quantity', 30, 'minutos', '2026-08-31 12:00:00-05')
      returning id
    `;
    for (const [day, quantity] of [
      ["2026-09-29", 30],
      ["2026-10-02", 20],
    ] as const) {
      await db`
        insert into goals.facts (user_id, goal_id, commitment_id, day, quantity)
        values (${person.id}, ${goal.id}, ${commitment.id}, ${day}::date, ${quantity})
      `;
    }
    return { goalId: goal.id, name };
  }

  test("RP-49: a week crossing two months is one week in the fold, with the whole week's total", async ({
    person,
    browser,
    baseURL,
    db,
  }) => {
    const seeded = await seedBoundary(db, person);
    const context = await browser.newContext({
      storageState: person.sessionFile,
      baseURL: baseURL!,
      viewport: { width: 1280, height: 900 },
    });
    try {
      const page = await context.newPage();
      await page.goto("/exportar");
      await expect(page.getByRole("main").getByText(seeded.name, { exact: true })).toBeVisible();
      await page.locator("summary", { hasText: /^Ver las \d+ semanas$/ }).click();
      const rows = await page
        .getByRole("main")
        .locator("table tbody tr")
        .evaluateAll((nodes) =>
          nodes.map((node) => [...node.querySelectorAll("td")].map((cell) => (cell.textContent ?? "").trim())),
        );
      const split = rows.filter((cells) => /^sem 5 · /.test(cells[0]));
      expect(split.map((cells) => [cells[0], cells[1]])).toEqual([["sem 5 · 28 sep–4 oct 2026", "50 min"]]);
    } finally {
      await context.close();
      await db`delete from goals.goals where id = ${seeded.goalId} and user_id = ${person.id}`;
    }
  });

  test("RP-28: a goal with nothing planned prints no «de 0», on the screen and on paper", async ({
    person,
    browser,
    baseURL,
    db,
  }) => {
    const seeded = await seedBoundary(db, person);
    const context = await browser.newContext({
      storageState: person.sessionFile,
      baseURL: baseURL!,
      viewport: { width: 1280, height: 900 },
    });
    try {
      const page = await context.newPage();
      await page.goto("/exportar");
      await expect(page.getByRole("main").getByText(seeded.name, { exact: true })).toBeVisible();
      await expect(page.getByText("hasta hoy", { exact: true })).toBeVisible();
      // The block's own text: «de» and the figure may share no space in the DOM.
      const block = page.getByText("hasta hoy", { exact: true }).locator("xpath=..");
      await expect(block).toContainText("50 min");
      await expect(block).not.toContainText(/de\s*0/);

      await page.emulateMedia({ media: "print" });
      const file = resolve(process.cwd(), "private/export-pdf", `281-${seeded.goalId}.pdf`);
      mkdirSync(resolve(process.cwd(), "private/export-pdf"), { recursive: true });
      writeFileSync(file, await page.pdf({ format: "A4" }));
      const text = execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" });
      expect(text.toLowerCase()).toContain("hasta hoy");
      expect(text.replace(/\s+/g, " ")).not.toMatch(/\bde\s*0/);
    } finally {
      await context.close();
      await db`delete from goals.goals where id = ${seeded.goalId} and user_id = ${person.id}`;
    }
  });
});

test.describe("the report's type and space (module 317)", () => {
  for (const width of [360, 1280] as const) {
    test(`at ${width} sentences are Archivo, figures stay mono and sections keep the space system`, async ({
      person,
      browser,
      baseURL,
      db,
    }) => {
      const seeded = await seed(db, person);
      const context = await browser.newContext({
        storageState: person.sessionFile,
        baseURL: baseURL!,
        viewport: { width, height: 800 },
      });
      try {
        const page = await context.newPage();
        await page.goto("/exportar");
        await expect(page.getByRole("main").getByText(seeded.name, { exact: true })).toBeVisible();
        const family = (text: string | RegExp) =>
          page
            .getByRole("main")
            .getByText(text)
            .first()
            .evaluate((node) => getComputedStyle(node).fontFamily);
        // The goal's measure line and the count under the title are sentences.
        expect(await family(/^mide minutos · hasta el /)).not.toMatch(/mono/i);
        expect(await family(/^\d+ metas?$/)).not.toMatch(/mono/i);
        expect(await family(seeded.monthTask)).not.toMatch(/mono/i);
        // «de 12 h»: the sentence is Archivo around a mono figure.
        const planned = page.getByRole("main").getByText(/^de\s*12 h/).first();
        expect(await planned.evaluate((node) => getComputedStyle(node).fontFamily)).not.toMatch(
          /mono/i,
        );
        // A section's label sits 12 above its content; sections 32 apart.
        const gaps = await page.evaluate((goalName) => {
          const labels = [...document.querySelectorAll("main section > *:first-child")]
            .filter((node) => /^(este mes|hasta hoy|fases|tareas de)|· por mes$/.test(node.textContent ?? ""))
            .map((node) => ({
              text: node.textContent ?? "",
              label: node.getBoundingClientRect(),
              next: node.nextElementSibling?.getBoundingClientRect() ?? null,
              section: node.parentElement!.getBoundingClientRect(),
              after: node.parentElement!.nextElementSibling?.getBoundingClientRect() ?? null,
            }));
          return labels.map((entry) => ({
            own: entry.text.includes(goalName),
            inner: entry.next ? Math.round(entry.next.top - entry.label.bottom) : null,
            outer: entry.after ? Math.round(entry.after.top - entry.section.bottom) : null,
          }));
        }, seeded.name);
        // The seeded goal's own «<meta> · por mes» section is among those measured.
        expect(gaps.filter((gap) => gap.own).length).toBeGreaterThan(0);
        for (const gap of gaps) {
          if (gap.inner !== null) expect(gap.inner).toBe(12);
          if (gap.outer !== null) expect(gap.outer).toBe(32);
        }
      } finally {
        await context.close();
        await db`delete from goals.goals where id = ${seeded.goalId} and user_id = ${person.id}`;
      }
    });
  }
});

const MONTH_NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

// `ReporteFuenteCaida` with the source readable (module 578): the line is the
// same for every goal and carries nothing about a source.
test.describe("a readable source (module 578)", () => {
  test("every goal reads «mide … · hasta el …», fed or not, with no word about a source", async ({
    person,
    browser,
    baseURL,
    db,
  }) => {
    const stamp = Date.now();
    const goals: string[] = [];
    for (const [name, measure, unit] of [
      [`Leída ${stamp}`, "búsquedas", "searches"],
      [`Corrida ${stamp}`, "km", "km"],
    ]) {
      const [goal] = await db<{ id: string }[]>`
        insert into goals.goals (user_id, name, horizon, measure_name, measure_unit, created_at)
        values (${person.id}, ${name}, ${plusDays(60)}, ${measure}, ${unit}, now() - interval '10 days')
        returning id
      `;
      goals.push(goal.id);
    }
    await db`
      insert into goals.commitments
        (user_id, goal_id, name, cadence_kind, satisfaction, source_id, threshold, created_at)
      values (
        ${person.id}, ${goals[0]}, ${`Buscar ${stamp}`}, 'daily', 'evidence',
        (select id from goals.evidence_sources where key = 'reading_lookups'), 1,
        now() - interval '10 days'
      )
    `;
    const context = await browser.newContext({ storageState: person.sessionFile, baseURL: baseURL! });
    try {
      const page = await context.newPage();
      await page.goto("/exportar");
      await expect(page.getByRole("main").getByText(`Leída ${stamp}`, { exact: true })).toBeVisible();
      const date = String.raw`\d{1,2} de [a-záéíóú]+( de \d{4})?`;
      const panelOf = (name: string) =>
        page.getByRole("heading", { name, exact: true }).locator("xpath=ancestor::*[count(.//h2)=1][last()]");
      await expect(panelOf(`Leída ${stamp}`).getByText(new RegExp(`^mide búsquedas · hasta el ${date}$`))).toBeVisible();
      await expect(panelOf(`Corrida ${stamp}`).getByText(new RegExp(`^mide km · hasta el ${date}$`))).toBeVisible();
      const body = (await page.locator("main").textContent()) ?? "";
      expect(body).not.toMatch(/diccionario|alimentada|solo lo que dijiste tú|No pudimos leer/i);
    } finally {
      await context.close();
      for (const id of goals) await db`delete from goals.goals where id = ${id} and user_id = ${person.id}`;
    }
  });
});

// `ReporteTareaParte` (module 578, RP-54, user decision 2026-10-09): a task the
// plan splits shows the part that falls in this month and «sigue en <mes> ·
// <total> en total» under its name. There is no «viene de».
test.describe("a task split across months (module 578)", () => {
  const today = todayInZone();
  const next = (() => {
    const d = civilDateToDate(`${today.slice(0, 7)}-01`);
    d.setUTCMonth(d.getUTCMonth() + 1);
    return dateToCivilDate(d);
  })();
  const nextLabel = MONTH_NAMES[Number(next.slice(5, 7)) - 1];
  const SIGUE = new RegExp(`sigue en ${nextLabel}( de \\d{4})? · 10 h en total`);

  // 12 h a month, in plan order: 4 h, a 7 h parent of 1 h + 6 h, then a 10 h
  // task of which only the 1 h left in the month fits.
  async function seedSplit(db: postgres.Sql, person: Person) {
    const stamp = Date.now();
    const names = {
      whole: `Leer AI Engineering cap. 1–4 ${stamp}`,
      tutor: `Tutor ${stamp}`,
      long: `Construir un harness de evals ${stamp}`,
    };
    const [goal] = await db<{ id: string }[]>`
      insert into goals.goals (user_id, name, horizon, measure_name, measure_unit, rhythm, created_at)
      values (${person.id}, ${`IA aplicada ${stamp}`}, ${plusDays(150)}, 'minutos', 'minutos', 720, now() - interval '3 days')
      returning id
    `;
    await db`
      insert into goals.one_offs (user_id, goal_id, name, estimate, in_plan)
      values (${person.id}, ${goal.id}, ${names.whole}, 240, true)
    `;
    const [tutor] = await db<{ id: string }[]>`
      insert into goals.one_offs (user_id, goal_id, name, in_plan, note)
      values (${person.id}, ${goal.id}, ${names.tutor}, true, 'Preguntar por la tarifa por hora.')
      returning id
    `;
    await db`
      insert into goals.one_offs (user_id, goal_id, parent_id, name, estimate)
      values (${person.id}, ${goal.id}, ${tutor.id}, ${`Elegir tutor ${stamp}`}, 60)
    `;
    await db`
      insert into goals.one_offs (user_id, goal_id, parent_id, name, estimate)
      values (${person.id}, ${goal.id}, ${tutor.id}, ${`Sesiones 1–4 ${stamp}`}, 360)
    `;
    await db`
      insert into goals.one_offs (user_id, goal_id, name, estimate, in_plan)
      values (${person.id}, ${goal.id}, ${names.long}, 600, true)
    `;
    return { goalId: goal.id, goalName: `IA aplicada ${stamp}`, ...names };
  }

  const rowOf = (page: import("@playwright/test").Page, name: string) =>
    page
      .locator("main")
      .getByText(name, { exact: true })
      .and(page.locator(":visible"))
      .locator("xpath=ancestor::*[count(.//*[@role='img'])=1][last()]");

  for (const width of [390, 1440]) {
    test(`at ${width} the split task's row says 1 h and «sigue en», a whole one says its estimate and no «sigue en»`, async ({
      person,
      browser,
      baseURL,
      db,
    }) => {
      const seeded = await seedSplit(db, person);
      const context = await browser.newContext({
        storageState: person.sessionFile,
        baseURL: baseURL!,
        viewport: { width, height: 900 },
      });
      try {
        const page = await context.newPage();
        await page.goto("/exportar");
        await expect(page.getByRole("main").getByText(seeded.goalName, { exact: true })).toBeVisible();

        const split = rowOf(page, seeded.long);
        await expect(split).toContainText(SIGUE, { useInnerText: true });
        const splitText = (await split.innerText()).replace(/\s+/g, " ");
        expect(splitText.replace(/10 h en total/, "")).toMatch(/(^|\D)1 h\b/);
        expect(splitText.replace(/10 h en total/, "")).not.toMatch(/(^|\D)10 h\b/);

        const whole = rowOf(page, seeded.whole);
        await expect(whole).toContainText(/(^|\D)4 h\b/, { useInnerText: true });
        await expect(whole).not.toContainText(/sigue en/);

        const panel = page
          .getByRole("heading", { name: seeded.goalName, exact: true })
          .locator("xpath=ancestor::*[count(.//h2)=1][last()]");
        await expect(panel.getByText(/sigue en/)).toHaveCount(1);
        expect((await panel.innerText()) ?? "").not.toMatch(/viene de/i);
      } finally {
        await context.close();
        await db`delete from goals.goals where id = ${seeded.goalId} and user_id = ${person.id}`;
      }
    });
  }

  test("at 360 the split goal's page does not overflow", async ({ person, browser, baseURL, db }) => {
    const seeded = await seedSplit(db, person);
    const context = await browser.newContext({
      storageState: person.sessionFile,
      baseURL: baseURL!,
      viewport: { width: 360, height: 740 },
    });
    try {
      const page = await context.newPage();
      await page.goto("/exportar");
      await expect(rowOf(page, seeded.long)).toContainText(SIGUE, { useInnerText: true });
      const sizes = await page.evaluate(() => [
        document.documentElement.scrollWidth,
        document.documentElement.clientWidth,
        document.querySelector("main")!.scrollWidth,
        document.querySelector("main")!.clientWidth,
      ]);
      expect(sizes[0]).toBeLessThanOrEqual(sizes[1]);
      expect(sizes[2]).toBeLessThanOrEqual(sizes[3]);
    } finally {
      await context.close();
      await db`delete from goals.goals where id = ${seeded.goalId} and user_id = ${person.id}`;
    }
  });

  test("on paper the split task prints its part and «sigue en», never «viene de»", async ({
    person,
    browser,
    baseURL,
    db,
  }) => {
    const seeded = await seedSplit(db, person);
    const context = await browser.newContext({ storageState: person.sessionFile, baseURL: baseURL! });
    try {
      const page = await context.newPage();
      await page.goto("/exportar");
      await expect(page.getByRole("main").getByText(seeded.goalName, { exact: true })).toBeVisible();
      await page.emulateMedia({ media: "print" });
      const dir = resolve(process.cwd(), "private/export-pdf");
      mkdirSync(dir, { recursive: true });
      const file = resolve(dir, `578-${seeded.goalId}.pdf`);
      writeFileSync(file, await page.pdf({ format: "A4" }));
      const flat = execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" }).replace(/\s+/g, " ");
      const from = flat.indexOf(seeded.long);
      expect(from).toBeGreaterThanOrEqual(0);
      const row = flat.slice(from, from + 220);
      expect(row).toMatch(SIGUE);
      const rest = row.replace(/10 h en total/, "");
      expect(rest).toMatch(/(^|\D)1 h\b/);
      expect(rest).not.toMatch(/(^|\D)10 h\b/);
      expect(flat.slice(flat.indexOf(seeded.goalName))).not.toMatch(/viene de/i);
    } finally {
      await context.close();
      await db`delete from goals.goals where id = ${seeded.goalId} and user_id = ${person.id}`;
    }
  });
});

// Module 579 (RP-49, RP-17), `ReporteImpresoCompacto.dc.html`: on A4 the report spends the whole printable width,
// keeps a heading with what follows it, and three goals with no activity fit two pages.
test.describe("the report on A4, compact (module 579)", () => {
  const MONTH_NAMES = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
  ];

  type Planned = { goalId: string; name: string; months: string[] };

  // A goal that opens this month and runs `months` months, a planned amount in each, one open task and no activity.
  async function seedCompact(
    db: postgres.Sql,
    person: Person,
    spec: { name: string; measure: string; unit: string; months: number; amount: number },
  ): Promise<Planned> {
    const monthStart = `${todayInZone().slice(0, 7)}-01`;
    const starts: string[] = [];
    let cursor = monthStart;
    for (let i = 0; i < spec.months; i += 1) {
      starts.push(cursor);
      cursor = nextMonth(cursor);
    }
    const [goal] = await db<{ id: string }[]>`
      insert into goals.goals (user_id, name, horizon, measure_name, measure_unit, created_at)
      values (${person.id}, ${spec.name}, ${cursor}::date, ${spec.measure}, ${spec.unit}, now())
      returning id
    `;
    for (const month of starts) {
      await db`
        insert into goals.month_budgets (user_id, goal_id, month, amount)
        values (${person.id}, ${goal.id}, ${month}::date, ${spec.amount})
      `;
    }
    await db`
      insert into goals.one_offs (user_id, goal_id, name, planned_month)
      values (${person.id}, ${goal.id}, ${`Tarea abierta de ${spec.name}`}, ${monthStart}::date)
    `;
    const labels = starts.map(
      (month) => `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`,
    );
    return { goalId: goal.id, name: spec.name, months: labels };
  }

  // The board's three goals: 6 months of 12 h, 3 months of km, 2 months of searches.
  async function seedBoard(db: postgres.Sql, person: Person, stamp: number): Promise<Planned[]> {
    return [
      await seedCompact(db, person, { name: `IA aplicada ${stamp}`, measure: "minutos", unit: "minutos", months: 6, amount: 720 }),
      await seedCompact(db, person, { name: `Correr 10K ${stamp}`, measure: "km", unit: "km", months: 3, amount: 40 }),
      await seedCompact(db, person, { name: `Leer en inglés ${stamp}`, measure: "búsquedas", unit: "searches", months: 2, amount: 30 }),
    ];
  }

  async function savePdf(page: import("@playwright/test").Page, label: string): Promise<string> {
    const dir = resolve(process.cwd(), "private/export-pdf");
    mkdirSync(dir, { recursive: true });
    const file = resolve(dir, `579-${label}-${Date.now()}.pdf`);
    writeFileSync(file, await page.pdf({ format: "A4" }));
    return file;
  }

  function pageCount(file: string): number {
    return Number(/Pages:\s+(\d+)/.exec(execFileSync("pdfinfo", [file], { encoding: "utf8" }))![1]);
  }

  // One entry per page: its lines, trimmed, blanks dropped.
  function pageLines(file: string): string[][] {
    return Array.from({ length: pageCount(file) }, (_, index) =>
      execFileSync("pdftotext", ["-layout", "-f", String(index + 1), "-l", String(index + 1), file, "-"], {
        encoding: "utf8",
      })
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== ""),
    );
  }

  async function open(
    browser: import("@playwright/test").Browser,
    baseURL: string,
    person: Person,
  ) {
    const context = await browser.newContext({
      storageState: person.sessionFile,
      baseURL,
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    await page.goto("/exportar");
    await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toBeVisible();
    await page.emulateMedia({ media: "print" });
    return { context, page };
  }

  test("three goals with no activity, as on the board, print on two A4 pages", async ({
    person,
    browser,
    baseURL,
    db,
  }, testInfo) => {
    const goals = await seedBoard(db, person, Date.now());
    const { context, page } = await open(browser, baseURL!, person);
    try {
      for (const goal of goals) {
        await expect(page.getByRole("heading", { name: goal.name, exact: true })).toHaveCount(1);
      }
      const file = await savePdf(page, "paginas");
      const pages = pageCount(file);
      testInfo.annotations.push({ type: "a4-pages", description: String(pages) });
      expect(pages, `pages of the board's three goals (${file})`).toBeLessThanOrEqual(2);
      // Fewer pages by dropping a goal would pass the count: every goal and every month must still print.
      const text = pageLines(file).flat();
      for (const goal of goals) {
        expect(text, goal.name).toContain(goal.name);
        for (const label of goal.months) expect(text.filter((line) => line.startsWith(label)).length, `${goal.name} ${label}`).toBeGreaterThanOrEqual(1);
      }
    } finally {
      await context.close();
      await db`delete from goals.goals where id = any(${goals.map((goal) => goal.goalId)}) and user_id = ${person.id}`;
    }
  });

  test("in print each goal block and each table take 95 % of the printable width, with no rail column", async ({
    person,
    browser,
    baseURL,
    db,
  }) => {
    const goals = await seedBoard(db, person, Date.now());
    const { context, page } = await open(browser, baseURL!, person);
    try {
      const available = await page.evaluate(() => document.documentElement.clientWidth);
      const widths = await page.evaluate((names) => {
        const out: { what: string; width: number }[] = [];
        for (const name of names) {
          const heading = [...document.querySelectorAll("h2")].find((node) => node.textContent === name)!;
          out.push({ what: `block of ${name}`, width: heading.closest("section")!.getBoundingClientRect().width });
          const label = [...document.querySelectorAll("section")].find((node) =>
            (node.textContent ?? "").startsWith(`${name} · por mes`),
          );
          const table = (label ?? heading.closest("section")!).querySelector("table");
          out.push({ what: `table of ${name}`, width: table?.getBoundingClientRect().width ?? 0 });
        }
        return out;
      }, goals.map((goal) => goal.name));
      for (const { what, width } of widths) {
        expect(width / available, `${what}: ${Math.round(width)} of ${available} px`).toBeGreaterThanOrEqual(0.95);
      }
    } finally {
      await context.close();
      await db`delete from goals.goals where id = any(${goals.map((goal) => goal.goalId)}) and user_id = ${person.id}`;
    }
  });

  // Goals of different heights put the page foot in different places; each «por mes» label must land with its first row.
  test("a «por mes» label is on the page of its first row, and no page ends on a heading, a label or a table head", async ({
    person,
    browser,
    baseURL,
    db,
  }) => {
    const stamp = Date.now();
    const goals: Planned[] = [];
    for (const [index, months] of [6, 3, 2, 14, 9, 12, 5, 8].entries()) {
      goals.push(
        await seedCompact(db, person, {
          name: `Altura ${stamp} n${index}`,
          measure: "minutos",
          unit: "minutos",
          months,
          amount: 720,
        }),
      );
    }
    const { context, page } = await open(browser, baseURL!, person);
    try {
      const file = await savePdf(page, "encabezado");
      const pages = pageLines(file);
      const monthRow = new RegExp(`^(${MONTH_NAMES.join("|")}) \\d{4}\\b`);
      for (const goal of goals) {
        const at = pages.findIndex((lines) => lines.some((line) => line.toLowerCase() === `${goal.name} · por mes`.toLowerCase()));
        expect(at, `${goal.name}: «por mes» label in the PDF`).toBeGreaterThanOrEqual(0);
        const lines = pages[at];
        const after = lines.slice(lines.findIndex((line) => line.toLowerCase() === `${goal.name} · por mes`.toLowerCase()) + 1);
        expect(
          after.some((line) => line.startsWith(goal.months[0]) || monthRow.test(line)),
          `${goal.name}: label on page ${at + 1} of ${pages.length}, its first row is not there`,
        ).toBe(true);
      }
      const orphan = new RegExp(
        `^(${goals.map((goal) => goal.name).join("|")})( · por mes)?$|^(este mes|hasta hoy|al terminar|fases|tareas de)|^mes\\b.*\\bhecho|^\\d+ meses?$`,
        "i",
      );
      for (const [index, lines] of pages.entries()) {
        if (index === pages.length - 1) continue;
        expect(lines.at(-1), `page ${index + 1} of ${pages.length} ends on «${lines.at(-1)}»`).not.toMatch(orphan);
      }
    } finally {
      await context.close();
      await db`delete from goals.goals where id = any(${goals.map((goal) => goal.goalId)}) and user_id = ${person.id}`;
    }
  });

  test("a long table breaks between rows: every month row is whole on one page, none lost, and some table runs onto the next page", async ({
    person,
    browser,
    baseURL,
    db,
  }) => {
    const stamp = Date.now();
    const goals: Planned[] = [];
    for (let index = 0; index < 5; index += 1) {
      goals.push(
        await seedCompact(db, person, {
          name: `Larga ${stamp} n${index}`,
          measure: "minutos",
          unit: "minutos",
          months: 14,
          amount: 720,
        }),
      );
    }
    const { context, page } = await open(browser, baseURL!, person);
    try {
      const file = await savePdf(page, "tabla-larga");
      const pages = pageLines(file);
      // Every line of the PDF with the page it is on, so a goal's rows are read between its label and the next goal.
      const run = pages.flatMap((lines, index) => lines.map((line) => ({ line, page: index })));
      const lowered = (goal: Planned) => `${goal.name} · por mes`.toLowerCase();
      let split = 0;
      for (const [position, goal] of goals.entries()) {
        const from = run.findIndex((entry) => entry.line.toLowerCase() === lowered(goal));
        expect(from, `${goal.name}: label in the PDF`).toBeGreaterThanOrEqual(0);
        const next = goals[position + 1];
        const until = next ? run.findIndex((entry) => entry.line === next.name) : run.length;
        const span = run.slice(from, until < 0 ? run.length : until);
        const where: number[] = [];
        for (const label of goal.months) {
          const found = span.filter((entry) => entry.line.startsWith(label));
          expect(found.length, `${goal.name} ${label}: lines starting with it`).toBe(1);
          // The label prints on a line of its own and its cells on the next line: a row cut in two leaves them on another page.
          const at = span.indexOf(found[0]);
          const cells = span.slice(at + 1, at + 2);
          expect(cells.length, `${goal.name} ${label}: cells after its label`).toBe(1);
          expect(
            cells.map((cell) => cell.page),
            `${goal.name} ${label}: label on page ${found[0].page + 1}, cells on ${cells.map((cell) => cell.page + 1)}`,
          ).toEqual([found[0].page]);
          where.push(found[0].page);
        }
        // The rows keep their order across pages.
        expect([...where].sort((a, b) => a - b)).toEqual(where);
        if (new Set(where).size > 1) split += 1;
      }
      expect(split, `tables of 14 rows that ran onto a second page (${pages.length} pages, ${file})`).toBeGreaterThanOrEqual(1);
    } finally {
      await context.close();
      await db`delete from goals.goals where id = any(${goals.map((goal) => goal.goalId)}) and user_id = ${person.id}`;
    }
  });
});
