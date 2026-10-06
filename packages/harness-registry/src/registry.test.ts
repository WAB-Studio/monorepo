import assert from "node:assert/strict";
import test from "node:test";

import { assertSuiteDatabase, openRun } from "./registry";

const REMOTE = "postgresql://postgres.abc:s3cret@aws-0-us.pooler.supabase.com:6543/postgres";
const LOCAL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

function withEnv(value: string | undefined, fn: () => void | Promise<void>) {
  const before = process.env.HARNESS_DATABASE;
  if (value === undefined) delete process.env.HARNESS_DATABASE;
  else process.env.HARNESS_DATABASE = value;
  const restore = () => {
    if (before === undefined) delete process.env.HARNESS_DATABASE;
    else process.env.HARNESS_DATABASE = before;
  };
  try {
    const out = fn();
    if (out instanceof Promise) return out.finally(restore);
    restore();
    return out;
  } catch (error) {
    restore();
    throw error;
  }
}

test("a local host passes", () =>
  withEnv(undefined, () => {
    assertSuiteDatabase(LOCAL);
    assertSuiteDatabase("postgresql://u:p@localhost:5432/db");
  }));

test("a remote host throws naming only the host", () =>
  withEnv(undefined, () => {
    assert.throws(
      () => assertSuiteDatabase(REMOTE),
      (error: Error) =>
        error.message.includes("aws-0-us.pooler.supabase.com") &&
        !error.message.includes("s3cret") &&
        error.message.includes("HARNESS_DATABASE=remote"),
    );
  }));

test("a missing or unparsable URL throws without echoing it", () =>
  withEnv(undefined, () => {
    assert.throws(() => assertSuiteDatabase(""), /not the local stack/);
    assert.throws(
      () => assertSuiteDatabase("not a url s3cret"),
      (error: Error) => !error.message.includes("s3cret"),
    );
  }));

test("HARNESS_DATABASE=remote lets a remote host through", () =>
  withEnv("remote", () => assertSuiteDatabase(REMOTE)));

test("openRun refuses before issuing any statement", () =>
  withEnv(undefined, async () => {
    const before = process.env.MIGRATION_DATABASE_URL;
    process.env.MIGRATION_DATABASE_URL = REMOTE;
    let queries = 0;
    const sql = (() => {
      queries++;
      return Promise.resolve([]);
    }) as never;
    try {
      await assert.rejects(openRun("queries", sql), /not the local stack/);
      assert.equal(queries, 0);
    } finally {
      if (before === undefined) delete process.env.MIGRATION_DATABASE_URL;
      else process.env.MIGRATION_DATABASE_URL = before;
    }
  }));

test("openRun with HARNESS_DATABASE=remote reaches the insert", () =>
  withEnv("remote", async () => {
    const before = process.env.MIGRATION_DATABASE_URL;
    process.env.MIGRATION_DATABASE_URL = REMOTE;
    let queries = 0;
    const sql = Object.assign(
      () => {
        queries++;
        return Promise.resolve([]);
      },
      {},
    ) as never;
    try {
      await openRun("queries", sql);
      assert.equal(queries, 1);
    } finally {
      if (before === undefined) delete process.env.MIGRATION_DATABASE_URL;
      else process.env.MIGRATION_DATABASE_URL = before;
    }
  }));
