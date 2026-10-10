import { randomUUID } from "node:crypto";

import type { Page } from "@playwright/test";

import messages from "../messages/es.json";
import { DATABASE_VERSION } from "../lib/log/record";
import type { SyncState } from "../lib/log/types";
import { expect, test } from "./fixtures";

// Module 683 (RL-22, RL-52, RL-16, RNL-09), from the contract and the approved
// board `CuentaSinRedConSesionOscuroMovil`, not from the components.
//
// The precached `/cuenta` shell carries no credentials, so «with a session»
// here is the device's own `sync` row: enabled, a readerId, not retired. No
// address is ever typed and no `auth.users` row is minted.
//
// `account.copy.failedOffline` exists; the line for a copy never made has no
// key yet, so it is written here as the board's own text.

const WITH_TIME = (time: string) => `Sin conexión desde hace ${time}. Tus palabras siguen en este dispositivo.`;
const NO_TIME = "Sin conexión. Tus palabras siguen en este dispositivo.";
const SIGN_IN = "Entrar con mi correo";
const HOUR = 3_600_000;

for (const viewport of [
  { width: 360, height: 640 },
  { width: 1280, height: 800 },
]) {
  test.describe(`/cuenta sin red, ${viewport.width}px`, () => {
    test.use({ viewport });

    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => {
        delete (window as unknown as { Translator?: unknown }).Translator;
      });
    });

    function state(extra: Partial<SyncState> = {}): SyncState {
      return {
        deviceId: randomUUID(),
        pushedThroughLocalId: null,
        pulledThroughCursor: null,
        lastSyncedAt: Date.now() - 3 * HOUR,
        enabled: true,
        readerId: randomUUID(),
        retired: false,
        ...extra,
      };
    }

    async function seed(page: Page, sync: SyncState | null): Promise<void> {
      await page.goto("/");
      await expect(page.getByRole("textbox", { name: messages.search.label })).toBeVisible();
      await page.evaluate(() => navigator.serviceWorker.ready);
      await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
      await page.evaluate(
        ({ version, sync }) =>
          new Promise<void>((resolve, reject) => {
            const request = indexedDB.open("reading-log", version);
            request.onupgradeneeded = (event) => {
              const database = request.result;
              if (event.oldVersion < 1) {
                const store = database.createObjectStore("lookups", { keyPath: "id", autoIncrement: true });
                store.createIndex("at", "at");
                store.createIndex("normalised", "normalised");
              }
              if (event.oldVersion < 2) {
                database.createObjectStore("sync", { keyPath: "key" });
                request.transaction!
                  .objectStore("lookups")
                  .createIndex("foreign", ["device", "deviceSeq"], { unique: true });
              }
              if (event.oldVersion < 3) {
                request.transaction!.objectStore("lookups").createIndex("headword", "headword");
              }
            };
            request.onsuccess = () => {
              const db = request.result;
              const tx = db.transaction(["sync"], "readwrite");
              const store = tx.objectStore("sync");
              if (sync) store.put({ ...sync, key: "state" });
              else store.delete("state");
              tx.oncomplete = () => {
                db.close();
                resolve();
              };
              tx.onerror = () => reject(tx.error);
            };
            request.onerror = () => reject(request.error);
          }),
        { version: DATABASE_VERSION, sync },
      );
      // The install precaches `/cuenta`; offline needs it there.
      await expect
        .poll(() =>
          page.evaluate(async () => {
            for (const name of await caches.keys()) {
              if (await (await caches.open(name)).match(new URL("/cuenta", location.origin).toString())) return true;
            }
            return false;
          }),
        )
        .toBe(true);
    }

    async function readSync(page: Page): Promise<SyncState | undefined> {
      return page.evaluate(
        () =>
          new Promise<SyncState | undefined>((resolve, reject) => {
            const request = indexedDB.open("reading-log");
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              const db = request.result;
              const get = db.transaction("sync", "readonly").objectStore("sync").get("state");
              get.onsuccess = () => {
                db.close();
                resolve(get.result);
              };
              get.onerror = () => reject(get.error);
            };
          }),
      );
    }

    async function openOffline(page: Page, context: import("@playwright/test").BrowserContext): Promise<string[]> {
      const api: string[] = [];
      page.on("request", (request) => {
        if (new URL(request.url()).pathname.startsWith("/api/")) api.push(request.url());
      });
      await context.setOffline(true);
      // Chromium leaves `navigator.onLine` true on a page its service worker
      // answers (measured: true after setOffline), which a device without a
      // connection never does. Make the page say what the device would.
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
      });
      await page.goto("/cuenta");
      await expect(page.getByRole("heading", { name: messages.account.title }).first()).toBeVisible();
      return api;
    }

    // Each read is an IndexedDB round trip queued behind any write the mount
    // effect started, so a bad write lands before the last one.
    async function settledSync(page: Page): Promise<SyncState | undefined> {
      let last: SyncState | undefined;
      for (let i = 0; i < 8; i++) last = await readSync(page);
      return last;
    }

    test("offline with a copy on: «Sin conexión desde hace …», no sign-in form", async ({ page, context }) => {
      await seed(page, state());
      await openOffline(page, context);
      await expect(page.getByText(WITH_TIME("3 horas"), { exact: true })).toBeVisible();
      await expect(page.getByText(SIGN_IN)).toHaveCount(0);
      await expect(page.getByText(messages.account.copy.noSessionTitle)).toHaveCount(0);
      await expect(page.getByText(messages.account.copy.label, { exact: true })).toBeVisible();
      await expect(page.getByText(messages.account.info.tabs.info, { exact: true }).first()).toBeVisible();
      await expect(page.getByRole("textbox")).toHaveCount(0);
      await expect(page.getByRole("button", { name: /Enviar|Entrar/ })).toHaveCount(0);
    });

    test("offline with a copy on: the copy stays on, the sync row is never written enabled:false", async ({
      page,
      context,
    }) => {
      const seeded = state();
      await seed(page, seeded);
      await openOffline(page, context);
      await expect(page.getByText(WITH_TIME("3 horas"), { exact: true })).toBeVisible();
      const after = await settledSync(page);
      expect(after?.enabled).toBe(true);
      expect(after?.readerId).toBe(seeded.readerId);
      expect(after?.retired).toBe(false);
    });

    test("offline with a copy on: no address in the page", async ({ page, context }) => {
      await seed(page, state());
      await openOffline(page, context);
      await expect(page.getByText(WITH_TIME("3 horas"), { exact: true })).toBeVisible();
      await expect(page.locator("main")).not.toContainText("@");
    });

    test("offline with a copy on but never made: the line without a time", async ({ page, context }) => {
      await seed(page, state({ lastSyncedAt: null }));
      await openOffline(page, context);
      await expect(page.getByText(NO_TIME, { exact: true })).toBeVisible();
      await expect(page.getByText(/Sin conexión desde hace/)).toHaveCount(0);
      await expect(page.getByText(SIGN_IN)).toHaveCount(0);
    });

    test("offline with a copy on: no sign-out, no devices, no retry, no failure title", async ({ page, context }) => {
      await seed(page, state());
      await openOffline(page, context);
      await expect(page.getByText(WITH_TIME("3 horas"), { exact: true })).toBeVisible();
      await expect(page.getByText(messages.account.devices.title, { exact: true })).toHaveCount(0);
      await expect(page.getByText(messages.account.signOut)).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Reintentar" })).toHaveCount(0);
      await expect(page.getByText(messages.account.copy.failedOfflineTitle)).toHaveCount(0);
    });

    test("offline with a copy on: nothing is requested from /api/ to paint it", async ({ page, context }) => {
      await seed(page, state());
      const api = await openOffline(page, context);
      await expect(page.getByText(WITH_TIME("3 horas"), { exact: true })).toBeVisible();
      await settledSync(page);
      expect(api).toEqual([]);
    });

    test("offline with no enabled copy: today's sign-in screen", async ({ page, context }) => {
      await seed(page, state({ enabled: false }));
      await openOffline(page, context);
      await expect(page.getByText(messages.account.copy.noSessionTitle)).toBeVisible();
      await expect(page.getByText(/Sin conexión/)).toHaveCount(0);
    });

    test("offline with a retired or readerless copy: today's sign-in screen", async ({ page, context }) => {
      await seed(page, state({ retired: true }));
      await openOffline(page, context);
      await expect(page.getByText(messages.account.copy.noSessionTitle)).toBeVisible();
      await expect(page.getByText(/Sin conexión desde hace/)).toHaveCount(0);
    });

    test("offline with no sync row at all: today's sign-in screen", async ({ page, context }) => {
      await seed(page, null);
      await openOffline(page, context);
      await expect(page.getByText(messages.account.copy.noSessionTitle)).toBeVisible();
      await expect(page.getByText(/Sin conexión/)).toHaveCount(0);
    });

    test("online with no session: the sign-in screen, and enabled goes false as today", async ({ page }) => {
      await seed(page, state());
      await page.goto("/cuenta");
      await expect(page.getByText(messages.account.copy.noSessionTitle)).toBeVisible();
      await expect(page.getByText(/Sin conexión/)).toHaveCount(0);
      await expect.poll(async () => (await readSync(page))?.enabled).toBe(false);
    });

    test("offline with a copy made under a minute ago: «desde hace un momento»", async ({ page, context }) => {
      await seed(page, state({ lastSyncedAt: Date.now() - 10_000 }));
      await openOffline(page, context);
      await expect(page.getByText(WITH_TIME("un momento"), { exact: true })).toBeVisible();
      await expect(page.getByText(SIGN_IN)).toHaveCount(0);
    });
  });
}
