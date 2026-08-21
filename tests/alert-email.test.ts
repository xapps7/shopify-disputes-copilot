import test from "node:test";
import assert from "node:assert/strict";

import { buildAlertEmail, escapeHtml, type EmailAlert } from "../lib/notifications/alert-email.ts";
import { isPlausibleAddress } from "../lib/notifications/email.ts";

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
