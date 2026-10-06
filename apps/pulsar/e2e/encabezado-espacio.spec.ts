import { test, expect } from "./fixtures";

// Module 306: the header spaces eyebrow -> title at 6 px and title -> lead at 12 px (`SistemaEspacio.dc.html`).

for (const path of ["/metas/nueva", "/metas/importar", "/semana"]) {
  test(`${path} holds 6 px between its eyebrow and its title`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const eyebrow = (await page.locator("main > header > div").first().boundingBox())!;
    const title = (await page.getByRole("heading", { level: 1 }).boundingBox())!;
    const gap = title.y - (eyebrow.y + eyebrow.height);
    expect(gap).toBeGreaterThanOrEqual(6);
    expect(gap).toBeLessThanOrEqual(8);
  });
}

test("Hoy holds 12 px between its title and the line under it", async ({ person, browser, db }) => {
  const [goal] = await db<{ id: string }[]>`
    insert into goals.goals (user_id, name, horizon)
    values (${person.id}, ${`Meta lead ${Date.now()}`}, (now() + interval '90 days')::date) returning id`;
  await db`
    insert into goals.commitments (user_id, goal_id, name, cadence_kind, satisfaction)
    values (${person.id}, ${goal.id}, 'Tocar', 'daily', 'tap')
  `;
  const context = await browser.newContext({
    storageState: person.sessionFile,
    viewport: { width: 1280, height: 800 },
  });
  try {
    const page = await context.newPage();
    await page.goto("/");
    const title = (await page.getByRole("heading", { level: 1 }).boundingBox())!;
    const lead = (await page.getByText(/^hechos \d+ de \d+/).boundingBox())!;
    expect(lead.y - (title.y + title.height)).toBeCloseTo(12, 0);
  } finally {
    await context.close();
  }
});
