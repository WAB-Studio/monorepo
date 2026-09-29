import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import type postgres from "postgres";

import { test, expect, laneNumber } from "./fixtures";

// Seeded by `harness:seed-goal`, the one goal this identity always carries
// (`compromiso.spec.ts`'s own constant, word for word) — this suite never
// touches it, only ever the second goal it opens beside it.
const SEEDED_GOAL_NAME = "Inglés B1/B2 → B2+ laboral";

async function deleteGoal(db: postgres.Sql, personId: string, goalId: string): Promise<void> {
  await db`delete from goals.goals where id = ${goalId} and user_id = ${personId}`;
}

test("the Meta tab opens the goals list, and a second goal is opened from it, not typed (RP-11)", async ({
  page,
  db,
  personId,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Meta" }).click();
  await page.waitForURL("**/metas");

  // The seeded goal is already listed — this list never redirects past it —
  // and its own way to open a second sits under it.
  await expect(page.getByRole("link", { name: SEEDED_GOAL_NAME })).toBeVisible();
  const addAnother = page.getByRole("link", { name: "Abrir otra meta" });
  await expect(addAnother).toBeVisible();
  await expect(addAnother).toHaveAttribute("href", "/metas/nueva");

  const goalName = `Meta segunda ${Date.now()}`;
  // The same form `compromiso.spec.ts`'s own `createGoal` drives, reached
  // here by the tap this module adds rather than by a bare `page.goto`.
  await addAnother.click();
  await page.waitForURL("**/metas/nueva");
  await page.getByLabel("nombre").fill(goalName);
  await page.getByRole("button", { name: "Abrirla" }).click();
  await page.waitForURL(/\/metas\/[0-9a-f-]{36}$/);
  const goalId = page.url().split("/metas/")[1];

  try {
    // The list, with two: neither redirected past, both their own row.
    await page.goto("/metas");
    await expect(page.getByRole("link", { name: SEEDED_GOAL_NAME })).toBeVisible();
    await expect(page.getByRole("link", { name: goalName })).toBeVisible();
    await expect(page.getByRole("link", { name: "Abrir otra meta" })).toBeVisible();

    // Both open goals draw on the day (§0.3, 5), grouped, with no selector —
    // the newly opened one included, even with no commitment of its own yet.
    await page.goto("/");
    await expect(page.getByText(SEEDED_GOAL_NAME, { exact: true })).toBeVisible();
    await expect(page.getByText(goalName, { exact: true })).toBeVisible();

    // Its own screen has a quiet way back to the list: the bottom nav's own
    // "Meta" tab, already mounted on every signed-in screen, never a second
    // link this module adds.
    await page.goto(`/metas/${goalId}`);
    await page.getByRole("link", { name: "Meta" }).click();
    await page.waitForURL("**/metas");
    await expect(page.getByRole("link", { name: goalName })).toBeVisible();
  } finally {
    await deleteGoal(db, personId, goalId);
  }
});

// A goal-less state is reachable only from a person with none, and this
// suite's one identity always carries the seeded goal (`compromiso.spec.ts`
// and every other spec here assume it). Deleting it, even briefly, would
// race every other spec `playwright.config.ts`'s `workers: 2` might be
// running at the same moment. A fresh, disposable identity is minted
// instead, through the same door `seed-goal.ts` itself signs in with — a
// real `GET /auth/confirm` redemption, never a typed address (RNP-09) — at a
// lane number no real lane ever uses, so it collides with nothing. The
// child inherits `HARNESS_RUN_ID` through `process.env`, so the identity is
// registered under the suite's own run and dropped with it at teardown
// (`scripts/harness/e2e-run.ts`); nothing here writes a goal under it.
function mintDisposableSession(lane: number, baseUrl: string): void {
  execFileSync(
    process.execPath,
    ["--import", "tsx", "--env-file=.env.local", "scripts/harness/mint-session.ts"],
    {
      env: { ...process.env, HARNESS_LANE: String(lane), PULSAR_BASE_URL: baseUrl },
      stdio: "pipe",
    },
  );
}

test("an empty week says what to do and links to opening one (RP-11, RP-16)", async ({
  browser,
  baseURL,
}) => {
  const disposableLane = 9000 + laneNumber();
  mintDisposableSession(disposableLane, baseURL ?? "http://localhost:3200");

  const context = await browser.newContext({
    storageState: resolve(process.cwd(), `private/session-${disposableLane}.json`),
  });
  try {
    const page = await context.newPage();
    await page.goto("/semana");

    // The range still draws (`Semana.dc.html` names no board for a goal-
    // less week, so nothing here says the range itself should hide).
    await expect(page.getByText(/^Del \d/)).toBeVisible();
    await expect(page.getByText("Todavía no tienes una meta abierta.")).toBeVisible();
    const link = page.getByRole("link", { name: "Crear una meta" });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "/metas/nueva");
  } finally {
    await context.close();
  }
});
