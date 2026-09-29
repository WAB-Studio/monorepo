import { randomBytes, randomUUID } from "node:crypto";

import type { Browser, BrowserContext, Locator, Page } from "@playwright/test";
import type postgres from "postgres";

import { test, expect } from "./fixtures";
import { civilDateToDate, dateToCivilDate, todayInZone } from "@/lib/zone";

// Hoy says when a goal ended (`HoyMetaTerminada.dc.html`): «X terminó ayer ·
// ver» for the day after, the weekday later in the same week, nothing once
// the week it ended in is over. Every test seeds a person of its own and
// horizons relative to today.

function shift(day: string, by: number): string {
  const date = civilDateToDate(day);
  date.setUTCDate(date.getUTCDate() + by);
  return dateToCivilDate(date);
}

const today = todayInZone();
// 0 is Monday.
const todayIndex = (civilDateToDate(today).getUTCDay() + 6) % 7;
const weekStart = shift(today, -todayIndex);

// ICU's Spanish, never the catalogue's list the screen reads.
function dayWords(day: string): string {
  const weekday = new Intl.DateTimeFormat("es", { weekday: "long", timeZone: "UTC" }).format(civilDateToDate(day));
  return `${weekday} ${Number(day.slice(8, 10))}`;
}

// The last day is `lastDay`, so the horizon is the day after.
async function seedEnded(db: postgres.Sql, personId: string, name: string, lastDay: string) {
  const [goal] = await db<{ id: string }[]>`
    insert into goals.goals (user_id, name, horizon, created_at)
    values (${personId}, ${name}, ${shift(lastDay, 1)}, ${new Date(Date.now() - 60 * 86_400_000)}) returning id
  `;
  return goal.id;
}

// An open goal keeps Hoy from being the all-ended card.
async function seedOpen(db: postgres.Sql, personId: string, name: string) {
  await db`insert into goals.goals (user_id, name, horizon) values (${personId}, ${name}, ${shift(today, 60)})`;
}

// Registered under the suite's run the way `mint-session.ts` registers the
// first person; the run's teardown drops it if this spec cannot.
async function createPerson(db: postgres.Sql): Promise<string> {
  const runId = process.env.HARNESS_RUN_ID?.trim();
  if (!runId) throw new Error("HARNESS_RUN_ID is unset: this spec runs under check:e2e's own run");
  const id = randomUUID();
  const email = `harness-pulsar-${id}@example.invalid`;
  await db.begin(async (tx) => {
    await tx`
      insert into auth.users (
        id, instance_id, aud, role, email, email_confirmed_at,
        encrypted_password, confirmation_token, recovery_token,
        email_change, email_change_token_current, email_change_token_new,
        email_change_confirm_status, phone_change, phone_change_token,
        reauthentication_token, raw_app_meta_data, raw_user_meta_data,
        is_sso_user, is_anonymous, created_at, updated_at)
      values (
        ${id}, '00000000-0000-0000-0000-000000000000', 'authenticated',
        'authenticated', ${email}, now(),
        '', '', '',
        '', '', '',
        0, '', '',
        '', '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
        false, false, now(), now())`;
    await tx`
      insert into harness.identities (user_id, run_id, email, disposition)
      values (${id}, ${runId}, ${email}, 'ephemeral')`;
  });
  return id;
}

// The real `/auth/confirm` redemption `mint-session.ts` performs, its cookies
// landing in this context's own jar.
async function signIn(context: BrowserContext, db: postgres.Sql, personId: string) {
  const hash = randomBytes(32).toString("hex");
  const [{ email }] = await db<{ email: string }[]>`
    update auth.users set recovery_token = ${hash}, recovery_sent_at = now(), updated_at = now()
    where id = ${personId} returning email`;
  await db`
    insert into auth.one_time_tokens (id, user_id, token_type, token_hash, relates_to, created_at, updated_at)
    values (${randomUUID()}, ${personId}, 'recovery_token', ${hash}, ${email}, now(), now())`;
  const response = await context.request.get(`/auth/confirm?token_hash=${hash}&type=magiclink`, {
    maxRedirects: 0,
  });
  const location = response.headers()["location"];
  if (!location || location.includes("error=")) {
    throw new Error(`/auth/confirm refused the token: ${location}`);
  }
}

async function dropPerson(db: postgres.Sql, id: string) {
  await db`delete from goals.facts where user_id = ${id}`;
  await db`delete from goals.one_offs where user_id = ${id}`;
  await db`delete from goals.goals where user_id = ${id}`;
  await db`delete from auth.users where id = ${id}`;
  await db`delete from harness.identities where user_id = ${id}`;
}


async function withPerson(
  browser: Browser,
  baseURL: string | undefined,
  db: postgres.Sql,
  body: (page: Page, personId: string) => Promise<void>,
) {
  const personId = await createPerson(db);
  const context = await browser.newContext({ baseURL: baseURL! });
  try {
    await signIn(context, db, personId);
    await body(await context.newPage(), personId);
  } finally {
    await context.close();
    await dropPerson(db, personId);
  }
}

test("a goal that ended yesterday reads «terminó ayer · ver»", async ({ browser, baseURL, db }) => {
  test.skip(todayIndex === 0, "yesterday was Sunday: its week is over, so the line is gone (covered by the last-week case)");
  await withPerson(browser, baseURL, db, async (page, personId) => {
    const name = `Dejar el azúcar ${Date.now()}`;
    await seedOpen(db, personId, `Abierta ${Date.now()}`);
    await seedEnded(db, personId, name, shift(today, -1));
    await page.goto("/");
    const line = page.getByText(`${name} terminó ayer ·`);
    await expect(line).toBeVisible();
    await expect(page.getByText(/terminó el /)).toHaveCount(0);
  });
});

test("a goal that ended two days ago this week names the day", async ({ browser, baseURL, db }) => {
  test.skip(todayIndex < 2, "two days ago is in the previous week on a Monday or Tuesday");
  await withPerson(browser, baseURL, db, async (page, personId) => {
    const name = `Dejar el café ${Date.now()}`;
    await seedOpen(db, personId, `Abierta ${Date.now()}`);
    await seedEnded(db, personId, name, shift(today, -2));
    await page.goto("/");
    await expect(page.getByText(`${name} terminó el ${dayWords(shift(today, -2))} ·`)).toBeVisible();
    await expect(page.getByText(/terminó ayer/)).toHaveCount(0);
  });
});

test("a goal that ended last week shows nothing", async ({ browser, baseURL, db }) => {
  await withPerson(browser, baseURL, db, async (page, personId) => {
    const name = `Meta de la semana pasada ${Date.now()}`;
    await seedOpen(db, personId, `Abierta ${Date.now()}`);
    // The Sunday before this week: yesterday on a Monday, and still not this week's.
    await seedEnded(db, personId, name, shift(weekStart, -1));
    await page.goto("/");
    await expect(page.getByText(`Abierta`, { exact: false }).first()).toBeVisible();
    await expect(page.getByText(name)).toHaveCount(0);
    await expect(page.getByText(/ terminó /)).toHaveCount(0);
  });
});

test("«ver» opens the goal that ended", async ({ browser, baseURL, db }) => {
  test.skip(todayIndex === 0, "yesterday was Sunday: its week is over, so there is no line to follow");
  await withPerson(browser, baseURL, db, async (page, personId) => {
    const name = `Meta que ver ${Date.now()}`;
    await seedOpen(db, personId, `Abierta ${Date.now()}`);
    const id = await seedEnded(db, personId, name, shift(today, -1));
    await page.goto("/");
    const link = page.getByRole("link", { name: `Abrir ${name}` });
    await expect(link).toHaveText("ver");
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/metas/${id}$`));
    await expect(page.getByText(name).first()).toBeVisible();
  });
});

test("at 1280 the line sits under «Hoy» and above the goals", async ({ browser, baseURL, db }) => {
  test.skip(todayIndex === 0, "yesterday was Sunday: its week is over, so there is no line to place");
  await withPerson(browser, baseURL, db, async (page, personId) => {
    const stamp = Date.now();
    const open = `Abierta ${stamp}`;
    const name = `Reciente ${stamp}`;
    await seedOpen(db, personId, open);
    await seedEnded(db, personId, name, shift(today, -1));
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    const line = page.getByText(`${name} terminó ayer ·`);
    await expect(line).toBeVisible();
    const box = async (locator: Locator) => (await locator.boundingBox())!;
    const [t, l, g] = [await box(page.getByRole("main").getByText("Hoy", { exact: true })), await box(line), await box(page.getByText(open).first())];
    expect(l.y).toBeGreaterThanOrEqual(t.y + t.height - 1);
    expect(g.y).toBeGreaterThan(l.y);
    expect(Math.abs(l.x - t.x)).toBeLessThan(2);
  });
});

test("several goals ended this week read one line each, most recent first", async ({ browser, baseURL, db }) => {
  test.skip(todayIndex < 2, "two goals ended on different days of this week need a Wednesday or later");
  await withPerson(browser, baseURL, db, async (page, personId) => {
    const stamp = Date.now();
    const older = `Antigua ${stamp}`;
    const newer = `Reciente ${stamp}`;
    await seedOpen(db, personId, `Abierta ${stamp}`);
    await seedEnded(db, personId, older, shift(today, -2));
    await seedEnded(db, personId, newer, shift(today, -1));
    await page.goto("/");
    const first = page.getByText(`${newer} terminó ayer ·`);
    const second = page.getByText(`${older} terminó el ${dayWords(shift(today, -2))} ·`);
    await expect(first).toBeVisible();
    await expect(second).toBeVisible();
    expect((await first.boundingBox())!.y).toBeLessThan((await second.boundingBox())!.y);
  });
});

test("when every goal has ended the card names the last one and the line is not repeated", async ({
  browser,
  baseURL,
  db,
}) => {
  await withPerson(browser, baseURL, db, async (page, personId) => {
    const name = `Última ${Date.now()}`;
    await seedEnded(db, personId, name, shift(today, -1));
    await page.goto("/");
    await expect(page.getByText(`${name} terminó el`)).toHaveCount(1);
    await expect(page.getByText(/terminó ayer/)).toHaveCount(0);
    await expect(page.getByRole("link", { name: `Abrir ${name}` })).toHaveCount(0);
  });
});
