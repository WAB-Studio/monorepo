import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";

import { registrationSchema } from "@/lib/oauth/clients";

const MAX_BYTES = 64 * 1024;
const TIMEOUT_MS = 5000;

export type MetadataClient = { id: string; name: string; redirectUris: string[] };

export type MetadataDeps = {
  request?: typeof request;
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

// The socket connects to `address`, the one already validated; TLS and Host still carry the URL's name.
function fetchDocument(url: string, address: string, deps: MetadataDeps): Promise<unknown> {
  const host = new URL(url).hostname;
  const family = isIP(address);

  return new Promise<unknown>((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      req.destroy();
      finish(null);
    }, deps.timeoutMs ?? TIMEOUT_MS);
    const finish = (value: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    const req = (deps.request ?? request)(
      url,
      {
        method: "GET",
        headers: { accept: "application/json" },
        servername: isIP(host) ? undefined : host,
        lookup: ((_host: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
          if (options?.all) callback(null, [{ address, family }]);
          else callback(null, address, family);
        }) as never,
      },
      (res) => {
        const type = String(res.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
        const declared = Number(res.headers["content-length"]);
        if (res.statusCode !== 200 || type !== "application/json" || (Number.isFinite(declared) && declared > MAX_BYTES)) {
          res.destroy();
          return finish(null);
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > MAX_BYTES) {
            res.destroy();
            return finish(null);
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          try {
            finish(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            finish(null);
          }
        });
        res.on("error", () => finish(null));
      },
    );
    req.on("error", () => finish(null));
    req.end();
  });
}

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

  const document = await fetchDocument(url, addresses[0], deps);
  if (typeof document !== "object" || document === null) return null;
  if ((document as { client_id?: unknown }).client_id !== url) return null;
  const fields = registrationSchema.safeParse(document);
  if (!fields.success) return null;

  const name = fields.data.client_name;
  const redirectUris = fields.data.redirect_uris;
  const id = await (deps.register ?? defaultRegister)({ name, redirectUris, metadataUrl: url });

  return { id, name, redirectUris };
}
