import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { registrationSchema } from "@/lib/oauth/clients";

const MAX_BYTES = 64 * 1024;
const TIMEOUT_MS = 5000;

export type MetadataClient = { id: string; name: string; redirectUris: string[] };

export type MetadataDeps = {
  fetch?: typeof fetch;
  resolve?: (host: string) => Promise<string[]>;
  register?: (input: { name: string; redirectUris: string[]; metadataUrl: string }) => Promise<string>;
  timeoutMs?: number;
};

function privateV4(address: string): boolean {
  const [a, b] = address.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

export function privateAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) return privateV4(address);
  if (kind !== 6) return true;

  const lower = address.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return privateV4(mapped[1]);
  if (lower === "::" || lower === "::1") return true;
  // fc00::/7 unique-local, fe80::/10 link-local, ff00::/8 multicast.
  return /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || lower.startsWith("ff");
}

async function resolveAll(host: string): Promise<string[]> {
  const rows = await lookup(host, { all: true });
  return rows.map((row) => row.address);
}

async function defaultRegister(input: { name: string; redirectUris: string[]; metadataUrl: string }) {
  const { registerClient } = await import("@/lib/oauth/grants");
  return registerClient(input);
}

async function readCapped(response: Response): Promise<string | null> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BYTES) return null;
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function fetchDocument(url: string, deps: MetadataDeps): Promise<unknown> {
  const controller = new AbortController();
  const ms = deps.timeoutMs ?? TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The race also bounds a fetch that ignores the signal.
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("timeout"));
    }, ms);
  });
  try {
    const response = await Promise.race([
      (deps.fetch ?? fetch)(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: { accept: "application/json" },
      }),
      expired,
    ]);
    if (response.status !== 200) return null;
    const type = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (type !== "application/json") return null;
    const text = await Promise.race([readCapped(response), expired]);
    if (text === null) return null;

    return JSON.parse(text);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// A DNS answer that changes between this check and the fetch is not caught: fetch resolves again.
export async function clientFromMetadataUrl(url: string, deps: MetadataDeps = {}): Promise<MetadataClient | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) return null;
  if (parsed.pathname === "/" || parsed.href !== url) return null;

  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : await (deps.resolve ?? resolveAll)(host);
  } catch {
    return null;
  }
  if (addresses.length === 0 || addresses.some(privateAddress)) return null;

  const document = await fetchDocument(url, deps);
  if (typeof document !== "object" || document === null) return null;
  if ((document as { client_id?: unknown }).client_id !== url) return null;
  const fields = registrationSchema.safeParse(document);
  if (!fields.success) return null;

  const name = fields.data.client_name;
  const redirectUris = fields.data.redirect_uris;
  const id = await (deps.register ?? defaultRegister)({ name, redirectUris, metadataUrl: url });

  return { id, name, redirectUris };
}
