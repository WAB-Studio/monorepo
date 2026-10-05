import { request as playwrightRequest, type APIResponse, type Page } from "@playwright/test";

import messages from "../messages/es/connections.json";
import { test, expect, type Person } from "./fixtures";

// RP-38, RNP-11 (`ConexionesVacio`, `ConexionesUna`, `ConexionesCreada`,
// `ConexionesRevocada`, `ConexionesFallo`): the key is drawn once, right after
// it is made, and no later render holds it.
const NAME = "Claude Code";
const KEY = /^pls_[A-Za-z0-9_-]{20,}$/;

async function openScreen(browser: import("@playwright/test").Browser, baseURL: string, person: Person, width = 360) {
  const context = await browser.newContext({
    storageState: person.sessionFile,
    baseURL,
    viewport: { width, height: width < 1024 ? 740 : 800 },
    hasTouch: width < 1024,
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  await page.goto("/conexiones");
  await expect(page.getByRole("button", { name: messages.create })).toBeVisible();
  return { context, page };
}

async function create(page: Page, name: string): Promise<string> {
  await page.getByLabel(messages.nameLabel).fill(name);
  await page.getByRole("button", { name: messages.create }).click();
  const key = page.locator("pre").first();
  await expect(key).toHaveText(KEY);
  return (await key.textContent())!;
}

// Under 1024 the tab, from 1024 the rail's item: either way only «Metas» is current.
async function expectMetasCurrent(page: Page) {
  const nav = page.getByRole("navigation");
  await expect(nav.locator("[aria-current]")).toHaveCount(1);
  await expect(nav.getByRole("link", { name: "Metas", exact: true })).toHaveAttribute("aria-current", "page");
}

// The server rendered nothing a later visit can read the key from.
async function absentEverywhere(page: Page, key: string) {
  expect(await page.content()).not.toContain(key);
  expect(page.url()).not.toContain(key);
  expect(await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }]))).not.toContain(key);
}

async function mcp(baseURL: string, key: string): Promise<APIResponse> {
  const api = await playwrightRequest.newContext({ baseURL });
  try {
    return await api.post("/mcp", {
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
      },
      data: {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "spec", version: "1" } },
      },
    });
  } finally {
    await api.dispose();
  }
}

test.describe("the connections screen (RP-38)", () => {
  test("with no key it reads the empty board and offers the first key and the connector", async ({
    person,
    browser,
    baseURL,
  }) => {
    const { context, page } = await openScreen(browser, baseURL!, person);
    try {
      await expect(page.getByRole("heading", { level: 1, name: messages.title })).toBeVisible();
      await expectMetasCurrent(page);
      await expect(page.getByText(messages.intro, { exact: true })).toBeVisible();
      await expect(page.getByText(messages.sections.first, { exact: true })).toBeVisible();
      await expect(page.getByText(messages.nameHint, { exact: true })).toBeVisible();
      await expect(page.getByText(messages.connector.note, { exact: true })).toBeVisible();
      await expect(page.locator("pre").first()).toHaveText(/\/mcp$/);
      await expect(page.getByText(messages.sections.keys, { exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: messages.row.revoke })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("a created key shows once with its command, then lives in no render", async ({ person, browser, baseURL, db }) => {
    const { context, page } = await openScreen(browser, baseURL!, person);
    try {
      const key = await create(page, NAME);

      await expect(page.getByText(messages.created.once, { exact: true })).toBeVisible();
      await expect(page.getByRole("note")).toHaveText(messages.created.once);
      await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
      const command = page.locator("pre").nth(1);
      await expect(command).toContainText("/mcp");
      await expect(command).toContainText(key);
      await expect(command).toContainText("claude mcp add --transport http pulsar ");

      await page.getByRole("button", { name: messages.created.copyName }).click();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(key);

      // The database keeps a hash and the last four letters, never the key.
      const stored = await db`select hint, token_hash from goals.access_tokens where user_id = ${person.id}`;
      expect(stored).toHaveLength(1);
      expect(stored[0].hint).toBe(key.slice(-4));
      expect(Buffer.from(stored[0].token_hash).includes(Buffer.from(key))).toBe(false);
      // No column of the row, whole, carries the key.
      const [row] = await db`select to_jsonb(t)::text as doc from goals.access_tokens t where user_id = ${person.id}`;
      expect(row.doc).not.toContain(key);

      await page.reload();
      await expect(page.getByRole("button", { name: messages.create })).toBeVisible();
      await absentEverywhere(page, key);
      await expect(page.getByText(NAME, { exact: true })).toBeVisible();
      await expect(page.getByText(messages.row.neverUsed)).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("«Listo» returns to the list, and a reload after it holds no key", async ({ person, browser, baseURL }) => {
    const { context, page } = await openScreen(browser, baseURL!, person);
    try {
      const key = await create(page, NAME);
      await page.getByRole("button", { name: messages.created.done }).click();

      await expect(page.getByText(messages.sections.keys, { exact: true })).toBeVisible();
      await expect(page.getByText(NAME, { exact: true })).toBeVisible();
      await absentEverywhere(page, key);

      await page.reload();
      await expect(page.getByText(NAME, { exact: true })).toBeVisible();
      await absentEverywhere(page, key);
      expect(await (await page.request.get("/conexiones")).text()).not.toContain(key);
    } finally {
      await context.close();
    }
  });

  test("the key works at /mcp, stamps its last use, and «Revocar» shuts it", async ({ person, browser, baseURL }) => {
    const { context, page } = await openScreen(browser, baseURL!, person);
    try {
      const key = await create(page, NAME);
      await page.getByRole("button", { name: messages.created.done }).click();
      await expect(page.getByText(messages.row.neverUsed)).toBeVisible();

      expect((await mcp(baseURL!, key)).status()).toBe(200);
      await page.reload();
      await expect(page.getByText(messages.row.neverUsed)).toHaveCount(0);
      await expect(page.getByText(/usada hoy \d\d:\d\d$/)).toBeVisible();

      await page.getByRole("button", { name: messages.row.revoke }).click();
      await expect(page.getByText(/^revocada el .* · ya no entra$/)).toBeVisible();
      await expect(page.getByRole("button", { name: messages.row.revoke })).toHaveCount(0);
      expect((await mcp(baseURL!, key)).status()).toBe(401);

      // Still listed after a reload: a revoked key is never deleted.
      await page.reload();
      await expect(page.getByText(NAME, { exact: true })).toBeVisible();
      await expect(page.getByText(/^revocada el /)).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("an empty name and a name already taken say why and keep the field", async ({ person, browser, baseURL }) => {
    const { context, page } = await openScreen(browser, baseURL!, person);
    try {
      await page.getByRole("button", { name: messages.create }).click();
      await expect(page.getByText(messages.errors.nameEmpty, { exact: true })).toBeVisible();
      await expect(page.getByText(messages.nameHint, { exact: true })).toHaveCount(0);

      await create(page, NAME);
      await page.getByRole("button", { name: messages.created.done }).click();

      await page.getByLabel(messages.nameLabel).fill(NAME);
      await page.getByRole("button", { name: messages.create }).click();
      await expect(page.getByText(messages.errors.nameTaken, { exact: true })).toBeVisible();
      await expect(page.getByLabel(messages.nameLabel)).toHaveValue(NAME);
    } finally {
      await context.close();
    }
  });

  for (const width of [360, 1280]) {
    test(`holds at ${width}: no sideways scroll on the list or on the key`, async ({ person, browser, baseURL }) => {
      const { context, page } = await openScreen(browser, baseURL!, person, width);
      try {
        const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(await overflow()).toBeLessThanOrEqual(0);
        await expectMetasCurrent(page);

        await create(page, NAME);
        expect(await overflow()).toBeLessThanOrEqual(0);
        await expect(page.getByRole("button", { name: messages.created.done })).toBeVisible();

        await page.getByRole("button", { name: messages.created.done }).click();
        await expect(page.getByRole("button", { name: messages.row.revoke })).toBeVisible();
        expect(await overflow()).toBeLessThanOrEqual(0);
        // 44px at least, the target the design asks of a row's act.
        const box = await page.getByRole("button", { name: messages.row.revoke }).boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
      } finally {
        await context.close();
      }
    });
  }
});
