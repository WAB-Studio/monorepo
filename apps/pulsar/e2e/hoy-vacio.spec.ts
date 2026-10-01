import { test, expect } from "./fixtures";
import { civilDateToDate, dateToCivilDate, todayInZone } from "@/lib/zone";

// A person with no open goal reads the empty day: what to do and a link to
// open one, never the all-ended card. An archived goal leaves the day even
// when its horizon has passed (RP-01, RP-24).

const EMPTY = "Todavía no tienes una meta abierta.";

test("a person with no rows reads the empty day (RP-01)", async ({ person, browser }) => {
  const context = await browser.newContext({
    storageState: person.sessionFile,
    viewport: { width: 360, height: 800 },
  });
  try {
    const page = await context.newPage();
    await page.goto("/");

    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.getByText(EMPTY)).toBeVisible();
    const link = page.getByRole("link", { name: "Crear una meta" });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "/metas/nueva");
    await expect(page.getByText(/hechos \d+ de \d+/)).toHaveCount(0);
    await expect(page.getByText(" terminó ")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  } finally {
    await context.close();
  }
});

test("an archived goal past its horizon leaves the day empty (RP-24)", async ({
  person,
  browser,
  db,
}) => {
  const past = civilDateToDate(todayInZone());
  past.setUTCDate(past.getUTCDate() - 10);
  const name = "Archivada vencida";
  const [goal] = await db<{ id: string }[]>`
    insert into goals.goals (user_id, name, horizon, created_at, archived_at)
    values (${person.id}, ${name}, ${dateToCivilDate(past)}, now() - interval '30 days', now() - interval '1 day')
    returning id
  `;
  const context = await browser.newContext({ storageState: person.sessionFile });
  try {
    const page = await context.newPage();
    await page.goto("/");

    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.getByText(EMPTY)).toBeVisible();
    await expect(page.getByRole("link", { name: "Crear una meta" })).toHaveAttribute(
      "href",
      "/metas/nueva",
    );
    await expect(page.getByText(name)).toHaveCount(0);
    await expect(page.getByText(" terminó ")).toHaveCount(0);
  } finally {
    await context.close();
    await db`delete from goals.goals where id = ${goal.id} and user_id = ${person.id}`;
  }
});
