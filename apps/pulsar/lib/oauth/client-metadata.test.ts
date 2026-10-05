import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test, { mock } from "node:test";
import { Readable } from "node:stream";

import { clientFromMetadataUrl, privateAddress, type MetadataDeps } from "./client-metadata";

const URL_OK = "https://app.example/client.json";
const doc = (over: Record<string, unknown> = {}) => ({
  client_id: URL_OK,
  client_name: "Claude",
  redirect_uris: ["https://app.example/cb"],
  ...over,
});
type Res = { status?: number; headers?: Record<string, string>; chunks?: string[]; stream?: Readable };
const json = (body: unknown, over: Res = {}): Res => ({
  chunks: [typeof body === "string" ? body : JSON.stringify(body)],
  ...over,
  headers: { "content-type": "application/json", ...over.headers },
});

type Calls = { request: number; register: number; resolve: number; options?: Record<string, unknown> };

function run(
  url: string,
  over: { response?: () => Promise<Res> | Res; resolve?: () => string[]; address?: string; timeoutMs?: number } = {},
) {
  const calls: Calls = { request: 0, register: 0, resolve: 0 };
  const deps: MetadataDeps = {
    request: ((_url: string, options: Record<string, unknown>, cb: (res: unknown) => void) => {
      const req = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void };
      req.destroy = () => {};
      req.end = () => {
        calls.request++;
        calls.options = options;
        Promise.resolve((over.response ?? (() => json(doc())))()).then((r) => {
          const res = r.stream ?? Readable.from((r.chunks ?? []).map((c) => Buffer.from(c)));
          Object.assign(res, { statusCode: r.status ?? 200, headers: r.headers ?? {} });
          cb(res);
        });
      };
      return req;
    }) as unknown as MetadataDeps["request"],
    resolve: async () => {
      calls.resolve++;
      return over.resolve ? over.resolve() : [over.address ?? "93.184.216.34"];
    },
    register: async () => {
      calls.register++;
      return "client-1";
    },
    timeoutMs: over.timeoutMs,
  };
  return clientFromMetadataUrl(url, deps).then((client) => ({ client, calls }));
}

test("a valid document yields the registered client", async () => {
  const { client, calls } = await run(URL_OK);
  assert.deepEqual(client, { id: "client-1", name: "Claude", redirectUris: ["https://app.example/cb"] });
  assert.equal(calls.register, 1);
});

test("a client_id that differs from the URL is refused", async () => {
  for (const id of ["https://app.example/other.json", "https://app.example/client.json/", undefined]) {
    const { client, calls } = await run(URL_OK, { response: () => json(doc({ client_id: id })) });
    assert.equal(client, null, String(id));
    assert.equal(calls.register, 0);
  }
});

test("only a plain https URL with a path is accepted", async () => {
  for (const url of [
    "http://app.example/client.json",
    "ftp://app.example/client.json",
    "https://app.example",
    "https://app.example/",
    "https://user:pw@app.example/client.json",
    "https://app.example/client.json#frag",
    "https://APP.example/client.json",
    "not a url",
  ]) {
    const { client, calls } = await run(url, { response: () => json(doc({ client_id: url })) });
    assert.equal(client, null, url);
    assert.equal(calls.request, 0, url);
  }
});

test("a host resolving to a private, loopback or link-local address is refused before any fetch", async () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:10.0.0.1"]) {
    const { client, calls } = await run(URL_OK, { address });
    assert.equal(client, null, address);
    assert.equal(calls.request, 0, address);
  }
});

test("a host with one public and one private address is refused", async () => {
  const { client, calls } = await run(URL_OK, { resolve: () => ["93.184.216.34", "10.0.0.1"] });
  assert.equal(client, null);
  assert.equal(calls.request, 0);
});

test("an IP-literal host is judged without resolving", async () => {
  for (const url of ["https://127.0.0.1/c.json", "https://10.0.0.1/c.json", "https://[::1]/c.json"]) {
    const { client } = await run(url, { response: () => json(doc({ client_id: url })) });
    assert.equal(client, null, url);
  }
});

test("an IPv6 literal that embeds a private IPv4 is refused in every form", async () => {
  const forms: Record<string, string> = {
    "mapped hex loopback": "[::ffff:7f00:1]",
    "mapped hex 10/8": "[::ffff:a00:1]",
    "mapped hex metadata": "[::ffff:a9fe:a9fe]",
    "mapped dotted": "[::ffff:127.0.0.1]",
    "v4-compatible": "[::7f00:1]",
    "NAT64 metadata": "[64:ff9b::a9fe:a9fe]",
    "6to4 loopback": "[2002:7f00:1::]",
    "6to4 10/8": "[2002:a00:1::1]",
    "unspecified": "[::]",
    "unique-local": "[fd00::1]",
    "link-local": "[fe80::1]",
    "multicast": "[ff02::1]",
  };
  for (const [form, host] of Object.entries(forms)) {
    const url = `https://${host}/c.json`;
    const { client, calls } = await run(url, { response: () => json(doc({ client_id: url })) });
    assert.equal(client, null, form);
    assert.equal(calls.request, 0, form);
  }
});

test("IPv4 special-use ranges are refused", () => {
  for (const address of ["192.0.0.1", "198.18.0.1", "198.19.255.254", "224.0.0.1", "239.255.255.255", "240.0.0.1", "255.255.255.255"]) {
    assert.equal(privateAddress(address), true, address);
  }
});

test("an IPv6 address embedding a public IPv4 passes", () => {
  for (const address of ["::ffff:808:808", "64:ff9b::808:808", "2002:808:808::1"]) {
    assert.equal(privateAddress(address), false, address);
  }
});

test("public addresses pass the address check", () => {
  for (const address of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "100.63.0.1", "2606:4700::1111"]) {
    assert.equal(privateAddress(address), false, address);
  }
});

test("a redirect answer is refused and never followed", async () => {
  for (const status of [301, 302, 307, 308]) {
    const { client, calls } = await run(URL_OK, {
      response: () => ({ status, headers: { location: "https://other.example/c.json" } }),
    });
    assert.equal(client, null, String(status));
    assert.equal(calls.request, 1);
  }
});

test("the connection is pinned to the validated address, never resolved again", async () => {
  const answers = [["93.184.216.34"], ["10.0.0.1"]];
  const { client, calls } = await run(URL_OK, { resolve: () => answers.shift() ?? ["10.0.0.1"] });
  assert.notEqual(client, null);
  const lookup = calls.options?.lookup as (h: string, o: object, cb: (...a: unknown[]) => void) => void;
  assert.equal(typeof lookup, "function");

  const single: unknown[] = [];
  lookup("app.example", {}, (...args) => single.push(...args));
  assert.deepEqual(single, [null, "93.184.216.34", 4]);
  const all: unknown[] = [];
  lookup("app.example", { all: true }, (...args) => all.push(...args));
  assert.deepEqual(all, [null, [{ address: "93.184.216.34", family: 4 }]]);

  assert.equal(calls.resolve, 1);
  assert.equal(calls.options?.servername, "app.example");
});

test("a non-200 or non-JSON answer is refused", async () => {
  for (const response of [
    () => json(doc(), { status: 404 }),
    () => json(doc(), { headers: { "content-type": "text/html" } }),
    () => ({ chunks: [JSON.stringify(doc())] }),
  ]) {
    assert.equal((await run(URL_OK, { response })).client, null);
  }
});

test("content-type parameters are tolerated", async () => {
  const { client } = await run(URL_OK, {
    response: () => json(doc(), { headers: { "content-type": "application/json; charset=utf-8" } }),
  });
  assert.notEqual(client, null);
});

test("a body over 64 KB is refused, declared or streamed", async () => {
  // Whitespace keeps the document valid, so only the cap can refuse it.
  const padded = " ".repeat(70 * 1024) + JSON.stringify(doc());
  assert.notEqual((await run(URL_OK, { response: () => json(doc()) })).client, null);
  assert.equal((await run(URL_OK, { response: () => json(padded) })).client, null);

  const declared = await run(URL_OK, { response: () => json(doc(), { headers: { "content-length": "70000" } }) });
  assert.equal(declared.client, null);

  const chunks = [" ".repeat(40 * 1024), " ".repeat(40 * 1024), JSON.stringify(doc())];
  const streamed = await run(URL_OK, { response: () => json("", { chunks }) });
  assert.equal(streamed.client, null);
});

test("a slow answer is aborted", async () => {
  const started = Date.now();
  const { client } = await run(URL_OK, { timeoutMs: 30, response: () => new Promise<Res>(() => {}) });
  assert.equal(client, null);
  assert.ok(Date.now() - started < 2000);
});

test("without timeoutMs the default is five seconds", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let settled = false;
    const pending = run(URL_OK, { response: () => new Promise<Res>(() => {}) }).then((result) => {
      settled = true;
      return result;
    });
    await new Promise((resolve) => setImmediate(resolve));
    mock.timers.tick(4999);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
    mock.timers.tick(1);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, true);
    assert.equal((await pending).client, null);
  } finally {
    mock.timers.reset();
  }
});

test("fields that fail the registration schema are refused", async () => {
  for (const over of [
    { redirect_uris: ["http://evil.example/cb"] },
    { redirect_uris: [] },
    { client_name: "" },
    { token_endpoint_auth_method: "client_secret_basic" },
  ]) {
    const { client, calls } = await run(URL_OK, { response: () => json(doc(over)) });
    assert.equal(client, null, JSON.stringify(over));
    assert.equal(calls.register, 0);
  }
});

test("malformed JSON and non-object bodies are refused", async () => {
  for (const body of ["{nope", "null", "[]", '"s"']) {
    assert.equal((await run(URL_OK, { response: () => json(body) })).client, null, body);
  }
});

test("a DNS failure is refused", async () => {
  const client = await clientFromMetadataUrl(URL_OK, {
    resolve: async () => {
      throw new Error("ENOTFOUND");
    },
  });
  assert.equal(client, null);
});

test("a body that stalls after the headers is aborted", async () => {
  const { client } = await run(URL_OK, {
    timeoutMs: 30,
    response: () => json("", { stream: new Readable({ read() {} }) }),
  });
  assert.equal(client, null);
});
