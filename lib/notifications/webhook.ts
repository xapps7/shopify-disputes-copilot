/**
 * Outgoing alert webhooks, one per merchant.
 *
 * A merchant pastes a Slack, Discord, Zapier or n8n URL and gets the same
 * critical-timing notices the email carries. Deliberately one field and one
 * POST: anything more and it stops being the thing you can set up in ten
 * seconds while a deadline is running.
 *
 * SECURITY: the URL comes from the merchant and the request leaves OUR server,
 * which makes this a server-side request forgery surface. Unguarded, a merchant
 * could point it at http://169.254.169.254/ and have the app fetch its own AWS
 * instance credentials, or sweep internal addresses the container can reach and
 * the internet cannot. The guards below are the whole reason this file is not
 * three lines.
 *
 * Pure and dependency-free so the guards are directly testable.
 */

export type WebhookRejection =
  | "empty"
  | "not-a-url"
  | "not-https"
  | "private-host"
  | "bad-port"
  | "has-credentials";

export type WebhookCheck = { ok: true; url: string } | { ok: false; reason: WebhookRejection; message: string };

const MESSAGES: Record<WebhookRejection, string> = {
  empty: "Enter a webhook URL.",
  "not-a-url": "That does not look like a URL. It should start with https://",
  "not-https": "Webhook URLs must use https, so the alert cannot be read in transit.",
  "private-host":
    "That address is on a private or internal network, which this app will not send to. Use a public https URL.",
  "bad-port": "Only the standard https port is allowed.",
  "has-credentials": "Remove the username and password from the URL. Put the secret in the path or a query parameter."
};

/** 443 only. A webhook on an odd port is far more often a port scan than a webhook. */
const ALLOWED_PORTS = new Set(["", "443"]);

/**
 * Hostnames that must never be fetched from the server.
 *
 * Covers loopback, link-local - which is where cloud instance metadata lives,
 * the specific target that turns SSRF into credential theft - and the RFC 1918
 * private ranges. Matched on the literal host, so a hostname that RESOLVES to a
 * private address still gets through; closing that needs resolution at request
 * time, and is noted rather than pretended away.
 */
function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local")
  ) {
    return true;
  }

  // IPv6 loopback and unique-local.
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) {
    return true;
  }

  const parts = host.split(".");
  if (parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part))) {
    const [a, b] = parts.map(Number);

    if (a === 127 || a === 0 || a === 10) return true;
    if (a === 169 && b === 254) return true; // cloud instance metadata
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a >= 224) return true; // multicast and reserved
  }

  return false;
}

/** Validates a merchant-supplied webhook URL. */
export function checkWebhookUrl(raw: string | null | undefined): WebhookCheck {
  const value = (raw ?? "").trim();

  if (!value) {
    return { ok: false, reason: "empty", message: MESSAGES.empty };
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: "not-a-url", message: MESSAGES["not-a-url"] };
  }

  if (url.protocol !== "https:") {
    return { ok: false, reason: "not-https", message: MESSAGES["not-https"] };
  }

  if (url.username || url.password) {
    return { ok: false, reason: "has-credentials", message: MESSAGES["has-credentials"] };
  }

  if (!ALLOWED_PORTS.has(url.port)) {
    return { ok: false, reason: "bad-port", message: MESSAGES["bad-port"] };
  }

  if (isPrivateHost(url.hostname)) {
    return { ok: false, reason: "private-host", message: MESSAGES["private-host"] };
  }

  return { ok: true, url: url.toString() };
}

export type WebhookAlert = {
  disputeId: string;
  kind: string;
  title: string;
  body: string;
};

/**
 * The payload.
 *
 * `text` first and unconditionally, because Slack and Discord-compatible
 * endpoints render that field and nothing else - so pasting a Slack URL works
 * with no mapping, no template and no configuration. The structured array sits
 * alongside it for anything that can read JSON properly.
 *
 * Deliberately carries no customer data. A webhook goes to a third party the
 * merchant chose and we have no agreement with, so it gets the order reference
 * and the money and nothing that could be called personal data.
 */
export function buildWebhookPayload(options: { shopDomain: string; alerts: WebhookAlert[] }) {
  const lines = options.alerts.map((alert) => `${alert.title}\n${alert.body}`);

  return {
    text: lines.join("\n\n"),
    shopDomain: options.shopDomain,
    alerts: options.alerts.map((alert) => ({
      disputeId: alert.disputeId,
      kind: alert.kind,
      title: alert.title,
      body: alert.body
    }))
  };
}
