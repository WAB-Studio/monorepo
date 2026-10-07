import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { test, expect, type Person } from "./fixtures";
import { civilDateToDate, dateToCivilDate, todayInZone } from "@/lib/zone";
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
});
