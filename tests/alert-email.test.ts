import test from "node:test";
import assert from "node:assert/strict";

import { buildAlertEmail, escapeHtml, type EmailAlert } from "../lib/notifications/alert-email.ts";
import {
  buildEmailRequest,
  isPlausibleAddress,
  isRetryableStatus,
  readEmailConfig
} from "../lib/notifications/email.ts";

function alert(overrides: Partial<EmailAlert> = {}): EmailAlert {
  return {
    disputeId: "d1",
    kind: "DISPUTE_OPENED",
    title: "Order #1024: a chargeback was opened",
    body: "USD 180.00 is at stake.",
    urgency: 2,
    ...overrides
  };
}

test("a single alert uses its own title as the subject", () => {
  const email = buildAlertEmail({ shopDomain: "x.myshopify.com", alerts: [alert()] });
  assert.equal(email?.subject, "Order #1024: a chargeback was opened");
});

test("a batch names the worst and counts the rest", () => {
  // "3 disputes need you" hides which one matters. Naming the first does not.
  const email = buildAlertEmail({
    shopDomain: "x.myshopify.com",
    alerts: [alert({ title: "Order #1: Shopify has responded automatically" }), alert(), alert()]
  });

  assert.match(email!.subject, /^Order #1: Shopify has responded automatically/);
  assert.match(email!.subject, /and 2 more on x\.myshopify\.com/);
});

test("no alerts produces no email", () => {
  assert.equal(buildAlertEmail({ shopDomain: "x.myshopify.com", alerts: [] }), null);
});

test("plain text carries everything the HTML does", () => {
  const email = buildAlertEmail({
    shopDomain: "x.myshopify.com",
    alerts: [alert({ title: "First thing" }), alert({ title: "Second thing", body: "More detail." })],
    appUrl: "https://app.example/disputes"
  })!;

  for (const fragment of ["First thing", "Second thing", "More detail.", "https://app.example/disputes"]) {
    assert.ok(email.text.includes(fragment), `text is missing ${fragment}`);
    assert.ok(email.html.includes(fragment), `html is missing ${fragment}`);
  }
});

test("a merchant-supplied order name cannot inject HTML", () => {
  // Order names come from Shopify and a merchant can name an order anything.
  // Interpolating that unescaped would put it in every recipient's inbox.
  const email = buildAlertEmail({
    shopDomain: "x.myshopify.com",
    alerts: [alert({ title: '#<script>alert("x")</script>', body: "5 > 3 & rising" })]
  })!;

  assert.ok(!email.html.includes("<script>"), "script tag survived into the HTML body");
  assert.ok(email.html.includes("&lt;script&gt;"));
  assert.ok(email.html.includes("5 &gt; 3 &amp; rising"));

  // Plain text is not markup, so it is left readable.
  assert.ok(email.text.includes("5 > 3 & rising"));
});

test("the link is optional and its absence breaks nothing", () => {
  const email = buildAlertEmail({ shopDomain: "x.myshopify.com", alerts: [alert()], appUrl: null })!;
  assert.ok(!email.text.includes("Open Disputes Co-Pilot"));
  assert.ok(email.text.length > 0);
});

test("a trailing slash on the app URL does not double up", () => {
  const email = buildAlertEmail({
    shopDomain: "x.myshopify.com",
    alerts: [alert()],
    appUrl: "https://app.example/disputes/"
  })!;
  assert.ok(email.html.includes("https://app.example/disputes\""));
});

test("every email says why it was received and how to stop it", () => {
  const email = buildAlertEmail({ shopDomain: "shop.myshopify.com", alerts: [alert()] })!;
  assert.match(email.text, /shop\.myshopify\.com/);
  assert.match(email.text, /Settings/);
});

test("escapeHtml covers the five characters that matter", () => {
  assert.equal(escapeHtml(`<>&"'`), "&lt;&gt;&amp;&quot;&#39;");
  assert.equal(escapeHtml("plain"), "plain");
});

test("recipient sanity check rejects what would fail the whole batch", () => {
  assert.equal(isPlausibleAddress("owner@shop.com"), true);
  assert.equal(isPlausibleAddress("  owner@shop.com  "), true);

  assert.equal(isPlausibleAddress(""), false);
  assert.equal(isPlausibleAddress(null), false);
  assert.equal(isPlausibleAddress(undefined), false);
  assert.equal(isPlausibleAddress("not-an-address"), false);
  assert.equal(isPlausibleAddress("no@tld"), false);
  assert.equal(isPlausibleAddress("two addresses@a.com b@c.com"), false);
});

/* ------------------------------------------------------------------ *
 * Provider selection and wire format
 *
 * The provider is whichever account the company already has - an established
 * sending domain beats anything about an API surface. So both wire formats have
 * to be right, and neither can be the one that only gets tested in production.
 * ------------------------------------------------------------------ */

test("no from address means no email, whatever keys are set", () => {
  assert.equal(readEmailConfig({ SENDGRID_API_KEY: "k", RESEND_API_KEY: "k" }), null);
});

test("either key alone is enough", () => {
  assert.deepEqual(readEmailConfig({ RESEND_API_KEY: "r", ALERT_EMAIL_FROM: "a@b.com" }), {
    provider: "resend",
    apiKey: "r",
    from: "a@b.com"
  });

  assert.deepEqual(readEmailConfig({ SENDGRID_API_KEY: "s", ALERT_EMAIL_FROM: "a@b.com" }), {
    provider: "sendgrid",
    apiKey: "s",
    from: "a@b.com"
  });
});

test("with both keys, SendGrid wins - because having the key means having the account", () => {
  const config = readEmailConfig({
    SENDGRID_API_KEY: "s",
    RESEND_API_KEY: "r",
    ALERT_EMAIL_FROM: "a@b.com"
  });
  assert.equal(config?.provider, "sendgrid");
});

test("EMAIL_PROVIDER overrides, and does not silently fall through", () => {
  const chosen = readEmailConfig({
    EMAIL_PROVIDER: "resend",
    SENDGRID_API_KEY: "s",
    RESEND_API_KEY: "r",
    ALERT_EMAIL_FROM: "a@b.com"
  });
  assert.equal(chosen?.provider, "resend");

  // Asking for a provider whose key is absent must fail rather than quietly
  // sending through the other one - that is how mail leaves from a domain
  // nobody verified.
  assert.equal(
    readEmailConfig({ EMAIL_PROVIDER: "resend", SENDGRID_API_KEY: "s", ALERT_EMAIL_FROM: "a@b.com" }),
    null
  );
});

test("the Resend request matches its API", () => {
  const request = buildEmailRequest(
    { provider: "resend", apiKey: "key", from: "alerts@shop.com" },
    { to: "  owner@shop.com ", subject: "Subject", text: "Body", html: "<p>Body</p>" }
  );

  assert.equal(request.url, "https://api.resend.com/emails");
  assert.equal(request.headers.Authorization, "Bearer key");

  const body = JSON.parse(request.body);
  assert.equal(body.from, "alerts@shop.com");
  assert.deepEqual(body.to, ["owner@shop.com"], "recipient is trimmed");
  assert.equal(body.text, "Body");
  assert.equal(body.html, "<p>Body</p>");
});

test("the SendGrid request matches its API, with text before html", () => {
  const request = buildEmailRequest(
    { provider: "sendgrid", apiKey: "key", from: "alerts@shop.com" },
    { to: "owner@shop.com", subject: "Subject", text: "Body", html: "<p>Body</p>" }
  );

  assert.equal(request.url, "https://api.sendgrid.com/v3/mail/send");

  const body = JSON.parse(request.body);
  assert.deepEqual(body.personalizations, [{ to: [{ email: "owner@shop.com" }] }]);
  assert.deepEqual(body.from, { email: "alerts@shop.com" });

  // SendGrid uses content ORDER to pick the fallback part. Inverted, a
  // text-only client shows raw HTML.
  assert.equal(body.content[0].type, "text/plain");
  assert.equal(body.content[1].type, "text/html");
});

test("only transient failures are retried", () => {
  for (const status of [429, 500, 502, 503]) {
    assert.equal(isRetryableStatus(status), true, `${status} should be retried`);
  }
  // A bad key or an unverified domain fails identically forever.
  for (const status of [400, 401, 403, 404, 422]) {
    assert.equal(isRetryableStatus(status), false, `${status} should not be retried`);
  }
});
