import test from "node:test";
import assert from "node:assert/strict";

import {
  LIBRARY_DOCUMENT_KINDS,
  documentsForSlot,
  findDocument,
  getKindDefinition,
  isLibraryDocumentKind,
  parseLibraryDocuments,
  standingBudget,
  withDocument,
  withoutDocument,
  type LibraryDocument
} from "../lib/documents/library.ts";
import {
  EVIDENCE_FILE_SLOTS,
  MAX_SINGLE_EVIDENCE_BYTES,
  MAX_TOTAL_EVIDENCE_BYTES,
  draftEvidenceFields
} from "../lib/disputes/evidence-fields.ts";

function doc(overrides: Partial<LibraryDocument> = {}): LibraryDocument {
  return {
    id: "doc-1",
    kind: "REFUND_POLICY",
    title: "Refund policy",
    storageRef: "s3://library/m1/refund.pdf",
    mimeType: "application/pdf",
    sizeBytes: 100_000,
    uploadedAt: "2026-08-01T00:00:00.000Z",
    ...overrides
  };
}

/* --- the mapping has to be real ---------------------------------------- */

test("every document kind points at a slot the dispute page actually renders", () => {
  // A kind pointing at a slot that does not exist would silently never appear,
  // and the merchant would upload a file that goes nowhere.
  const slots = new Set(EVIDENCE_FILE_SLOTS.map((slot) => slot.key));

  for (const definition of LIBRARY_DOCUMENT_KINDS) {
    assert.ok(slots.has(definition.slot), `${definition.kind} points at unknown slot ${definition.slot}`);
  }
});

test("an unknown kind falls back rather than returning undefined", () => {
  assert.equal(getKindDefinition("NOT_A_KIND" as never).kind, "OTHER");
});

test("isLibraryDocumentKind rejects anything not in the list", () => {
  assert.equal(isLibraryDocumentKind("REFUND_POLICY"), true);
  assert.equal(isLibraryDocumentKind("REFUND"), false);
  assert.equal(isLibraryDocumentKind(null), false);
  assert.equal(isLibraryDocumentKind(7), false);
});

/* --- the manifest is JSON in a text column, so parsing must not trust it - */

test("a malformed manifest yields an empty library instead of throwing", () => {
  assert.deepEqual(parseLibraryDocuments(null), []);
  assert.deepEqual(parseLibraryDocuments("not an array"), []);
  assert.deepEqual(parseLibraryDocuments({}), []);
});

test("entries missing required fields are dropped, good ones survive", () => {
  const parsed = parseLibraryDocuments([
    { id: "a", kind: "REFUND_POLICY", title: "Policy", storageRef: "s3://x" },
    { id: "b", kind: "NOPE", title: "Bad kind", storageRef: "s3://y" },
    { kind: "REFUND_POLICY", title: "No id", storageRef: "s3://z" },
    null,
    "string"
  ]);

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, "a");
  // Missing optional fields become safe defaults rather than undefined, so the
  // UI never renders "undefined MB".
  assert.equal(parsed[0].sizeBytes, 0);
  assert.equal(parsed[0].mimeType, "");
});

test("a non-numeric size is treated as unknown, not NaN", () => {
  const [parsed] = parseLibraryDocuments([
    { id: "a", kind: "OTHER", title: "T", storageRef: "s3://x", sizeBytes: "big" }
  ]);

  assert.equal(parsed.sizeBytes, 0);
});

/* --- one policy per kind ------------------------------------------------ */

test("uploading a second refund policy replaces the first", () => {
  const first = doc({ id: "old" });
  const second = doc({ id: "new" });

  const result = withDocument([first], second);

  assert.equal(result.length, 1);
  assert.equal(result[0].id, "new");
});

test("OTHER is the one kind you can hold several of", () => {
  const a = doc({ id: "a", kind: "OTHER" });
  const b = doc({ id: "b", kind: "OTHER" });

  assert.equal(withDocument([a], b).length, 2);
});

test("replacing one kind leaves the others alone", () => {
  const refund = doc({ id: "refund", kind: "REFUND_POLICY" });
  const terms = doc({ id: "terms", kind: "TERMS_OF_SERVICE" });

  const result = withDocument([refund, terms], doc({ id: "refund-2", kind: "REFUND_POLICY" }));

  assert.deepEqual(
    result.map((entry) => entry.id).sort(),
    ["refund-2", "terms"]
  );
});

test("removing a document that is not there changes nothing", () => {
  const documents = [doc({ id: "a" })];
  assert.equal(withoutDocument(documents, "missing").length, 1);
  assert.equal(withoutDocument(documents, "a").length, 0);
});

test("findDocument returns null rather than undefined for a miss", () => {
  assert.equal(findDocument([doc({ id: "a" })], "b"), null);
});

/* --- slot routing ------------------------------------------------------- */

test("a refund policy is offered in the refund slot and nowhere else", () => {
  const documents = [doc({ id: "r", kind: "REFUND_POLICY" })];

  assert.equal(documentsForSlot(documents, "refundPolicyFile").length, 1);
  // The bug this guards against: POLICY_DISCLOSURE matches both the refund and
  // the cancellation slot by category, so category-based routing would put the
  // same file in two slots and double-count its bytes.
  assert.equal(documentsForSlot(documents, "cancellationPolicyFile").length, 0);
});

test("cancellation terms route to the cancellation slot", () => {
  const documents = [doc({ id: "c", kind: "CANCELLATION_POLICY" })];
  assert.equal(documentsForSlot(documents, "cancellationPolicyFile").length, 1);
});

/* --- the budget warning ------------------------------------------------- */

test("standing documents that eat over half the budget are flagged", () => {
  const heavy = [doc({ id: "a", sizeBytes: MAX_TOTAL_EVIDENCE_BYTES * 0.6 })];
  const light = [doc({ id: "a", sizeBytes: 50_000 })];

  assert.equal(standingBudget(heavy, MAX_TOTAL_EVIDENCE_BYTES).crowded, true);
  assert.equal(standingBudget(light, MAX_TOTAL_EVIDENCE_BYTES).crowded, false);
});

test("remaining bytes never go negative", () => {
  const over = [doc({ id: "a", sizeBytes: MAX_TOTAL_EVIDENCE_BYTES * 2 })];
  assert.equal(standingBudget(over, MAX_TOTAL_EVIDENCE_BYTES).remainingBytes, 0);
});

/* --- Shopify's two size rules are different numbers --------------------- */

test("the per-file cap is stricter than the total, which is the whole point", () => {
  // These were the same value, so a 3 MB file passed every check we make and
  // was rejected by Shopify at submission.
  assert.ok(MAX_SINGLE_EVIDENCE_BYTES < MAX_TOTAL_EVIDENCE_BYTES);
  assert.equal(MAX_SINGLE_EVIDENCE_BYTES, 2 * 1024 * 1024);
  assert.equal(MAX_TOTAL_EVIDENCE_BYTES, 4 * 1024 * 1024);
});

/* --- standing text beats the generated sentence ------------------------- */

const baseContext = {
  reasonLabel: "Fraudulent",
  reasonQuestion: "Did the cardholder authorise this?",
  orderName: "#1001",
  orderTotal: "80.00",
  currencyCode: "USD",
  customerName: "Ada Lovelace",
  customerEmail: "ada@example.com",
  shippingAddress: "1 Main St",
  fulfillmentStatus: "FULFILLED",
  trackingSummaries: [],
  lineItemSummaries: [],
  refundPolicyUrl: "https://shop.example/refunds",
  returnPolicyUrl: "",
  supportEmail: "help@shop.example",
  statementDescriptor: "SHOP",
  orderPlacedAt: "2026-07-02"
};

test("a written refund statement replaces the URL-derived template", () => {
  const drafts = draftEvidenceFields({
    ...baseContext,
    refundPolicyStatement: "Refunds within 30 days, shown at checkout."
  });

  assert.equal(drafts.refundPolicyDisclosure, "Refunds within 30 days, shown at checkout.");
});

test("with no written statement, the URL template still runs", () => {
  const drafts = draftEvidenceFields(baseContext);

  assert.ok(drafts.refundPolicyDisclosure?.includes("https://shop.example/refunds"));
});

test("whitespace-only text does not count as a written statement", () => {
  const drafts = draftEvidenceFields({ ...baseContext, refundPolicyStatement: "   \n  " });

  assert.ok(drafts.refundPolicyDisclosure?.includes("https://shop.example/refunds"));
});

test("cancellation text is only drafted when the merchant wrote some", () => {
  assert.equal(draftEvidenceFields(baseContext).cancellationPolicyDisclosure, undefined);

  const drafts = draftEvidenceFields({
    ...baseContext,
    cancellationPolicyStatement: "Seven days notice before renewal."
  });

  assert.equal(drafts.cancellationPolicyDisclosure, "Seven days notice before renewal.");
});
