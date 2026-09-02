import test from "node:test";
import assert from "node:assert/strict";

import { PAID_CAPABILITIES, planAllows, type Capability } from "../lib/billing/plans.ts";
import {
  buildEvidenceFieldStates,
  draftEvidenceFields,
  type EvidenceFieldKey
} from "../lib/disputes/evidence-fields.ts";
import { getReasonProfile } from "../lib/disputes/reason-codes.ts";

/**
 * The gates themselves live in route handlers and in getDisputeDetail, and both
 * import the database through the `@/` alias, so neither can be loaded by a test
 * that runs under `node --experimental-strip-types`. What CAN be loaded is the
 * pair of pure decisions those gates are built out of, and they are where the
 * expensive mistakes are:
 *
 *   - `planAllows` deciding whether the app writes the evidence at all;
 *   - `buildEvidenceFieldStates` deciding what a merchant sees when it does not.
 *
 * The second one is the dangerous half. The free plan is served by handing that
 * function an EMPTY drafts object, which only works because `saved` wins over
 * `drafts` inside it. If that precedence ever flipped, or an empty drafts object
 * ever started falling back to a template, the paywall would either leak the
 * paid writing or - far worse - erase writing the merchant did themselves. The
 * assertions below are what would fail first.
 */

const DRAFT_CONTEXT = {
  reasonLabel: "Product not received",
  reasonQuestion: "Did the customer get what they paid for?",
  orderName: "#1042",
  orderTotal: "120.00",
  currencyCode: "USD",
  customerName: "Dana Reed",
  customerEmail: "dana@example.com",
  shippingAddress: "12 Oak Street, Austin, TX, 78701, US",
  fulfillmentStatus: "FULFILLED",
  trackingSummaries: ["UPS 1Z999"],
  lineItemSummaries: ["Wool blanket x1"],
  refundPolicyUrl: "https://example.com/refunds",
  returnPolicyUrl: "https://example.com/returns",
  cancellationPolicyUrl: "",
  supportEmail: "help@example.com",
  statementDescriptor: "EXAMPLE STORE",
  orderPlacedAt: "2026-07-01"
};

const PRIORITY_FIELDS = getReasonProfile("PRODUCT_NOT_RECEIVED").priorityFields;

/**
 * A priority field that is TEXT, not a file slot. `priorityFields` mixes both,
 * and only the text ones are the app's writing - the file slots are the
 * merchant's own uploads and were never drafted for anybody.
 */
const TEXT_PRIORITY_KEY = buildEvidenceFieldStates(PRIORITY_FIELDS, {}, {}).find(
  (field) => field.priority
)?.key as EvidenceFieldKey;

/** Exactly the expression getDisputeDetail uses to build its drafts argument. */
function draftsForPlan(plan: string): Partial<Record<EvidenceFieldKey, string>> {
  return planAllows(plan, "AUTO_DRAFT") ? draftEvidenceFields(DRAFT_CONTEXT) : {};
}

/* ------------------------------------------------ what the routes refuse --- */

test("every capability the server gates is refused on free and allowed on paid", () => {
  // The list the route handlers actually pass to requireCapability. If one of
  // these ever became free by accident, the paid half of the product would be
  // free for everybody and nobody would report it.
  const gated: Capability[] = [
    "AUTO_DRAFT",
    "DOCUMENT_LIBRARY",
    "PACKET_EXPORT",
    "PL_EXPORT",
    "PUSH_TO_SHOPIFY"
  ];

  assert.deepEqual([...gated].sort(), [...PAID_CAPABILITIES].sort(), "a paid capability has no gate");

  for (const capability of gated) {
    assert.equal(planAllows("STARTER", capability), false, `${capability} leaked onto free`);
    assert.equal(planAllows("GROWTH", capability), true, `${capability} is refused to a paying merchant`);
  }
});

test("the free plan keeps everything the dispute page shows", () => {
  // These are the reason a merchant installs at all. A gate on any of them is
  // a gate in front of the warning that stops an automatic loss.
  for (const capability of ["DISPUTE_QUEUE", "CE30_ELIGIBILITY", "ACCOUNT_HEALTH", "PL_ON_SCREEN", "DEADLINE_ALERTS"] as const) {
    assert.equal(planAllows("STARTER", capability), true, `${capability} must stay free`);
  }
});

/* ------------------------------------- what a free merchant's form holds --- */

test("a paying merchant still gets the drafted evidence", () => {
  const fields = buildEvidenceFieldStates(PRIORITY_FIELDS, {}, draftsForPlan("GROWTH"));
  const written = fields.filter((field) => field.value.length > 0);

  assert.ok(written.length > 0, "the paid plan must still draft the evidence");
});

test("a free merchant's form is genuinely empty, not half-written", () => {
  const fields = buildEvidenceFieldStates(PRIORITY_FIELDS, {}, draftsForPlan("STARTER"));

  for (const field of fields) {
    assert.equal(field.value, "", `${field.key} still carries drafted text on the free plan`);
  }

  // Empty means "you have to write this", not "this is fine as it is". A
  // priority field reported as optional is a field the merchant skips.
  const priority = fields.filter((field) => field.priority);
  assert.ok(priority.length > 0, "this reason code should have priority fields");
  assert.ok(priority.every((field) => field.status === "needed"));
});

test("the merchant's own words survive the paywall", () => {
  // The one thing that must never happen. A merchant writes their account of
  // what happened, their trial ends, and the app blanks it. There is no version
  // of this product where that is acceptable.
  const saved: Partial<Record<EvidenceFieldKey, string>> = {
    [TEXT_PRIORITY_KEY]: "I spoke to Dana on 3 July and re-sent the parcel."
  };

  const fields = buildEvidenceFieldStates(PRIORITY_FIELDS, saved, draftsForPlan("STARTER"));
  const mine = fields.find((field) => field.key === TEXT_PRIORITY_KEY);

  assert.ok(mine);
  assert.equal(mine.value, "I spoke to Dana on 3 July and re-sent the parcel.");
  assert.equal(mine.source, "merchant");
  assert.equal(mine.status, "ready");

  // ...and nothing else got filled in around it.
  for (const field of fields.filter((entry) => entry.key !== TEXT_PRIORITY_KEY)) {
    assert.equal(field.value, "", `${field.key} leaked a draft`);
  }
});

test("saved text beats a draft on the paid plan too, so downgrading changes nothing they wrote", () => {
  const key = TEXT_PRIORITY_KEY;
  const saved: Partial<Record<EvidenceFieldKey, string>> = { [key]: "My own account of the order." };

  const paid = buildEvidenceFieldStates(PRIORITY_FIELDS, saved, draftsForPlan("GROWTH"));
  const free = buildEvidenceFieldStates(PRIORITY_FIELDS, saved, draftsForPlan("STARTER"));

  assert.equal(paid.find((field) => field.key === key)?.value, "My own account of the order.");
  assert.equal(free.find((field) => field.key === key)?.value, "My own account of the order.");
});

/* ------------------------------------------------- an unreadable merchant --- */

test("an unknown plan value drafts nothing", () => {
  // getMerchantPlan resolves an unreadable merchant to the free plan, and
  // planAllows refuses anything it does not recognise outright. Either way the
  // answer to "may I do paid work for a merchant I cannot identify?" is no.
  for (const plan of [null, undefined, "", "ENTERPRISE"]) {
    assert.equal(planAllows(plan, "AUTO_DRAFT"), false, `${String(plan)} must not draft`);
  }
});
