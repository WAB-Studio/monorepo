import assert from "node:assert/strict";
import test from "node:test";

import { clientFromMetadataUrl, privateAddress, type MetadataDeps } from "./client-metadata";

const URL_OK = "https://app.example/client.json";
const doc = (over: Record<string, unknown> = {}) => ({
  client_id: URL_OK,
  client_name: "Claude",
  redirect_uris: ["https://app.example/cb"],
  ...over,
});
const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });

function run(url: string, over: { response?: () => Promise<Response>; address?: string; timeoutMs?: number } = {}) {
  const calls = { fetch: 0, register: 0 };
  const deps: MetadataDeps = {
    fetch: (async () => {
      calls.fetch++;
      return (over.response ?? (async () => json(doc())))();
    }) as typeof fetch,
    resolve: async () => [over.address ?? "93.184.216.34"],
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
    const { client, calls } = await run(URL_OK, { response: async () => json(doc({ client_id: id })) });
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
    const { client, calls } = await run(url, { response: async () => json(doc({ client_id: url })) });
    assert.equal(client, null, url);
    assert.equal(calls.fetch, 0, url);
  }
});

test("a host resolving to a private, loopback or link-local address is refused before any fetch", async () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:10.0.0.1"]) {
    const { client, calls } = await run(URL_OK, { address });
    assert.equal(client, null, address);
    assert.equal(calls.fetch, 0, address);
  }
});

test("a host with one public and one private address is refused", async () => {
  const calls = { fetch: 0 };
  const client = await clientFromMetadataUrl(URL_OK, {
    resolve: async () => ["93.184.216.34", "10.0.0.1"],
    fetch: (async () => (calls.fetch++, json(doc()))) as typeof fetch,
    register: async () => "x",
  });
  assert.equal(client, null);
  assert.equal(calls.fetch, 0);
});

test("an IP-literal host is judged without resolving", async () => {
  for (const url of ["https://127.0.0.1/c.json", "https://10.0.0.1/c.json", "https://[::1]/c.json"]) {
    const { client } = await run(url, { response: async () => json(doc({ client_id: url })) });
    assert.equal(client, null, url);
  }
});

test("public addresses pass the address check", () => {
  for (const address of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "100.63.0.1", "2606:4700::1111"]) {
    assert.equal(privateAddress(address), false, address);
  }
});

test("the fetch never follows a redirect", async () => {
  let init: RequestInit | undefined;
  const client = await clientFromMetadataUrl(URL_OK, {
    resolve: async () => ["93.184.216.34"],
    fetch: (async (_u: unknown, i?: RequestInit) => {
      init = i;
      return new Response(null, { status: 302, headers: { location: "https://other.example/c.json" } });
    }) as typeof fetch,
    register: async () => "x",
  });
  assert.equal(client, null);
  assert.equal(init?.redirect, "manual");
});

test("a non-200 or non-JSON answer is refused", async () => {
  for (const response of [
    async () => json(doc(), { status: 404 }),
    async () => json(doc(), { headers: { "content-type": "text/html" } }),
    async () => json(doc(), { headers: {} }),
  ]) {
    assert.equal((await run(URL_OK, { response })).client, null);
  }
});

test("content-type parameters are tolerated", async () => {
  const { client } = await run(URL_OK, {
    response: async () => json(doc(), { headers: { "content-type": "application/json; charset=utf-8" } }),
  });
  assert.notEqual(client, null);
});

test("a body over 64 KB is refused, declared or streamed", async () => {
  // Whitespace keeps the document valid, so only the cap can refuse it.
  const padded = " ".repeat(70 * 1024) + JSON.stringify(doc());
  assert.notEqual((await run(URL_OK, { response: async () => json(JSON.stringify(doc())) })).client, null);
  assert.equal((await run(URL_OK, { response: async () => json(padded) })).client, null);

  const declared = await run(URL_OK, {
    response: async () => json(doc(), { headers: { "content-type": "application/json", "content-length": "70000" } }),
  });
  assert.equal(declared.client, null);

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder();
      c.enqueue(enc.encode(" ".repeat(40 * 1024)));
      c.enqueue(enc.encode(" ".repeat(40 * 1024)));
      c.enqueue(enc.encode(JSON.stringify(doc())));
      c.close();
    },
  });
  const streamed = await run(URL_OK, {
    response: async () => new Response(stream, { headers: { "content-type": "application/json" } }),
  });
  assert.equal(streamed.client, null);
});

test("a slow answer is aborted", async () => {
  const started = Date.now();
  const { client } = await run(URL_OK, {
    timeoutMs: 30,
    response: () => new Promise<Response>(() => {}),
  });
  assert.equal(client, null);
  assert.ok(Date.now() - started < 2000);
});

test("a fetch honouring the abort signal is cut off", async () => {
  const client = await clientFromMetadataUrl(URL_OK, {
    timeoutMs: 30,
    resolve: async () => ["93.184.216.34"],
    register: async () => "x",
    fetch: ((_u: unknown, i?: RequestInit) =>
      new Promise((_r, reject) => i?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as typeof fetch,
  });
  assert.equal(client, null);
});

test("fields that fail the registration schema are refused", async () => {
  for (const over of [
    { redirect_uris: ["http://evil.example/cb"] },
    { redirect_uris: [] },
    { client_name: "" },
    { token_endpoint_auth_method: "client_secret_basic" },
  ]) {
    const { client, calls } = await run(URL_OK, { response: async () => json(doc(over)) });
    assert.equal(client, null, JSON.stringify(over));
    assert.equal(calls.register, 0);
  }
});

test("malformed JSON and non-object bodies are refused", async () => {
  for (const body of ["{nope", "null", "[]", '"s"']) {
    assert.equal((await run(URL_OK, { response: async () => json(body) })).client, null, body);
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
  const stalled = new ReadableStream<Uint8Array>({ start() {} });
  const { client } = await run(URL_OK, {
    timeoutMs: 30,
    response: async () => new Response(stalled, { headers: { "content-type": "application/json" } }),
  });
  assert.equal(client, null);
});
