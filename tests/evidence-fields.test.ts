import test from "node:test";
import assert from "node:assert/strict";

import {
  EVIDENCE_FIELDS,
  EVIDENCE_FILE_SLOTS,
  MAX_TOTAL_EVIDENCE_BYTES,
  buildEvidenceFieldStates,
  draftEvidenceFields,
  evidenceReadiness
} from "../lib/disputes/evidence-fields.ts";
import { getReasonProfile, normalizeReasonCode } from "../lib/disputes/reason-codes.ts";

/* --- the bug this work fixes ------------------------------------------ */

test("FRAUDULENT is recognised — the old code compared against \"FRAUD\" and never matched", () => {
  // Shopify's enum value, as seen live on this merchant's disputes.
  assert.equal(normalizeReasonCode("FRAUDULENT"), "FRAUDULENT");
  // Legacy rows written before normalisation still resolve.
  assert.equal(normalizeReasonCode("FRAUD"), "FRAUDULENT");
  assert.equal(normalizeReasonCode("fraudulent"), "FRAUDULENT");
  assert.equal(normalizeReasonCode(null), "UNKNOWN");
  assert.equal(normalizeReasonCode("something-shopify-added-later"), "UNKNOWN");
});

test("a fraud dispute gets fraud-specific priority fields, not the generic set", () => {
  const fraud = getReasonProfile("FRAUDULENT");
  assert.equal(fraud.code, "FRAUDULENT");
  assert.ok(fraud.priorityFields.includes("shippingDocumentationFile"));
  assert.ok(fraud.priorityFields.includes("accessActivityLog"));

  const cancelled = getReasonProfile("SUBSCRIPTION_CANCELED");
  assert.ok(cancelled.priorityFields.includes("cancellationPolicyDisclosure"));
  assert.ok(!cancelled.priorityFields.includes("shippingDocumentationFile"));
});

test("every reason code resolves to a usable profile", () => {
  for (const code of ["FRAUDULENT", "DUPLICATE", "UNRECOGNIZED", "GENERAL", "UNKNOWN"]) {
    const profile = getReasonProfile(code);
    assert.ok(profile.theQuestion.length > 0, `${code} has no question`);
    assert.ok(profile.priorityFields.length > 0, `${code} has no priority fields`);
  }
});

/* --- field coverage ---------------------------------------------------- */

test("covers exactly Shopify's writable text fields", () => {
  const keys = EVIDENCE_FIELDS.map((field) => field.key).sort();
  assert.deepEqual(keys, [
    "accessActivityLog",
    "cancellationPolicyDisclosure",
    "cancellationRebuttal",
    "customerEmailAddress",
    "customerFirstName",
    "customerLastName",
    "refundPolicyDisclosure",
    "refundRefusalExplanation",
    "shippingAddress",
    "uncategorizedText"
  ]);
});

test("every field has a prompt, and every non-auto field has a worked example", () => {
  for (const field of EVIDENCE_FIELDS) {
    assert.ok(field.prompt.length > 20, `${field.key} prompt is too thin`);
    if (field.source !== "auto" && field.key !== "uncategorizedText") {
      assert.match(field.placeholder, /Example:/, `${field.key} has no example placeholder`);
    }
  }
});

test("covers Shopify's six file slots and maps every evidence category", () => {
  assert.equal(EVIDENCE_FILE_SLOTS.length, 6);
  const mapped = new Set(EVIDENCE_FILE_SLOTS.flatMap((slot) => slot.categories));
  for (const category of [
    "DELIVERY_CONFIRMATION",
    "SHIPPING_DOCUMENTATION",
    "REFUND_PROOF",
    "CUSTOMER_COMMUNICATION",
    "SERVICE_DOCUMENTATION",
    "PRODUCT_PROOF",
    "POLICY_DISCLOSURE",
    "ACCOUNT_ACTIVITY",
    "OTHER"
  ]) {
    assert.ok(mapped.has(category), `${category} has no Shopify slot`);
  }
});

test("Shopify's total evidence cap is 4 MB, not per file", () => {
  assert.equal(MAX_TOTAL_EVIDENCE_BYTES, 4 * 1024 * 1024);
});

/* --- drafting ---------------------------------------------------------- */

const FRAUD = getReasonProfile("FRAUDULENT");

const CONTEXT = {
  reasonLabel: FRAUD.label,
  reasonQuestion: FRAUD.theQuestion,
  orderName: "#1005",
  orderTotal: "1025.00",
  currencyCode: "USD",
  customerName: "Ada Lovelace",
  customerEmail: "ada@example.com",
  shippingAddress: "12 Baker St, London, NW1, GB",
  fulfillmentStatus: "FULFILLED",
  trackingSummaries: ["UPS 1Z999"],
  lineItemSummaries: ["Widget x2"],
  refundPolicyUrl: "https://shop.example/policies/refund",
  returnPolicyUrl: "",
  cancellationPolicyUrl: "",
  supportEmail: "help@shop.example",
  statementDescriptor: "SHOP EXAMPLE",
  orderPlacedAt: "2026-08-10"
};

test("drafts a response containing the facts a reviewer looks for", () => {
  const drafts = draftEvidenceFields(CONTEXT);
  const response = drafts.uncategorizedText ?? "";

  assert.match(response, /#1005/);
  assert.match(response, /USD 1025\.00/);
  assert.match(response, /UPS 1Z999/);
  assert.match(response, /12 Baker St/);
  assert.match(response, /SHOP EXAMPLE/);
  // The reason is explained in plain language, not just named.
  assert.match(response, /did not authorise/i);
});

test("splits the customer name into the two fields Shopify asks for", () => {
  const drafts = draftEvidenceFields(CONTEXT);
  assert.equal(drafts.customerFirstName, "Ada");
  assert.equal(drafts.customerLastName, "Lovelace");
  assert.equal(drafts.customerEmailAddress, "ada@example.com");
});

test("drafts a refund policy DISCLOSURE, not just a link", () => {
  const drafts = draftEvidenceFields(CONTEXT);
  const disclosure = drafts.refundPolicyDisclosure ?? "";
  assert.match(disclosure, /shop\.example\/policies\/refund/);
  // A URL alone is not a disclosure — it has to say where the customer saw it.
  assert.match(disclosure, /checkout|storefront|before payment/i);
});

test("drafts nothing it cannot know", () => {
  const drafts = draftEvidenceFields({ ...CONTEXT, refundPolicyUrl: "", returnPolicyUrl: "" });
  assert.equal(drafts.refundPolicyDisclosure, undefined);
  // These need the merchant; inventing them would be worse than an empty box.
  assert.equal(drafts.refundRefusalExplanation, undefined);
  assert.equal(drafts.cancellationRebuttal, undefined);
});

test("access activity is drafted for a digital order with no fulfilment and no tracking", () => {
  // The regression: this used to be gated on a fulfilment status or a tracking
  // number, so exactly the orders most likely to draw a "not received" claim
  // opened at a blank box.
  const drafts = draftEvidenceFields({
    ...CONTEXT,
    fulfillmentStatus: null,
    trackingSummaries: []
  });

  const log = drafts.accessActivityLog ?? "";
  assert.match(log, /ada@example\.com/);
  assert.match(log, /2026-08-10/);
});

test("access activity contains evidence only — never instructions to the merchant", () => {
  const drafts = draftEvidenceFields(CONTEXT);
  const log = drafts.accessActivityLog ?? "";

  assert.match(log, /UPS 1Z999/);
  // A draft that ends "add your IP addresses here" is not evidence, and because
  // status is computed from a non-empty box it made an untouched field report
  // Ready and inflated evidenceCompleteness.
  assert.doesNotMatch(log, /Add sign-in timestamps|if you have them/i);
});

test("cancellation disclosure is drafted from its own URL", () => {
  const drafts = draftEvidenceFields({
    ...CONTEXT,
    cancellationPolicyUrl: "https://shop.example/policies/cancellation"
  });

  const disclosure = drafts.cancellationPolicyDisclosure ?? "";
  assert.match(disclosure, /shop\.example\/policies\/cancellation/);
  assert.match(disclosure, /2026-08-10/);
});

test("cancellation disclosure never borrows the refund policy URL", () => {
  // A store can publish a refund policy and no cancellation terms. Claiming the
  // terms were disclosed because some other policy exists is an inference, and
  // it would be presented to a bank as fact.
  const drafts = draftEvidenceFields({ ...CONTEXT, cancellationPolicyUrl: "" });
  assert.equal(drafts.cancellationPolicyDisclosure, undefined);
  assert.match(drafts.refundPolicyDisclosure ?? "", /policies\/refund/);
});

test("a saved cancellation statement still beats the URL draft", () => {
  const drafts = draftEvidenceFields({
    ...CONTEXT,
    cancellationPolicyUrl: "https://shop.example/policies/cancellation",
    cancellationPolicyStatement: "  Cancellation requires 7 days notice before renewal.  "
  });

  assert.equal(drafts.cancellationPolicyDisclosure, "Cancellation requires 7 days notice before renewal.");
});

/* --- readiness --------------------------------------------------------- */

test("merchant edits win over drafts", () => {
  const states = buildEvidenceFieldStates(
    getReasonProfile("FRAUDULENT").priorityFields,
    { uncategorizedText: "My own words." },
    { uncategorizedText: "Generated draft." }
  );
  const response = states.find((state) => state.key === "uncategorizedText");
  assert.equal(response?.value, "My own words.");
  assert.equal(response?.source, "merchant");
});

test("readiness counts only the fields that decide THIS dispute", () => {
  const empty = buildEvidenceFieldStates(
    getReasonProfile("FRAUDULENT").priorityFields, {}, {});
  const zero = evidenceReadiness(empty);
  assert.equal(zero.percent, 0);
  assert.ok(zero.priorityCount > 0);
  assert.ok(zero.missing.length > 0);

  const filled = buildEvidenceFieldStates(
    getReasonProfile("FRAUDULENT").priorityFields,
    { accessActivityLog: "logged in", shippingAddress: "12 Baker St", uncategorizedText: "delivered" },
    {}
  );
  const complete = evidenceReadiness(filled);
  assert.ok(complete.percent > zero.percent);
  assert.equal(complete.percent, 100, "all priority TEXT fields are written");
  assert.deepEqual(complete.missing, []);
});

test("readiness covers text fields only — file slots are reported separately", () => {
  // FRAUDULENT prioritises two file slots and three text fields. Rolling them
  // into one number is how the old score reached 100% off irrelevant uploads.
  const priority = getReasonProfile("FRAUDULENT").priorityFields;
  assert.ok(priority.includes("shippingDocumentationFile"));

  const states = buildEvidenceFieldStates(priority, {}, {});
  const readiness = evidenceReadiness(states);

  assert.equal(readiness.priorityCount, 3, "only the text fields are counted here");
  const counted = states.filter((state) => state.priority).map((state) => state.key);
  assert.ok(!counted.includes("shippingDocumentationFile" as never));
});

test("a field the reason code does not need is optional, not a nag", () => {
  const states = buildEvidenceFieldStates(
    getReasonProfile("FRAUDULENT").priorityFields, {}, {});
  const cancellation = states.find((state) => state.key === "cancellationRebuttal");
  assert.equal(cancellation?.priority, false);
  assert.equal(cancellation?.status, "optional");
});
