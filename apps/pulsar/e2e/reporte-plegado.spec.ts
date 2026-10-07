import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { test, expect, type Person } from "./fixtures";
import { civilDateToDate, dateToCivilDate, todayInZone } from "@/lib/zone";
import type { Browser, Page } from "@playwright/test";
import type postgres from "postgres";

// `ReportePlegado.dc.html` and `ReporteImpresoMeses.dc.html` (module 379, RP-49):
// on screen a goal's weeks sit folded under its months; on paper only the months print,
// and a section runs on across pages between its rows.

function plusDays(days: number): string {
  const date = civilDateToDate(todayInZone());
  date.setUTCDate(date.getUTCDate() + days);
  return dateToCivilDate(date);
}

// Long enough that the month's tasks cannot fit page 1 after the head and the first sections.
const LONG_NOTE = Array.from({ length: 400 }, (_, i) => `n${String(i).padStart(3, "0")}`)
  .join(" ")
  .slice(0, 2000);

async function seed(db: postgres.Sql, person: Person) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const today = todayInZone();
  const monthStart = `${today.slice(0, 7)}-01`;
  const name = `Meta plegada ${stamp}`;
  const [goal] = await db<{ id: string }[]>`
    insert into goals.goals (user_id, name, horizon, measure_name, measure_unit, created_at)
    values (${person.id}, ${name}, ${plusDays(90)}, 'minutos', 'minutos', now() - interval '70 days')
    returning id
  `;
  await db`
    insert into goals.month_budgets (user_id, goal_id, month, amount)
    values (${person.id}, ${goal.id}, ${monthStart}::date, 720),
           (${person.id}, ${goal.id}, (${monthStart}::date - interval '1 month')::date, 600)
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
    values (${person.id}, ${goal.id}, ${`Tarea ${stamp}`}, ${monthStart}::date, ${LONG_NOTE})
    returning id
  `;
  await db`
    insert into goals.one_offs (user_id, goal_id, parent_id, name, estimate, note)
    values (${person.id}, ${goal.id}, ${task.id}, ${`Subtarea ${stamp}`}, 45, ${LONG_NOTE})
  `;
  return { goalId: goal.id, name };
}

const remove = (db: postgres.Sql, person: Person, ids: string[]) =>
  db`delete from goals.goals where id = any(${ids}) and user_id = ${person.id}`;

test.describe("the report folds its weeks (RP-49)", () => {
  for (const width of [360, 1280] as const) {
    test(`at ${width} the weeks are folded by default, the count is real and «en curso» keeps one line`, async ({
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
        const main = page.getByRole("main");
        await expect(main.getByText(seeded.name, { exact: true })).toBeVisible();
        // The label and the table the board draws.
        await expect(main.getByText(`${seeded.name} · por mes`, { exact: true })).toBeVisible();
        if (width === 1280) {
          await expect(main.locator("table thead").first().locator("th")).toHaveText(["mes", "hecho", "estado"]);
        }
        await expect(main.getByText("por semana", { exact: true })).toBeVisible();
        await expect(main.getByText(/^Esta semana: .*\.$/)).toBeVisible();

        const status = main.getByText("en curso", { exact: true }).locator("visible=true").first();
        await expect(status).toBeVisible();
        const lines = await status.evaluate((node) => {
          const style = getComputedStyle(node);
          return node.getBoundingClientRect().height / parseFloat(style.lineHeight);
        });
        expect(lines, "«en curso» on one line").toBeLessThan(1.5);

        // Closed by default: the link-card says how many, no week row is visible.
        const fold = main.locator("summary", { hasText: /^Ver las \d+ semanas$/ });
        await expect(fold).toBeVisible();
        const count = Number(/\d+/.exec((await fold.textContent()) ?? "")![0]);
        const weekRow = main.getByText(/^sem \d+ · /).locator("visible=true");
        await expect(weekRow).toHaveCount(0);

        await fold.click();
        await expect(weekRow.first()).toBeVisible();
        // A week crossing two months is one week: the count the card promised.
        const labels = await weekRow.allTextContents();
        expect(new Set(labels.map((label) => /^sem (\d+)/.exec(label)![1])).size).toBe(count);
        expect(labels).toHaveLength(count);
      } finally {
        await context.close();
        await remove(db, person, [seeded.goalId]);
      }
    });
  }

  test("on paper no week prints, «en curso» keeps one line and page 1 is used to its foot", async ({
    person,
    browser,
    baseURL,
    db,
  }) => {
    const first = await seed(db, person);
    const second = await seed(db, person);
    const context = await browser.newContext({
      storageState: person.sessionFile,
      baseURL: baseURL!,
    });
    try {
      const page = await context.newPage();
      await page.goto("/exportar");
      await expect(page.getByRole("main").getByText(first.name, { exact: true })).toBeVisible();
      // Open on screen: the print rule, not the fold's state, keeps the weeks off the sheet.
      for (const summary of await page.locator("summary", { hasText: /^Ver las \d+ semanas$/ }).all()) {
        await summary.click();
      }
      await expect(page.getByText(/^sem \d+ · /).locator("visible=true").first()).toBeVisible();

      await page.emulateMedia({ media: "print" });
      await expect(page.getByText(/^sem \d+ · /).locator("visible=true")).toHaveCount(0);
      await expect(page.getByText("por semana", { exact: true }).locator("visible=true")).toHaveCount(0);
      await expect(page.locator("summary").locator("visible=true")).toHaveCount(0);
      const status = page.getByText("en curso", { exact: true }).locator("visible=true").first();
      const lines = await status.evaluate((node) => {
        const style = getComputedStyle(node);
        return node.getBoundingClientRect().height / parseFloat(style.lineHeight);
      });
      expect(lines, "«en curso» on one line").toBeLessThan(1.5);

      const dir = resolve(process.cwd(), "private/export-pdf");
      mkdirSync(dir, { recursive: true });
      const file = resolve(dir, `379-${first.goalId}.pdf`);
      writeFileSync(file, await page.pdf({ format: "A4" }));
      const text = execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" });
      expect(text).not.toMatch(/sem \d+ ·/);
      expect(text).not.toContain("Ver las");
      expect(text.toLowerCase()).toContain(`${first.name} · por mes`.toLowerCase());

      // Page 1's last word sits in the lower quarter of the sheet: no section jumped a page and left a gap.
      const box = execFileSync("pdftotext", ["-bbox", "-f", "1", "-l", "1", file, "-"], { encoding: "utf8" });
      const height = Number(/<page width="[\d.]+" height="([\d.]+)"/.exec(box)![1]);
      const bottoms = [...box.matchAll(/yMax="([\d.]+)"/g)].map((found) => Number(found[1]));
      const last = Math.max(...bottoms);
      expect(last, `page 1 ends at ${last} of ${height}`).toBeGreaterThanOrEqual(height * 0.75);
    } finally {
      await context.close();
      await remove(db, person, [first.goalId, second.goalId]);
    }
  });

  // `pdftotext -bbox` words of the printed report, page by page, grouped into lines.
  type Line = { page: number; top: number; bottom: number; text: string };
  function printedLines(file: string): Line[] {
    const box = execFileSync("pdftotext", ["-bbox", file, "-"], { encoding: "utf8" });
    const lines: Line[] = [];
    let page = 0;
    const words: { page: number; x: number; top: number; bottom: number; text: string }[] = [];
    for (const raw of box.split("\n")) {
      if (raw.includes("<page ")) page += 1;
      const found = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="[\d.]+" yMax="([\d.]+)">(.*)<\/word>/.exec(raw);
      if (found) {
        words.push({ page, x: Number(found[1]), top: Number(found[2]), bottom: Number(found[3]), text: found[4] });
      }
    }
    for (const word of words.sort((a, b) => a.page - b.page || a.top - b.top || a.x - b.x)) {
      const last = lines[lines.length - 1];
      if (last && last.page === word.page && Math.abs(last.top - word.top) < 2) {
        last.text += ` ${word.text}`;
        last.bottom = Math.max(last.bottom, word.bottom);
      } else {
        lines.push({ page: word.page, top: word.top, bottom: word.bottom, text: word.text });
      }
    }
    return lines;
  }

  // Past months, every row with a label, a long figure that wraps, a planned figure and «cerrado».
  async function seedMonths(db: postgres.Sql, person: Person, name: string, months: number, unit: string) {
    const today = todayInZone();
    const [goal] = await db<{ id: string }[]>`
      insert into goals.goals (user_id, name, horizon, measure_name, measure_unit, created_at)
      values (${person.id}, ${name}, ${plusDays(60)}, ${unit}, ${unit},
              (date_trunc('month', ${today}::date) - (${months} || ' months')::interval + interval '3 days'))
      returning id
    `;
    await db`
      insert into goals.month_budgets (user_id, goal_id, month, amount)
      select ${person.id}, ${goal.id}, (date_trunc('month', ${today}::date) - (n || ' months')::interval)::date, 777
      from generate_series(1, ${months}) n
    `;
    return goal.id;
  }

  async function printTo(page: Page, file: string): Promise<Line[]> {
    await page.emulateMedia({ media: "print" });
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, await page.pdf({ format: "A4" }));
    return printedLines(file);
  }

  const MONTH_LABEL = /^(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre) \d{4}$/;
  const LONG_UNIT = "capítulos del manual avanzado";

  test("on paper a month's row never breaks: its label, its figures and its estado land on one page", async ({
    person,
    browser,
    baseURL,
    db,
  }) => {
    const stamp = Date.now();
    const goalId = await seedMonths(db, person, `Meta larga ${stamp}`, 40, LONG_UNIT);
    const context = await browser.newContext({ storageState: person.sessionFile, baseURL: baseURL! });
    try {
      const page = await context.newPage();
      await page.goto("/exportar");
      await expect(page.getByRole("main").getByText(`Meta larga ${stamp}`, { exact: true })).toBeVisible();
      const lines = await printTo(page, resolve(process.cwd(), "private/export-pdf", `379-filas-${goalId}.pdf`));
      const pages = Math.max(...lines.map((line) => line.page));
      expect(pages, "the table crosses several pages").toBeGreaterThan(2);

      // Every row is one label, one «cerrado» and one planned figure («777»): a row cut by a
      // page leaves a page with more of one than of another.
      const closedLabels = new Set(
        Array.from({ length: 40 }, (_, i) => {
          const day = civilDateToDate(`${todayInZone().slice(0, 7)}-01`);
          day.setUTCMonth(day.getUTCMonth() - (i + 1));
          return new Intl.DateTimeFormat("es-CO", { month: "long", year: "numeric", timeZone: "UTC" })
            .format(day)
            .replace(" de ", " ");
        }),
      );
      const rowsOn = (n: number) => {
        const on = lines.filter((line) => line.page === n);
        const count = (test: (text: string) => boolean) => on.filter((line) => test(line.text)).length;
        return {
          labels: count((text) => closedLabels.has(text)),
          closed: on.flatMap((line) => line.text.split(" ")).filter((word) => word === "cerrado").length,
          planned: on.flatMap((line) => line.text.split(" ")).filter((word) => word === "777").length,
        };
      };
      let labelsTotal = 0;
      for (let n = 1; n <= pages; n += 1) {
        const found = rowsOn(n);
        labelsTotal += found.labels;
        expect(found.closed, `page ${n}: «cerrado» per label`).toBe(found.labels);
        expect(found.planned, `page ${n}: planned figure per label`).toBe(found.labels);
      }
      expect(labelsTotal).toBe(40);
    } finally {
      await context.close();
      await remove(db, person, [goalId]);
    }
  });

  // Fourteen goals of different lengths: the page boundaries fall at every height of a section.
  const SWEEP = [9, 4, 13, 6, 11, 3, 15, 8, 5, 12, 7, 10, 2, 14];

  async function sweepOnPaper(
    { person, browser, baseURL, db }: { person: Person; browser: Browser; baseURL: string | undefined; db: postgres.Sql },
    check: (lines: Line[], names: string[]) => void,
  ) {
    const stamp = Date.now();
    const goals = await Promise.all(
      SWEEP.map(async (months, i) => {
        const name = `Meta ${String.fromCharCode(65 + i)} ${stamp}`;
        return { name, id: await seedMonths(db, person, name, months, "minutos") };
      }),
    );
    const context = await browser.newContext({ storageState: person.sessionFile, baseURL: baseURL! });
    try {
      const page = await context.newPage();
      await page.goto("/exportar");
      await expect(page.getByRole("main").getByText(goals[0].name, { exact: true }).first()).toBeVisible();
      const lines = await printTo(page, resolve(process.cwd(), "private/export-pdf", `379-rotulos-${stamp}.pdf`));
      expect(Math.max(...lines.map((line) => line.page)), "the report crosses several pages").toBeGreaterThan(2);
      check(
        lines,
        goals.map((goal) => goal.name),
      );
    } finally {
      await context.close();
      await remove(db, person, goals.map((goal) => goal.id));
    }
  }

  const SECTION_LABEL = /^(este mes · |hasta hoy$|fases$|tareas de |al terminar$)|· por mes$/i;

  test("on paper a goal's heading and a section label are never the last line of a page", async ({ person, browser, baseURL, db }) => {
    await sweepOnPaper({ person, browser, baseURL, db }, (lines, names) => {
      const heading = new RegExp(`^(${names.join("|")})$`);
      let checked = 0;
      for (const [index, line] of lines.entries()) {
        if (!heading.test(line.text) && !SECTION_LABEL.test(line.text)) continue;
        checked += 1;
        expect(lines[index + 1]?.page, `«${line.text}» ends page ${line.page}`).toBe(line.page);
      }
      // A heading, «este mes», «hasta hoy» and «por mes» for each goal.
      expect(checked).toBe(names.length * 4);
    });
  });

  test("on paper a «por mes» label sits on the page of its first month", async ({ person, browser, baseURL, db }) => {
    await sweepOnPaper({ person, browser, baseURL, db }, (lines) => {
      let checked = 0;
      for (const [index, line] of lines.entries()) {
        if (!/· por mes$/i.test(line.text)) continue;
        checked += 1;
        const firstRow = lines.slice(index + 1).find((later) => MONTH_LABEL.test(later.text));
        expect(firstRow?.page, `«${line.text}» is parted from its first month`).toBe(line.page);
      }
      expect(checked).toBe(SWEEP.length);
    });
  });
});
