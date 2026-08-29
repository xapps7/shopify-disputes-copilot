import { EvidenceCategory } from "@prisma/client";
import { z } from "zod";

/**
 * Input rules for the API routes, kept as pure functions.
 *
 * Two reasons this is a module and not inline checks.
 *
 * First, the same mistakes were being made in several routes at once: a
 * TypeScript `as` cast standing in for a runtime check, a `content-length`
 * header trusted without being parsed, a free-text field written to the
 * database with no ceiling. One copy of each rule means one place to fix.
 *
 * Second, tests run under `node --experimental-strip-types` with no path-alias
 * resolution, so anything that imports `@/lib/...` cannot be imported by a
 * test. This file imports only real packages, so the rules that decide whether
 * a request is accepted are actually covered rather than assumed.
 */

/* ------------------------------------------------------------------ *
 * Request body size
 * ------------------------------------------------------------------ */

export type BodySizeVerdict =
  | { ok: true; declaredLength: number }
  | { ok: false; reason: "missing" | "too-large" };

/**
 * Reads `content-length` as a number, or returns null when there is nothing
 * trustworthy to read.
 *
 * `Number(header ?? "0")` was the old shape and it is the bug: a request sent
 * with `Transfer-Encoding: chunked` carries no `content-length`, so the missing
 * header became 0, 0 passed every size check, and the body was buffered whole.
 * Null forces the caller to decide what an unknown size means instead of
 * quietly treating it as empty.
 */
export function parseDeclaredContentLength(header: string | null | undefined): number | null {
  if (typeof header !== "string") {
    return null;
  }

  const trimmed = header.trim();

  // Deliberately strict. Number("") is 0, Number(" 12 ") is 12, and
  // Number("1e9") is a billion - none of which a real content-length looks
  // like, and each of which would slip past a looser check.
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Decides whether a body may be buffered at all.
 *
 * Next 15 App Router handlers have no default body size limit, and
 * `request.formData()` pulls everything into memory before any of our code
 * runs. On a single App Runner instance one authenticated merchant streaming a
 * chunked upload can therefore take every other merchant down with it. A
 * request that will not say how big it is gets refused.
 */
export function checkDeclaredBodySize(
  header: string | null | undefined,
  maxBytes: number
): BodySizeVerdict {
  const declaredLength = parseDeclaredContentLength(header);

  if (declaredLength === null) {
    return { ok: false, reason: "missing" };
  }

  if (declaredLength > maxBytes) {
    return { ok: false, reason: "too-large" };
  }

  return { ok: true, declaredLength };
}

/** Said the same way by every upload route, so the merchant gets one answer. */
export const MISSING_CONTENT_LENGTH_MESSAGE =
  "This upload did not declare its size, so it cannot be accepted. Send the file as a normal form upload rather than a streamed request.";

/* ------------------------------------------------------------------ *
 * Enums
 * ------------------------------------------------------------------ */

export const EVIDENCE_CATEGORY_VALUES = Object.values(EvidenceCategory) as EvidenceCategory[];

/**
 * Checks a category at runtime instead of asserting it with `as`.
 *
 * `String(value) as EvidenceCategory` is a compile-time claim and nothing more.
 * An unknown value went straight to Prisma, which raised a validation error,
 * which the catch turned into a 500 "Upload failed." - so a one-character typo
 * in a client looked like the app was broken. Returns null and lets the caller
 * answer 400 with the list of values that would have worked.
 */
export function parseEvidenceCategory(value: unknown): EvidenceCategory | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return (EVIDENCE_CATEGORY_VALUES as string[]).includes(trimmed)
    ? (trimmed as EvidenceCategory)
    : null;
}

export function evidenceCategoryErrorMessage(value: unknown) {
  const shown = typeof value === "string" && value.trim() ? `"${value.trim().slice(0, 60)}"` : "That value";
  return `${shown} is not an evidence category. Use one of: ${EVIDENCE_CATEGORY_VALUES.join(", ")}.`;
}

/* ------------------------------------------------------------------ *
 * Free-text ceilings
 * ------------------------------------------------------------------ */

/**
 * The evidence-field ceiling, mirrored from
 * `app/api/disputes/[id]/evidence-fields/route.ts`, which declares the same
 * 20,000 as a private `MAX_FIELD_LENGTH`.
 *
 * That route should import this constant instead of holding its own copy - two
 * numbers for one rule is how a cap gets raised in one place and silently
 * bypassed through the other. Left as a note rather than an edit because that
 * file belongs to another change in flight.
 */
export const MAX_EVIDENCE_FIELD_LENGTH = 20_000;

/** Merchant notes on an outcome or a manual submission. A paragraph, not a book. */
export const MAX_NOTES_LENGTH = 5_000;

/**
 * Enum-shaped values posted as free strings - an outcome, a root cause, a
 * submission method. They are mapped to a known value downstream, but they are
 * also written into timeline payloads, so they still need a ceiling.
 */
export const MAX_SHORT_CODE_LENGTH = 64;

/** The whole packet narrative, which is legitimately long. */
export const MAX_SUMMARY_TEXT_LENGTH = 50_000;

/** An evidence item's title, which is a label on a list row. */
export const MAX_TITLE_LENGTH = 200;

/** An evidence item's description. */
export const MAX_DESCRIPTION_LENGTH = 2_000;

/**
 * Trims and enforces a ceiling on text headed for the database.
 *
 * None of these columns had one. A single request could store megabytes of
 * text per field, and it is read back on every dispute page - so the cost is
 * paid on every load, by the merchant, forever.
 */
export function checkTextLength(
  value: unknown,
  maxLength: number
): { ok: true; value: string } | { ok: false; maxLength: number } {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > maxLength ? { ok: false, maxLength } : { ok: true, value: text };
}

/* ------------------------------------------------------------------ *
 * JSON bodies
 * ------------------------------------------------------------------ */

/**
 * Parses a JSON body without letting a malformed one become a 500.
 *
 * `await request.json()` throws on bad input, the generic catch turned that
 * into "something went wrong on our side", and the caller was told to retry a
 * request that can never succeed. A broken body is the caller's mistake, so it
 * deserves a 400.
 */
export async function readJsonObject(
  request: Request
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false }> {
  let parsed: unknown;

  try {
    parsed = await request.json();
  } catch {
    return { ok: false };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false };
  }

  return { ok: true, body: parsed as Record<string, unknown> };
}

export const MALFORMED_JSON_MESSAGE = "The request body was not valid JSON.";

/* ------------------------------------------------------------------ *
 * Settings
 * ------------------------------------------------------------------ */

/** Long enough for any real address, short enough to bound the column. */
export const MAX_URL_LENGTH = 2_048;
export const MAX_EMAIL_LENGTH = 254;

/**
 * Empty is allowed everywhere here, because every one of these settings is
 * optional and a merchant clearing a box must not be an error. Anything else
 * has to be a real http(s) address: a value like "our returns page" was
 * accepted and then printed into evidence a bank reads.
 */
export function isEmptyOrHttpUrl(value: string) {
  const trimmed = value.trim();

  if (trimmed === "") {
    return true;
  }

  if (trimmed.length > MAX_URL_LENGTH) {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }

  return parsed.protocol === "https:" || parsed.protocol === "http:";
}

/**
 * Deliberately simple, and deliberately not a full RFC 5322 parser.
 *
 * The job is to stop `alertEmail` being anything a caller likes. That field is
 * the recipient of every alert and of the test-email button, so an unchecked
 * value turns a verified sending domain into a relay pointed at strangers.
 */
const EMAIL_PATTERN = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]{2,}$/;

export function isEmptyOrEmail(value: string) {
  const trimmed = value.trim();

  if (trimmed === "") {
    return true;
  }

  return trimmed.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(trimmed);
}

function optionalUrlField(label: string) {
  return z
    .string()
    .max(MAX_URL_LENGTH)
    .refine(isEmptyOrHttpUrl, { message: `${label} must be a full http:// or https:// address, or left empty.` });
}

function optionalEmailField(label: string) {
  return z
    .string()
    .max(MAX_EMAIL_LENGTH)
    .refine(isEmptyOrEmail, { message: `${label} must be a valid email address, or left empty.` });
}

/**
 * Every field bounded, because all of it is written to one JSON text column
 * that is read on every settings and packet render.
 */
export const settingsSchema = z.object({
  returnPolicyUrl: optionalUrlField("Return policy URL"),
  refundPolicyUrl: optionalUrlField("Refund policy URL"),
  // Defaulted, not required: a client cached before this field existed
  // must not have its whole settings save rejected over one absent key.
  cancellationPolicyUrl: optionalUrlField("Cancellation policy URL").default(""),
  supportEmail: optionalEmailField("Support email"),
  supportPhone: z.string().max(40),
  // Shopify's own descriptor is 22 characters; the slack is for merchants who
  // paste the whole line as it appears on a statement.
  statementDescriptor: z.string().max(200),
  packetFooter: z.string().max(2_000),
  alertEmail: optionalEmailField("Alert email"),
  // Stored as a string in the settings JSON. `parseRetentionDays` clamps the
  // number later; this only has to guarantee it IS a number.
  evidenceRetentionDays: z
    .string()
    .max(6)
    .regex(/^\d*$/, { message: "Evidence retention must be a number of days." }),
  alertWebhookUrl: optionalUrlField("Alert webhook URL"),
  notifyDueSoon: z.boolean(),
  notifyMissingEvidence: z.boolean(),
  notifyDecided: z.boolean(),
  allowManualSubmissionRecording: z.boolean()
});

export type SettingsPayload = z.infer<typeof settingsSchema>;

/**
 * One readable line for the merchant.
 *
 * The raw zod issue dump is not for them - it names internal shapes and it is
 * returned to a caller we have not necessarily authenticated. The field name
 * and our own message are enough to fix the form and leak nothing.
 */
export function describeSchemaFailure(error: z.ZodError) {
  const issue = error.issues[0];

  if (!issue) {
    return "Those settings are not valid.";
  }

  const field = issue.path.join(".");
  return field ? `${field}: ${issue.message}` : issue.message;
}
