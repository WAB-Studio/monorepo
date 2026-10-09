import { createHash, randomBytes } from "node:crypto";

import type { Page } from "@playwright/test";

import { test, expect } from "./fixtures";

// PermisoPalabras (RP-60): what the consent screen says it may and
// never may do, in the board's own words. Every string is a literal: a spec
// that read them from oauth.json would pass on whatever the catalogue says.
const REDIRECT = "http://localhost:6274/oauth/callback";
const from = `2001:db8:${randomBytes(2).toString("hex")}:${randomBytes(2).toString("hex")}::1`;
const asRun = { "x-forwarded-for": from };

const MAY = [
  "leer tus metas, meses, tareas, sueltas e informe",
  "marcar hecho y anotar cantidades",
  "abrir metas, escribir tareas y sus notas",
  "renombrar una meta y mover su final",
  "agregar fases y compromisos, y retirar un compromiso",
  "darle mes o día a una tarea, cambiar el monto de un mes y aceptar que el plan corra",
];
const NEVER = ["borrar ni archivar nada", "desmarcar lo que ya hiciste"];
const REVOKE = "Metas › Conectar una IA";

const challengeOf = (value: string) => createHash("sha256").update(value).digest("base64url");

async function consentPage(page: Page, baseURL: string): Promise<void> {
  const resource = (
    (await (await fetch(`${baseURL}/.well-known/oauth-protected-resource`)).json()) as { resource: string }
  ).resource;
  const registered = await fetch(`${baseURL}/oauth/registro`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...asRun },
    body: JSON.stringify({ client_name: `Claude ${randomBytes(3).toString("hex")}`, redirect_uris: [REDIRECT] }),
  });
  expect(registered.status).toBe(201);
  const { client_id } = (await registered.json()) as { client_id: string };
  const params = new URLSearchParams({
    response_type: "code",
    client_id,
    redirect_uri: REDIRECT,
    code_challenge: challengeOf(randomBytes(32).toString("base64url")),
    code_challenge_method: "S256",
    state: "palabras",
    resource,
  });
  await page.goto(`/oauth/autorizar?${params.toString()}`);
}

for (const width of [360, 1280]) {
  test.describe(`the consent words at ${width}`, () => {
    test.use({ viewport: { width, height: 740 }, extraHTTPHeaders: asRun });

    test("it lists what the tools do, never what they do not, and names one place to revoke", async ({
      page,
      baseURL,
    }) => {
      await consentPage(page, baseURL!);
      const main = page.getByRole("main");

      await expect(page.getByText("bitácora de metas", { exact: true })).toBeVisible();
      await expect(page.getByText("Podrá leer tus metas y anotar lo que hagas.", { exact: true })).toBeVisible();
      for (const line of [...MAY, ...NEVER]) {
        await expect(page.getByText(line, { exact: true }), line).toBeVisible();
      }
      await expect(page.getByRole("button", { name: "Permitir", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "No permitir", exact: true })).toBeVisible();

      const text = await main.innerText();
      // Words for tools that do not exist (`reorganize`'s old line).
      expect(text).not.toMatch(/correr el plan/i);
      expect(text).not.toMatch(/mover tareas de mes/i);
      // One place to revoke, and it is the footer's.
      expect(text).not.toContain("Conexiones");
      expect(text.split(REVOKE)).toHaveLength(2);
      await expect(page.getByText(/^entraste como \S+ · lo revocas cuando quieras en Metas › Conectar una IA$/)).toBeVisible();

      const [scroll, inner] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
      expect(scroll).toBeLessThanOrEqual(inner);
    });
  });
}
