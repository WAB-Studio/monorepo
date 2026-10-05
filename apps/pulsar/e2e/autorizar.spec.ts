import { createHash, randomBytes } from "node:crypto";

import type { Browser, BrowserContext, Page } from "@playwright/test";

import connections from "../messages/es/connections.json";
import oauth from "../messages/es/oauth.json";
import { test, expect, type Person } from "./fixtures";

// RP-41, RNP-01, RNP-07: the consent screen. The person is signed in through
// the fixture's session, never the form; a client registers itself through
// `/oauth/registro` as claude.ai does. The client's own redirect is a route
// the spec answers itself, so nothing leaves the machine. The sign-in form is
// asserted present and carrying `next`, never submitted: a send reaches a real
// inbox.
const REDIRECT = "http://localhost:6274/oauth/callback";
const STATE = "estado-de-prueba-123";
const signedOut = { cookies: [], origins: [] };

const verifier = () => randomBytes(32).toString("base64url");
const challengeOf = (value: string) => createHash("sha256").update(value).digest("base64url");

async function register(baseURL: string, name: string, redirect = REDIRECT): Promise<string> {
  const response = await fetch(`${baseURL}/oauth/registro`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_name: name, redirect_uris: [redirect] }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { client_id: string }).client_id;
}

function consentPath(baseURL: string, clientId: string, challenge: string, redirect = REDIRECT): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirect,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: STATE,
    resource: `${baseURL.replace(/\/+$/, "")}/mcp`,
  });
  return `/oauth/autorizar?${params.toString()}`;
}

async function open(
  browser: Browser,
  baseURL: string,
  storageState: Person["sessionFile"] | typeof signedOut,
  width = 360,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    storageState,
    baseURL,
    viewport: { width, height: 740 },
    hasTouch: width < 1024,
  });
  const page = await context.newPage();
  // The client's own address: answered here, never reached.
  await page.route("http://localhost:6274/**", (route) => route.fulfill({ status: 200, body: "ok" }));
  return { context, page };
}

async function expectNoOverflow(page: Page) {
  const [scroll, inner] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(scroll).toBeLessThanOrEqual(inner);
}

test.describe("the consent screen (RP-41)", () => {
  test("signed in it names the client, lists what it may and never may, and fits 360", async ({
    person,
    browser,
    baseURL,
  }) => {
    const name = `Claude ${randomBytes(3).toString("hex")}`;
    const clientId = await register(baseURL!, name);
    const { context, page } = await open(browser, baseURL!, person.sessionFile);
    try {
      await page.goto(consentPath(baseURL!, clientId, challengeOf(verifier())));
      await expect(page.getByRole("heading", { level: 1, name: oauth.title.replace("{client}", name) })).toBeVisible();
      for (const text of [...Object.values(oauth.may), ...Object.values(oauth.never)]) {
        await expect(page.getByText(text, { exact: true })).toBeVisible();
      }
      await expect(page.getByRole("button", { name: oauth.allow, exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: oauth.deny })).toBeVisible();
      await expect(page.getByRole("navigation")).toHaveCount(0);
      await expectNoOverflow(page);
    } finally {
      await context.close();
    }
  });

  test("«Permitir» lands on the client's redirect with a code and the same state, and /conexiones lists it", async ({
    person,
    browser,
    baseURL,
  }) => {
    const name = `Claude ${randomBytes(3).toString("hex")}`;
    const clientId = await register(baseURL!, name);
    const secret = verifier();
    const { context, page } = await open(browser, baseURL!, person.sessionFile);
    try {
      await page.goto(consentPath(baseURL!, clientId, challengeOf(secret)));
      await page.getByRole("button", { name: oauth.allow, exact: true }).click();
      await page.waitForURL(/localhost:6274/);

      const back = new URL(page.url());
      expect(back.origin + back.pathname).toBe(REDIRECT);
      expect(back.searchParams.get("state")).toBe(STATE);
      const code = back.searchParams.get("code");
      expect(code).toMatch(/^plc_/);
      expect(back.searchParams.get("error")).toBeNull();

      // The connection exists once the client exchanges the code for its tokens.
      const exchanged = await fetch(`${baseURL}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: code!,
          code_verifier: secret,
          client_id: clientId,
          redirect_uri: REDIRECT,
        }),
      });
      expect(exchanged.status).toBe(200);

      await page.goto("/conexiones");
      await expect(page.getByText(connections.sections.oauth, { exact: true })).toBeVisible();
      await expect(page.getByText(name, { exact: true })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("«No permitir» lands on the client's redirect with access_denied, the state and no code", async ({
    person,
    browser,
    baseURL,
  }) => {
    const clientId = await register(baseURL!, `Claude ${randomBytes(3).toString("hex")}`);
    const { context, page } = await open(browser, baseURL!, person.sessionFile);
    try {
      await page.goto(consentPath(baseURL!, clientId, challengeOf(verifier())));
      await page.getByRole("button", { name: oauth.deny }).click();
      await page.waitForURL(/localhost:6274/);

      const back = new URL(page.url());
      expect(back.searchParams.get("error")).toBe("access_denied");
      expect(back.searchParams.get("state")).toBe(STATE);
      expect(back.searchParams.get("code")).toBeNull();
    } finally {
      await context.close();
    }
  });

  test("a redirect the client did not register reads as invalid and offers nothing to approve", async ({
    person,
    browser,
    baseURL,
  }) => {
    const clientId = await register(baseURL!, `Claude ${randomBytes(3).toString("hex")}`);
    const { context, page } = await open(browser, baseURL!, person.sessionFile);
    try {
      await page.goto(consentPath(baseURL!, clientId, challengeOf(verifier()), "http://localhost:6274/otra"));
      await expect(page.getByRole("heading", { level: 1, name: oauth.invalid.title })).toBeVisible();
      await expect(page.getByText(oauth.invalid.body, { exact: true })).toBeVisible();
      await expect(page.getByRole("button")).toHaveCount(0);
      await expect(page.getByRole("link", { name: oauth.invalid.home })).toHaveAttribute("href", "/");
      await expectNoOverflow(page);
    } finally {
      await context.close();
    }
  });

  test("a request with no PKCE challenge reads as invalid", async ({ person, browser, baseURL }) => {
    const clientId = await register(baseURL!, `Claude ${randomBytes(3).toString("hex")}`);
    const { context, page } = await open(browser, baseURL!, person.sessionFile);
    try {
      const path = consentPath(baseURL!, clientId, challengeOf(verifier())).replace(/&code_challenge=[^&]*/, "");
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: oauth.invalid.title })).toBeVisible();
      await expect(page.getByRole("button")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("signed out it asks for the address and the form carries this screen's own path as next", async ({
    browser,
    baseURL,
  }) => {
    const clientId = await register(baseURL!, `Claude ${randomBytes(3).toString("hex")}`);
    const path = consentPath(baseURL!, clientId, challengeOf(verifier()));
    const { context, page } = await open(browser, baseURL!, signedOut);
    try {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: oauth.signedOut.title })).toBeVisible();
      await expect(page.getByLabel(oauth.signedOut.emailLabel)).toHaveAttribute(
        "placeholder",
        oauth.signedOut.emailPlaceholder,
      );
      await expect(page.getByRole("button", { name: oauth.signedOut.send })).toBeVisible();
      await expect(page.getByText(oauth.signedOut.promise, { exact: true })).toBeVisible();
      await expect(page.locator('input[name="next"]')).toHaveValue(path);
      await expect(page.getByRole("button", { name: oauth.allow, exact: true })).toHaveCount(0);
      await expectNoOverflow(page);
    } finally {
      await context.close();
    }
  });
});
