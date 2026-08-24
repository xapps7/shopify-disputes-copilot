import test from "node:test";
import assert from "node:assert/strict";

import {
  ROOT_CAUSES,
  inferRootCause,
  isFraudReason,
  isNonDeliveryReason
} from "../lib/disputes/root-cause.ts";
import { resolvePacketText } from "../lib/disputes/packet-text.ts";

/* --- the bug this work fixes ------------------------------------------ */

test("FRAUDULENT is recognised - the old code compared against \"FRAUD\" and never matched", () => {
  // Shopify's enum value, as sync writes it. This is the exact comparison that
  // silently failed for the whole life of the app, so every decided fraud
  // dispute got the generic documentation root cause and the merchant was told
  // to improve their paperwork.
  assert.equal(inferRootCause("LOST", "FRAUDULENT"), "FRAUD_SCREENING");
});

test("a lost fraud dispute is a screening failure, a won one is not", () => {
  assert.equal(inferRootCause("LOST", "FRAUDULENT"), "FRAUD_SCREENING");
  assert.equal(inferRootCause("ACCEPTED", "FRAUDULENT"), "FRAUD_SCREENING");
  // Won: the charge was good and the merchant proved it. Telling them to
  // tighten fraud screening would be advice against a problem they do not have.
  assert.equal(inferRootCause("WON", "FRAUDULENT"), "DOCUMENTATION_GAP");
});

test("UNRECOGNIZED counts as fraud - it is the same claim in softer words", () => {
  assert.equal(inferRootCause("LOST", "UNRECOGNIZED"), "FRAUD_SCREENING");
  assert.equal(isFraudReason("UNRECOGNIZED"), true);
});

test("the legacy FRAUD value still resolves, so old rows are not orphaned", () => {
  assert.equal(inferRootCause("LOST", "FRAUD"), "FRAUD_SCREENING");
  assert.equal(isFraudReason("FRAUD"), true);
});

test("case and separators do not matter, because stored values are inconsistent", () => {
  assert.equal(inferRootCause("LOST", "fraudulent"), "FRAUD_SCREENING");
  assert.equal(inferRootCause("LOST", " Product-Not-Received "), "FULFILLMENT_GAP");
});

test("non-delivery maps to fulfilment, not documentation", () => {
  assert.equal(inferRootCause("LOST", "PRODUCT_NOT_RECEIVED"), "FULFILLMENT_GAP");
  assert.equal(isNonDeliveryReason("PRODUCT_NOT_RECEIVED"), true);
  assert.equal(isNonDeliveryReason("FRAUDULENT"), false);
});

test("an unknown or missing reason falls back rather than throwing", () => {
  assert.equal(inferRootCause("LOST", null), "DOCUMENTATION_GAP");
  assert.equal(inferRootCause("LOST", ""), "DOCUMENTATION_GAP");
  assert.equal(inferRootCause("LOST", "SOMETHING_NEW_FROM_SHOPIFY"), "DOCUMENTATION_GAP");
  assert.equal(isFraudReason(null), false);
});

test("every result is one of the categories prevention actually branches on", () => {
  // A root cause outside this list silently produces no recommendations at all,
  // which is how the original bug stayed invisible.
  for (const reason of ["FRAUDULENT", "UNRECOGNIZED", "PRODUCT_NOT_RECEIVED", "DUPLICATE", null]) {
    for (const status of ["WON", "LOST", "ACCEPTED"]) {
      assert.ok(
        (ROOT_CAUSES as readonly string[]).includes(inferRootCause(status, reason)),
        `${status}/${reason} produced an unhandled root cause`
      );
    }
  }
});

/* --- the packet download that discarded merchant edits ----------------- */

test("a saved summary wins over the regenerated one", () => {
  // The download route regenerated the packet every time and never read
  // EvidencePacket.summaryText, so the editor saved the merchant's narrative
  // and the downloaded file contained none of it.
  const result = resolvePacketText("What the merchant actually wrote.", "Generated from fields.");

  assert.equal(result.text, "What the merchant actually wrote.");
  assert.equal(result.source, "merchant");
});

test("no saved summary falls back to the generated one", () => {
  const result = resolvePacketText(null, "Generated from fields.");

  assert.equal(result.text, "Generated from fields.");
  assert.equal(result.source, "generated");
});

test("a cleared editor does not hand the merchant an empty file", () => {
  for (const empty of ["", "   ", "\n\t ", undefined]) {
    const result = resolvePacketText(empty, "Generated from fields.");
    assert.equal(result.text, "Generated from fields.");
    assert.equal(result.source, "generated");
  }
});

test("saved text is trimmed but otherwise untouched", () => {
  const result = resolvePacketText("  line one\n\nline two  ", "ignored");

  assert.equal(result.text, "line one\n\nline two");
});
