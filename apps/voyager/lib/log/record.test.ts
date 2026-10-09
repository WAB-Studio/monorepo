// RL-55: a newer tab upgrading the schema waits on this tab's connection. The
// connection must close on `versionchange` and the next write must open a
// fresh one rather than reuse the dead handle. Node has no IndexedDB, so the
// real `record.ts` runs in a child process over a recording fake.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { promisify } from "node:util";

test("otra pestaña sube la versión: la conexión se cierra una vez y la siguiente escritura reabre", async () => {
  const script = `
    const calls = { open: 0, close: 0 };
    const stores = { lookups: [] };
    const connections = [];
    const makeStore = () => ({
      createIndex() {},
      add(row) { const stored = { ...row, id: stores.lookups.length + 1 }; stores.lookups.push(stored); return stored.id; },
      put(row) { stores.lookups.push(row); },
    });
    globalThis.indexedDB = {
      open(_name, wanted) {
        calls.open += 1;
        const request = {};
        queueMicrotask(() => {
          const database = {
            version: wanted,
            onversionchange: null,
            onclose: null,
            close() { calls.close += 1; },
            createObjectStore: () => makeStore(),
            objectStore: () => makeStore(),
            transaction: () => {
              const tx = { objectStore: () => makeStore(), oncomplete: null, onerror: null, onabort: null };
              queueMicrotask(() => tx.oncomplete?.());
              return tx;
            },
          };
          connections.push(database);
          request.result = database;
          request.transaction = database;
          request.onupgradeneeded?.({ oldVersion: 0 });
          request.onsuccess();
        });
        return request;
      },
    };
    const real = await import(${JSON.stringify(new URL("./record.ts", import.meta.url).href)});
    await real.openLogDatabase();
    const afterFirst = calls.open;
    connections[0].onversionchange({ newVersion: 4 });
    const closedAfterEvent = calls.close;
    await real.openLogDatabase();
    console.log(JSON.stringify({ afterFirst, closedAfterEvent, openAfterReopen: calls.open }));
  `;
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script],
    { cwd: process.cwd() },
  );
  const seen = JSON.parse(stdout.trim().split("\n").pop()!) as {
    afterFirst: number;
    closedAfterEvent: number;
    openAfterReopen: number;
  };
  assert.equal(seen.afterFirst, 1);
  assert.equal(seen.closedAfterEvent, 1);
  assert.equal(seen.openAfterReopen, 2);
});
