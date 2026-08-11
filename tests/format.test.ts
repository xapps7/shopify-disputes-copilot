import test from "node:test";
import assert from "node:assert/strict";

import {
  EMPTY_MONEY,
  formatCurrencyTotals,
  formatMoney,
  sumByCurrency
} from "../lib/format/money.ts";
import { daysUntil, describeDeadline, formatDate, formatDateTime, isDueSoon } from "../lib/format/date.ts";
import {
  numericDisputeId,
  shopifyAdminDisputeUrl,
  storeHandleFromShopDomain
} from "../lib/format/shopify-admin.ts";

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

test("formats each currency in its own symbol instead of a hardcoded $", () => {
  assert.equal(formatMoney("129.5", "USD"), "$129.50");
  assert.equal(formatMoney("129.5", "EUR"), "€129.50");
  assert.equal(formatMoney("129.5", "GBP"), "£129.50");
  assert.equal(formatMoney("1299", "JPY"), "¥1,299");
  // The old UI rendered "CAD 129.5" as literal text.
  assert.notEqual(formatMoney("129.5", "CAD"), "CAD 129.5");
});

test("groups thousands and always shows minor units", () => {
  assert.equal(formatMoney("1234567.5", "USD"), "$1,234,567.50");
  assert.equal(formatMoney(129.5, "USD"), "$129.50");
});

test("zero is a real amount and renders as zero", () => {
  assert.equal(formatMoney("0", "USD"), "$0.00");
  assert.equal(formatMoney(0, "EUR"), "€0.00");
});

test("null, undefined and unparseable amounts render as the empty marker, not 0", () => {
  assert.equal(formatMoney(null, "USD"), EMPTY_MONEY);
  assert.equal(formatMoney(undefined, "USD"), EMPTY_MONEY);
  assert.equal(formatMoney("", "USD"), EMPTY_MONEY);
  assert.equal(formatMoney("not-a-number", "USD"), EMPTY_MONEY);
  assert.notEqual(formatMoney(null, "USD"), "$0.00");
});

test("a missing or malformed currency never silently claims USD", () => {
  assert.equal(formatMoney("129.5", null), "129.50");
  assert.equal(formatMoney("129.5", undefined), "129.50");
  assert.equal(formatMoney("129.5", "dollars"), "129.50");
  assert.equal(formatMoney("129.5", "usd"), "$129.50");
});

test("totals are grouped per currency instead of summed together", () => {
  const totals = sumByCurrency([
    { amount: "100.00", currencyCode: "USD" },
    { amount: "50.50", currencyCode: "USD" },
    { amount: "20.00", currencyCode: "EUR" },
    { amount: null, currencyCode: "EUR" }
  ]);

  assert.deepEqual(totals, [
    { currencyCode: "USD", total: 150.5, count: 2 },
    { currencyCode: "EUR", total: 20, count: 1 }
  ]);
  assert.equal(formatCurrencyTotals(totals), "$150.50 + €20.00");
});

test("an empty ledger formats as the empty marker", () => {
  assert.equal(formatCurrencyTotals(sumByCurrency([])), EMPTY_MONEY);
});

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

test("dates format deterministically in UTC regardless of host locale", () => {
  assert.equal(formatDate("2026-03-25T00:30:00.000Z"), "Mar 25, 2026");
  // Same instant, explicitly bucketed in another zone.
  assert.equal(formatDate("2026-03-25T00:30:00.000Z", { timeZone: "America/Los_Angeles" }), "Mar 24, 2026");
  assert.equal(formatDate(null), "—");
  assert.equal(formatDate(null, { fallback: "No deadline" }), "No deadline");
  assert.equal(formatDate("garbage"), "—");
});

test("date-times include the zone so a deadline is never ambiguous", () => {
  assert.match(formatDateTime("2026-03-25T14:03:00.000Z"), /Mar 25, 2026, 14:03 UTC/);
  assert.equal(formatDateTime(null), "—");
});

test("day deltas are calendar days, not raw millisecond division", () => {
  const now = "2026-03-25T23:30:00.000Z";
  // Only 30 minutes away, but it is the next calendar day.
  assert.equal(daysUntil("2026-03-26T00:00:00.000Z", now), 1);
  // Almost 24 hours earlier in the day, but still today.
  assert.equal(daysUntil("2026-03-25T00:05:00.000Z", now), 0);
  assert.equal(daysUntil(null, now), null);
});

// ---------------------------------------------------------------------------
// Deadline urgency
// ---------------------------------------------------------------------------

const NOW = "2026-03-25T12:00:00.000Z";

test("overdue deadlines say so in words, not only in red", () => {
  const yesterday = describeDeadline("2026-03-24T12:00:00.000Z", NOW);
  assert.equal(yesterday.state, "overdue");
  assert.equal(yesterday.label, "Overdue by 1 day");
  assert.equal(yesterday.tone, "critical");
  assert.equal(yesterday.isUrgent, true);

  const lastWeek = describeDeadline("2026-03-18T12:00:00.000Z", NOW);
  assert.equal(lastWeek.label, "Overdue by 7 days");
  assert.equal(lastWeek.daysRemaining, -7);
});

test("a deadline later today is 'Due today', not overdue", () => {
  const today = describeDeadline("2026-03-25T23:59:00.000Z", NOW);
  assert.equal(today.state, "today");
  assert.equal(today.label, "Due today");
  assert.equal(today.isUrgent, true);

  // Earlier the same calendar day still reads as due today, not overdue.
  assert.equal(describeDeadline("2026-03-25T01:00:00.000Z", NOW).label, "Due today");
});

test("future deadlines state the number of days remaining", () => {
  assert.equal(describeDeadline("2026-03-26T12:00:00.000Z", NOW).label, "Due in 1 day");
  assert.equal(describeDeadline("2026-03-27T12:00:00.000Z", NOW).label, "Due in 2 days");
  assert.equal(describeDeadline("2026-04-01T12:00:00.000Z", NOW).label, "Due in 7 days");

  assert.equal(describeDeadline("2026-03-27T12:00:00.000Z", NOW).isUrgent, true);
  assert.equal(describeDeadline("2026-03-28T12:00:00.000Z", NOW).isUrgent, false);
  assert.equal(describeDeadline("2026-03-28T12:00:00.000Z", NOW).tone, "info");
});

test("REGRESSION: a dispute with no deadline is not urgent", () => {
  // `new Date(dispute.evidenceDueBy ?? Date.now())` made the delta 0, so every
  // deadline-less dispute rendered the "Urgent" badge.
  const evidenceDueBy: string | null = null;
  const legacyDelta = new Date(evidenceDueBy ?? Date.now()).getTime() - Date.now();
  assert.ok(legacyDelta <= 172_800_000, "reproduces the old always-urgent behaviour");

  const none = describeDeadline(null, NOW);
  assert.equal(none.state, "none");
  assert.equal(none.label, "No deadline");
  assert.equal(none.tone, undefined);
  assert.equal(none.daysRemaining, null);
  assert.equal(none.isUrgent, false);
  assert.equal(isDueSoon(null, NOW), false);
  assert.equal(isDueSoon(undefined, NOW), false);
  assert.equal(isDueSoon("", NOW), false);
});

test("isDueSoon only fires inside the urgency window", () => {
  assert.equal(isDueSoon("2026-03-24T12:00:00.000Z", NOW), true);
  assert.equal(isDueSoon("2026-03-25T12:00:00.000Z", NOW), true);
  assert.equal(isDueSoon("2026-03-27T12:00:00.000Z", NOW), true);
  assert.equal(isDueSoon("2026-03-28T12:00:00.000Z", NOW), false);
});

// ---------------------------------------------------------------------------
// Shopify Admin deep link
// ---------------------------------------------------------------------------

test("builds the Shopify Admin dispute URL from the shop domain and gid", () => {
  assert.equal(storeHandleFromShopDomain("acme-supply.myshopify.com"), "acme-supply");
  assert.equal(numericDisputeId("gid://shopify/ShopifyPaymentsDispute/11450876085"), "11450876085");
  assert.equal(
    shopifyAdminDisputeUrl("acme-supply.myshopify.com", "gid://shopify/ShopifyPaymentsDispute/11450876085"),
    "https://admin.shopify.com/store/acme-supply/payments/disputes/11450876085"
  );
});

test("returns null rather than a broken admin link when either half is unknown", () => {
  assert.equal(shopifyAdminDisputeUrl(null, "gid://shopify/ShopifyPaymentsDispute/1"), null);
  assert.equal(shopifyAdminDisputeUrl("acme-supply.myshopify.com", null), null);
  assert.equal(shopifyAdminDisputeUrl("acme-supply.myshopify.com", "gid://shopify/ShopifyPaymentsDispute/"), null);
});
