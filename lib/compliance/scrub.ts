/**
 * Pure customer-PII scrubbing for stored JSON blobs.
 *
 * `OrderSnapshot.orderJson` and `Dispute.sourceSnapshotJson` are raw Admin API
 * payloads persisted verbatim. Nulling the `customerEmail` / `customerName`
 * COLUMNS is not enough for `customers/redact` - the same values are still sitting
 * inside those blobs, and `lib/disputes/repository.ts` deliberately falls back to
 * reading them out of the JSON when the columns are empty.
 *
 * No imports: this module must stay runnable under `node --experimental-strip-types`
 * without Prisma or Next.js.
 */

/**
 * Keys whose ENTIRE subtree is customer PII and is replaced with `null`.
 */
const PII_SUBTREE_KEYS = new Set([
  "customer",
  "shippingAddress",
  "shipping_address",
  "billingAddress",
  "billing_address",
  "defaultAddress",
  "default_address",
  "customerJourneySummary",
  "customer_journey_summary",
  "clientIp",
  "client_details",
  "clientDetails"
]);

/**
 * Scalar keys that are customer PII wherever they appear. Deliberately does NOT
 * include a bare `name`: on an order node `name` is the order number ("#1001"),
 * and on a line item it is the product title - neither is personal data, and both
 * are load-bearing for the merchant-facing UI.
 */
const PII_SCALAR_KEYS = new Set([
  "email",
  "contactEmail",
  "contact_email",
  "customerEmail",
  "customer_email",
  "phone",
  "customerPhone",
  "customer_phone",
  "firstName",
  "first_name",
  "lastName",
  "last_name",
  "displayName",
  "display_name",
  "customerName",
  "customer_name",
  "customerLocale",
  "customer_locale",
  "browserIp",
  "browser_ip"
]);

/**
 * Recursively replace customer PII with `null`, preserving document shape so
 * downstream readers (`extractOrderSummaryFromOrderJson`, packet builders) keep
 * working and simply see "no customer on file".
 */
export function scrubCustomerPii(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => scrubCustomerPii(entry));
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(source)) {
    if (PII_SUBTREE_KEYS.has(key)) {
      result[key] = null;
      continue;
    }

    if (PII_SCALAR_KEYS.has(key)) {
      result[key] = null;
      continue;
    }

    result[key] = scrubCustomerPii(entry);
  }

  return result;
}

/**
 * Scrub a stored JSON string. Unparseable content is replaced outright rather
 * than passed through: if we cannot inspect it we cannot certify it is clean,
 * and GDPR/CCPA erasure is not best-effort.
 */
export function scrubJsonString(json: string | null | undefined): string | null {
  if (json === null || json === undefined) {
    return json ?? null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(json);
  } catch {
    return JSON.stringify({ redacted: true, reason: "unparseable_on_redaction" });
  }

  return JSON.stringify(scrubCustomerPii(parsed));
}

/**
 * Shopify compliance payloads carry NUMERIC order ids (`orders_to_redact`,
 * `orders_requested`) while we store Admin API GIDs. Produce every form an id
 * might have been persisted as so the lookup cannot silently miss.
 */
export function orderIdCandidates(ids: Array<number | string> | null | undefined): string[] {
  if (!ids || ids.length === 0) {
    return [];
  }

  const candidates = new Set<string>();

  for (const id of ids) {
    const raw = String(id).trim();

    if (!raw) {
      continue;
    }

    candidates.add(raw);

    const numeric = raw.split("/").pop();

    if (numeric) {
      candidates.add(numeric);
      candidates.add(`gid://shopify/Order/${numeric}`);
    }
  }

  return [...candidates];
}
