import test from "node:test";
import assert from "node:assert/strict";

import { EvidenceCategory } from "@prisma/client";

import {
  EVIDENCE_CATEGORY_VALUES,
  MAX_NOTES_LENGTH,
  checkDeclaredBodySize,
  checkTextLength,
  evidenceCategoryErrorMessage,
  describeSchemaFailure,
  isEmptyOrEmail,
  isEmptyOrHttpUrl,
  parseDeclaredContentLength,
  parseEvidenceCategory,
  settingsSchema
} from "../lib/validation/route-inputs.ts";

/* --- FIX 3: the enum cast that returned 500 ---------------------------- */

test("a category outside the enum is rejected instead of cast", () => {
  // The old code was `String(value) as EvidenceCategory` - a compile-time
  // claim. Prisma then raised a validation error the catch turned into a 500.
  assert.equal(parseEvidenceCategory("NOT_A_CATEGORY"), null);
  assert.equal(parseEvidenceCategory("other"), null, "matching is exact, not case-insensitive");
  assert.equal(parseEvidenceCategory(""), null);
  assert.equal(parseEvidenceCategory(null), null);
  assert.equal(parseEvidenceCategory(42), null);
  assert.equal(parseEvidenceCategory({}), null);
});

test("every real Prisma category is accepted", () => {
  for (const value of Object.values(EvidenceCategory)) {
    assert.equal(parseEvidenceCategory(value), value);
  }
  assert.equal(parseEvidenceCategory("  OTHER  "), EvidenceCategory.OTHER);
  assert.ok(EVIDENCE_CATEGORY_VALUES.includes(EvidenceCategory.SHIPPING_DOCUMENTATION));
});

test("the rejection message lists what would have worked", () => {
  const message = evidenceCategoryErrorMessage("NOT_A_CATEGORY");
  assert.match(message, /NOT_A_CATEGORY/);
  assert.match(message, /OTHER/);
});

/* --- FIX 2: the missing content-length that meant "zero bytes" --------- */

test("a missing content-length is rejected, not read as zero", () => {
  // Transfer-Encoding: chunked sends no content-length. `Number(null ?? "0")`
  // was 0, 0 passed every size check, and formData() then buffered the whole
  // body into the memory of the one instance every merchant shares.
  assert.equal(parseDeclaredContentLength(null), null);
  assert.equal(parseDeclaredContentLength(undefined), null);
  assert.equal(parseDeclaredContentLength(""), null);

  const verdict = checkDeclaredBodySize(null, 1_000);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.ok === false && verdict.reason, "missing");
});

test("an unparseable content-length is rejected", () => {
  for (const header of ["abc", "1e9", "-1", "12.5", "1_000", " ", "0x10"]) {
    assert.equal(parseDeclaredContentLength(header), null, `"${header}" should not parse`);
    assert.equal(checkDeclaredBodySize(header, 1_000).ok, false);
  }
});

test("a real content-length is accepted up to the cap and refused past it", () => {
  assert.equal(parseDeclaredContentLength("0"), 0);
  assert.equal(parseDeclaredContentLength(" 512 "), 512);

  const allowed = checkDeclaredBodySize("512", 1_000);
  assert.equal(allowed.ok, true);
  assert.equal(allowed.ok === true && allowed.declaredLength, 512);

  const tooLarge = checkDeclaredBodySize("1001", 1_000);
  assert.equal(tooLarge.ok, false);
  assert.equal(tooLarge.ok === false && tooLarge.reason, "too-large");
});

/* --- FIX 4 and 5: settings validation ---------------------------------- */

function validSettings(overrides: Record<string, unknown> = {}) {
  return {
    returnPolicyUrl: "https://example.com/returns",
    refundPolicyUrl: "",
    cancellationPolicyUrl: "",
    supportEmail: "help@example.com",
    supportPhone: "+44 20 7946 0000",
    statementDescriptor: "EXAMPLE STORE",
    packetFooter: "",
    alertEmail: "alerts@example.com",
    evidenceRetentionDays: "365",
    alertWebhookUrl: "",
    notifyDueSoon: true,
    notifyMissingEvidence: true,
    notifyDecided: true,
    allowManualSubmissionRecording: true,
    ...overrides
  };
}

test("a well formed settings payload is accepted", () => {
  assert.equal(settingsSchema.safeParse(validSettings()).success, true);
});

test("a bad alert email is rejected - it is the recipient of every alert", () => {
  // An unchecked alertEmail plus an unrate-limited test-email button is a mail
  // relay pointed at strangers, sending from our verified domain.
  const result = settingsSchema.safeParse(validSettings({ alertEmail: "not-an-email" }));
  assert.equal(result.success, false);
  assert.match(result.success === false ? describeSchemaFailure(result.error) : "", /alertEmail/);
});

test("a bad support email is rejected", () => {
  assert.equal(settingsSchema.safeParse(validSettings({ supportEmail: "help@" })).success, false);
  assert.equal(settingsSchema.safeParse(validSettings({ supportEmail: "a b@c.com" })).success, false);
});

test("a bad policy URL is rejected", () => {
  const result = settingsSchema.safeParse(validSettings({ returnPolicyUrl: "our returns page" }));
  assert.equal(result.success, false);
  assert.match(result.success === false ? describeSchemaFailure(result.error) : "", /returnPolicyUrl/);

  assert.equal(settingsSchema.safeParse(validSettings({ refundPolicyUrl: "example.com" })).success, false);
  assert.equal(
    settingsSchema.safeParse(validSettings({ alertWebhookUrl: "javascript:alert(1)" })).success,
    false,
    "only http and https are addresses we will post to"
  );
});

test("empty strings are still accepted - every one of these settings is optional", () => {
  const result = settingsSchema.safeParse(
    validSettings({
      returnPolicyUrl: "",
      refundPolicyUrl: "",
      cancellationPolicyUrl: "",
      supportEmail: "",
      alertEmail: "",
      alertWebhookUrl: ""
    })
  );
  assert.equal(result.success, true);
});

test("cancellationPolicyUrl stays optional for clients cached before it existed", () => {
  const payload = validSettings();
  delete (payload as Record<string, unknown>).cancellationPolicyUrl;

  const result = settingsSchema.safeParse(payload);
  assert.equal(result.success, true);
  assert.equal(result.success === true ? result.data.cancellationPolicyUrl : null, "");
});

test("retention days must be a number, and every string field is bounded", () => {
  assert.equal(settingsSchema.safeParse(validSettings({ evidenceRetentionDays: "forever" })).success, false);
  assert.equal(settingsSchema.safeParse(validSettings({ evidenceRetentionDays: "365" })).success, true);
  assert.equal(
    settingsSchema.safeParse(validSettings({ returnPolicyUrl: `https://example.com/${"a".repeat(2100)}` })).success,
    false
  );
  assert.equal(settingsSchema.safeParse(validSettings({ packetFooter: "x".repeat(2_001) })).success, false);
});

test("the URL and email predicates agree with the schema", () => {
  assert.equal(isEmptyOrHttpUrl(""), true);
  assert.equal(isEmptyOrHttpUrl("   "), true);
  assert.equal(isEmptyOrHttpUrl("https://example.com"), true);
  assert.equal(isEmptyOrHttpUrl("http://example.com"), true);
  assert.equal(isEmptyOrHttpUrl("ftp://example.com"), false);
  assert.equal(isEmptyOrHttpUrl("example.com"), false);

  assert.equal(isEmptyOrEmail(""), true);
  assert.equal(isEmptyOrEmail("alerts@example.com"), true);
  assert.equal(isEmptyOrEmail("alerts@example"), false);
  assert.equal(isEmptyOrEmail("a@b.com, c@d.com"), false, "one recipient, not a list");
});

/* --- FIX 6 and 7: text ceilings ---------------------------------------- */

test("free text is trimmed and capped", () => {
  const ok = checkTextLength("  hello  ", MAX_NOTES_LENGTH);
  assert.equal(ok.ok, true);
  assert.equal(ok.ok === true && ok.value, "hello");

  const tooLong = checkTextLength("x".repeat(MAX_NOTES_LENGTH + 1), MAX_NOTES_LENGTH);
  assert.equal(tooLong.ok, false);
  assert.equal(tooLong.ok === false && tooLong.maxLength, MAX_NOTES_LENGTH);

  // A non-string body value becomes an empty string rather than "undefined".
  const missing = checkTextLength(undefined, MAX_NOTES_LENGTH);
  assert.equal(missing.ok === true && missing.value, "");
});
