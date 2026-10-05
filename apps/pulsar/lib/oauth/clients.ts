import { z } from "zod";

const LOOPBACK = new Set(["localhost", "127.0.0.1"]);

function redirectUriAcceptable(value: string): boolean {
  if (value.includes("#")) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;

  return url.protocol === "http:" && LOOPBACK.has(url.hostname);
}

const GRANT_TYPES = ["authorization_code", "refresh_token"] as const;

// An RFC 7591 §2 body; fields the server does not keep are dropped.
export const registrationSchema = z.object({
  client_name: z.string().min(1).max(80),
  redirect_uris: z.array(z.string().refine(redirectUriAcceptable)).min(1).max(5),
  token_endpoint_auth_method: z.literal("none").optional(),
  grant_types: z.array(z.enum(GRANT_TYPES)).optional(),
});

export type Registration = z.infer<typeof registrationSchema>;

export function redirectAllowed(client: { redirectUris: readonly string[] }, uri: string): boolean {
  return client.redirectUris.includes(uri);
}
