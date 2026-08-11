/**
 * App Bridge session token (JWT) verification.
 *
 * Embedded Shopify apps must authenticate every request with a session token,
 * not a cookie: the admin renders the app in a cross-site iframe, where a
 * SameSite=Lax cookie is never sent. Before this existed the app resolved the
 * current shop from an unauthenticated `?shop=` query parameter, which meant
 * anyone could read or mutate any merchant's data by editing a URL.
 *
 * Uses Web Crypto so the same implementation runs in both the Node.js and Edge
 * runtimes (middleware).
 */

const encoder = new TextEncoder();

function toBuffer(value: string): ArrayBuffer {
  const bytes = encoder.encode(value);
  const buffer = new ArrayBuffer(bytes.length);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

/** Clock skew tolerance, in seconds. */
const LEEWAY_SECONDS = 10;

export type SessionTokenClaims = {
  shopDomain: string;
  sessionId: string | null;
  userId: string | null;
  expiresAt: number;
};

function base64UrlDecode(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), "="));
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return buffer;
}

function decodeJsonSegment(segment: string): Record<string, unknown> | null {
  try {
    const json = new TextDecoder().decode(base64UrlDecode(segment));
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function hmacKey(secret: string, usage: KeyUsage[]) {
  const secretBytes = encoder.encode(secret);
  const raw = new ArrayBuffer(secretBytes.length);
  new Uint8Array(raw).set(secretBytes);
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, usage);
}

/** Extracts `example.myshopify.com` from a `https://example.myshopify.com` claim. */
export function shopDomainFromUrlClaim(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  let host = value;
  try {
    host = new URL(value.includes("://") ? value : `https://${value}`).hostname;
  } catch {
    return null;
  }

  return /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(host) ? host.toLowerCase() : null;
}

/**
 * Verifies an App Bridge session token and returns its claims, or null.
 * Never throws — a malformed token is simply unauthenticated.
 */
export async function verifySessionToken(
  token: string,
  options: { apiKey: string; apiSecret: string; now?: number }
): Promise<SessionTokenClaims | null> {
  const { apiKey, apiSecret } = options;
  if (!token || !apiKey || !apiSecret) {
    return null;
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }

  const [headerSegment, payloadSegment, signatureSegment] = parts;

  const header = decodeJsonSegment(headerSegment);
  if (!header || header.alg !== "HS256") {
    // Refuse "none" and any asymmetric algorithm confusion.
    return null;
  }

  let signatureValid = false;
  try {
    const key = await hmacKey(apiSecret, ["verify"]);
    signatureValid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlDecode(signatureSegment),
      toBuffer(`${headerSegment}.${payloadSegment}`)
    );
  } catch {
    return null;
  }

  if (!signatureValid) {
    return null;
  }

  const payload = decodeJsonSegment(payloadSegment);
  if (!payload) {
    return null;
  }

  if (payload.aud !== apiKey) {
    return null;
  }

  const nowSeconds = Math.floor((options.now ?? Date.now()) / 1000);
  const exp = typeof payload.exp === "number" ? payload.exp : null;
  const nbf = typeof payload.nbf === "number" ? payload.nbf : null;

  if (exp === null || exp + LEEWAY_SECONDS < nowSeconds) {
    return null;
  }

  if (nbf !== null && nbf - LEEWAY_SECONDS > nowSeconds) {
    return null;
  }

  const shopDomain = shopDomainFromUrlClaim(payload.dest);
  if (!shopDomain) {
    return null;
  }

  // `iss` is the admin URL for the same shop; a mismatch means a token minted
  // for a different store was replayed here.
  const issuerDomain = shopDomainFromUrlClaim(payload.iss);
  if (issuerDomain && issuerDomain !== shopDomain) {
    return null;
  }

  return {
    shopDomain,
    sessionId: typeof payload.sid === "string" ? payload.sid : null,
    userId: typeof payload.sub === "string" ? payload.sub : null,
    expiresAt: exp * 1000
  };
}

/* ------------------------------------------------------------------ *
 * First-party session cookie
 *
 * Session tokens are short-lived and only available to client-side code via
 * App Bridge. Server-rendered navigations inside the iframe therefore need a
 * cookie — but one we mint ourselves, only ever from an already-verified
 * session token, and signed so it cannot be forged the way `?shop=` could.
 * ------------------------------------------------------------------ */

export const SESSION_COOKIE = "dc_session";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function bytesToBase64Url(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function createSessionCookieValue(
  shopDomain: string,
  apiSecret: string,
  now = Date.now()
): Promise<string> {
  const expiresAt = now + SESSION_TTL_MS;
  const payload = `${shopDomain}.${expiresAt}`;
  const key = await hmacKey(apiSecret, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, toBuffer(payload));
  return `v1.${payload}.${bytesToBase64Url(signature)}`;
}

export async function readSessionCookieValue(
  value: string | undefined | null,
  apiSecret: string,
  now = Date.now()
): Promise<string | null> {
  if (!value || !apiSecret) {
    return null;
  }

  const parts = value.split(".");
  // v1 . shop . expiresAt . signature — the shop domain itself contains dots.
  if (parts.length < 4 || parts[0] !== "v1") {
    return null;
  }

  const signature = parts[parts.length - 1];
  const expiresAtRaw = parts[parts.length - 2];
  const shopDomain = parts.slice(1, parts.length - 2).join(".");
  const expiresAt = Number(expiresAtRaw);

  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    return null;
  }

  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shopDomain)) {
    return null;
  }

  const key = await hmacKey(apiSecret, ["verify"]);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    base64UrlDecode(signature),
    toBuffer(`${shopDomain}.${expiresAt}`)
  );

  return valid ? shopDomain : null;
}
