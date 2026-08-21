import test from "node:test";
import assert from "node:assert/strict";

import { buildWebhookPayload, checkWebhookUrl } from "../lib/notifications/webhook.ts";

// This is a server-side request forgery surface: the URL comes from a merchant
// and the request leaves OUR server. Unguarded, a merchant could have the app
// fetch its own cloud instance credentials, or probe internal addresses the
// container can reach and the internet cannot. These tests are the guard.

test("accepts an ordinary Slack webhook", () => {
  const check = checkWebhookUrl("https://hooks.slack.com/services/T000/B000/XXXX");
  assert.equal(check.ok, true);
});

test("accepts Discord and Zapier style URLs", () => {
  for (const url of [
    "https://discord.com/api/webhooks/123/abc",
    "https://hooks.zapier.com/hooks/catch/123/abc/",
    "https://n8n.example.com/webhook/abc?token=1"
  ]) {
    assert.equal(checkWebhookUrl(url).ok, true, url);
  }
});

test("refuses cloud instance metadata - the reason this file exists", () => {
  // 169.254.169.254 is where AWS, GCP and Azure serve instance credentials.
  // Reaching it from the app server turns a webhook field into key theft.
  const check = checkWebhookUrl("https://169.254.169.254/latest/meta-data/iam/security-credentials/");
  assert.equal(check.ok, false);
  assert.equal(check.ok === false && check.reason, "private-host");
});

test("refuses loopback and every private range", () => {
  for (const host of [
    "127.0.0.1",
    "localhost",
    "0.0.0.0",
    "10.0.0.5",
    "192.168.1.1",
    "172.16.0.1",
    "172.31.255.255",
    "[::1]",
    "app.internal",
    "printer.local",
    "239.255.255.250"
  ]) {
    const check = checkWebhookUrl(`https://${host}/hook`);
    assert.equal(check.ok, false, `${host} should be refused`);
  }
});

test("but allows public addresses that merely look adjacent", () => {
  // 172.32 is outside RFC 1918; 11.x and 169.253 are public. A guard that is
  // too greedy blocks legitimate endpoints and gets switched off.
  for (const host of ["172.32.0.1", "11.0.0.1", "169.253.0.1"]) {
    assert.equal(checkWebhookUrl(`https://${host}/hook`).ok, true, `${host} should be allowed`);
  }
});

test("requires https, so the alert cannot be read in transit", () => {
  const check = checkWebhookUrl("http://hooks.slack.com/services/x");
  assert.equal(check.ok, false);
  assert.equal(check.ok === false && check.reason, "not-https");
});

test("refuses odd ports, which are more often a port scan than a webhook", () => {
  assert.equal(checkWebhookUrl("https://example.com:22/hook").ok, false);
  assert.equal(checkWebhookUrl("https://example.com:6379/hook").ok, false);

  // The standard port, stated or implied, is fine.
  assert.equal(checkWebhookUrl("https://example.com:443/hook").ok, true);
  assert.equal(checkWebhookUrl("https://example.com/hook").ok, true);
});

test("refuses embedded credentials", () => {
  const check = checkWebhookUrl("https://user:pass@example.com/hook");
  assert.equal(check.ok, false);
  assert.equal(check.ok === false && check.reason, "has-credentials");
});

test("empty and malformed values fail with something readable", () => {
  for (const value of ["", "   ", null, undefined, "not a url", "slack.com/hook"]) {
    const check = checkWebhookUrl(value as string);
    assert.equal(check.ok, false);
    assert.ok(check.ok === false && check.message.length > 10, "the message should tell them what to do");
  }
});

test("every rejection explains itself in a merchant's terms", () => {
  const check = checkWebhookUrl("https://127.0.0.1/hook");
  assert.equal(check.ok, false);
  if (!check.ok) {
    assert.match(check.message, /private or internal/i);
    assert.ok(!/SSRF|RFC 1918/.test(check.message), "no jargon in merchant-facing copy");
  }
});

test("the payload leads with text, so a Slack URL works unconfigured", () => {
  const payload = buildWebhookPayload({
    shopDomain: "x.myshopify.com",
    alerts: [
      { disputeId: "d1", kind: "DISPUTE_OPENED", title: "Order #1024: a chargeback was opened", body: "USD 180 at stake." }
    ]
  });

  // Slack and Discord-compatible endpoints render this field and nothing else.
  assert.match(payload.text, /Order #1024/);
  assert.match(payload.text, /USD 180/);
  assert.equal(payload.shopDomain, "x.myshopify.com");
  assert.equal(payload.alerts.length, 1);
});

test("the payload carries no customer data", () => {
  // A webhook goes to a third party the merchant chose and we have no agreement
  // with, so it gets the order reference and the money - nothing personal.
  const payload = buildWebhookPayload({
    shopDomain: "x.myshopify.com",
    alerts: [{ disputeId: "d1", kind: "DISPUTE_OPENED", title: "t", body: "b" }]
  });

  const serialised = JSON.stringify(payload);
  for (const field of ["customerEmail", "customerName", "shippingAddress", "email"]) {
    assert.ok(!serialised.includes(field), `${field} must never reach a webhook`);
  }
  assert.deepEqual(Object.keys(payload.alerts[0]).sort(), ["body", "disputeId", "kind", "title"]);
});

test("multiple alerts read as one legible message", () => {
  const payload = buildWebhookPayload({
    shopDomain: "x.myshopify.com",
    alerts: [
      { disputeId: "a", kind: "AUTO_SUBMITTED", title: "First", body: "One." },
      { disputeId: "b", kind: "DISPUTE_OPENED", title: "Second", body: "Two." }
    ]
  });

  assert.match(payload.text, /First\nOne\.\n\nSecond\nTwo\./);
});
