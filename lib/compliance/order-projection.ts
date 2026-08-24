/**
 * Store only the order fields the app actually reads.
 *
 * `OrderSnapshot.orderJson` held `JSON.stringify(dispute.order)` - the whole
 * payload, verbatim. That is more personal data than any feature needs, and it
 * is the long-lived copy: an order snapshot is keyed by order and outlives
 * every dispute attached to it.
 *
 * Shopify's first protected-customer-data requirement is to process the minimum
 * personal data the app needs. "We keep the entire order because it was
 * convenient" is not an answer to that, and the honest fix is a whitelist
 * rather than a promise.
 *
 * WHY A WHITELIST AND NOT A SCRUBBER: `scrubJsonString` in `./scrub.ts` removes
 * keys it recognises as personal. That is the right tool for erasure, where the
 * job is to destroy what is there. It is the wrong tool here, because the risk
 * is the field nobody thought of - a key Shopify adds next quarter that we have
 * no rule for. A whitelist fails closed: an unknown field is simply not stored.
 *
 * Every field below is here because a named reader needs it. If you add one,
 * name the reader in a comment, and if you remove one, check these:
 *   - `lib/disputes/shopify-protect.ts` readProtectFromOrderJson -> shopifyProtect
 *   - `lib/disputes/repository.ts` extractOrderSummaryFromOrderJson ->
 *     name, customer names and email, currentTotalPriceSet, displayFulfillmentStatus
 *   - `lib/disputes/repository.ts` getDisputeDetail (Visa CE 3.0) -> createdAt,
 *     shippingAddress.hash, clientDetails.browserIpHash, customer email
 *
 * HASHES, NOT VALUES: Visa Compelling Evidence 3.0 asks whether the shipping
 * address and the buyer's IP on this order match the ones on two earlier orders.
 * That question is pure equality, so a sha256 digest answers it exactly as well
 * as the address does - and a digest is not a place a person lives. So the
 * projection stores `shippingAddress: { hash }` and
 * `clientDetails: { browserIpHash }`, and never the raw address or the raw IP.
 * Restoring either raw field to this whitelist would put a home address in the
 * app's longest-lived table to serve a comparison that never needed to read it.
 *
 * The digests deliberately keep the KEYS the raw values had, because
 * `customers/redact` erases this blob with `scrubJsonString`, which nulls
 * subtrees by exact key name. A digest under a fresh key such as
 * `shippingAddressHash` would match no erasure rule and outlive the deletion
 * request that was supposed to remove it.
 *
 * NOTE ON SCOPE: this covers `OrderSnapshot.orderJson` only.
 * `Dispute.sourceSnapshotJson` still stores the fuller payload, because the
 * response drafting context reads shipping address, line items, fulfilment
 * tracking and order date out of it. Narrowing that one is a separate job with
 * a real failure mode - get the field set wrong and the response builder
 * silently drafts empty text against a deadline - so it is not being guessed at
 * here.
 */

import { createHash } from "node:crypto";

import { normaliseAddress } from "../disputes/ce30.ts";
import type { Ce30Elements } from "../disputes/ce30.ts";

/**
 * Domain separators, so the digest of an address can never equal the digest of
 * an IP that happens to render the same way. Versioned because changing what
 * goes into a hash changes what matches what: bump the suffix and old snapshots
 * stop matching new ones, which is a visible break rather than a silent one.
 */
const ADDRESS_HASH_DOMAIN = "ce30:shipping-address:v1";
const IP_HASH_DOMAIN = "ce30:browser-ip:v1";

/**
 * Unsalted on purpose. A per-shop salt would be better against an offline guess
 * at a known address, but the digest has to be stable across every order of
 * every merchant in the table for CE 3.0 matching to work at all, and a salt we
 * would have to store beside the digest protects nothing. What this does buy is
 * real: nothing in the row can be read as an address by anyone who gets it,
 * including us.
 */
function digest(domain: string, value: string): string {
  return createHash("sha256").update(`${domain}|${value}`).digest("hex");
}

/** The shape we keep. Deliberately narrow; unknown keys are dropped. */
export type ProjectedOrder = {
  id?: string | null;
  name?: string | null;
  createdAt?: string | null;
  displayFulfillmentStatus?: string | null;
  displayFinancialStatus?: string | null;
  currentTotalPriceSet?: {
    shopMoney?: { amount?: string | null; currencyCode?: string | null } | null;
  } | null;
  /**
   * First name, last name and email only. Shopify's dispute evidence input has
   * named fields for exactly these three and nothing else about the customer,
   * so nothing else about the customer earns storage.
   */
  customer?: { firstName?: string | null; lastName?: string | null; email?: string | null } | null;
  /** Read by `describeProtect` to decide whether fighting is worth anything. */
  shopifyProtect?: unknown;
  /**
   * The shipping address, reduced to a sha256 of its normalised self. Read by the
   * CE 3.0 assessment in `lib/disputes/repository.ts` as one of Visa's four
   * matching elements. Never the address itself - see HASHES, NOT VALUES above.
   *
   * WHY IT KEEPS THE `shippingAddress` KEY: `customers/redact` erases order JSON
   * with `scrubJsonString`, which nulls the `shippingAddress` subtree by exact
   * key name. A digest parked under a new top-level key such as
   * `shippingAddressHash` would match no rule and survive the erasure - a
   * pseudonymous identifier derived from a home address, left behind after the
   * customer asked for deletion. Keeping the digest where the address used to
   * live means every existing PII rule already covers it.
   */
  shippingAddress?: { hash?: string | null } | null;
  /**
   * sha256 of `order.clientDetails.browserIp`, under the key the scrubber
   * already nulls, for the same reason as above. This is the element Visa
   * actually insists on, and it is almost always absent: no query in this app
   * selects `clientDetails` today, because it is Level 2 protected customer data
   * and adding it to a live dispute query would fail the whole query with
   * ACCESS_DENIED until the app's protected-customer-data request is approved.
   * The projection reads it anyway, so the day the field is selected - alongside
   * customer name and address in ORDER_PROTECTED_DETAILS_QUERY, where a denial
   * costs only those fields - it is stored with no further change here.
   */
  clientDetails?: { browserIpHash?: string | null } | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pickString(source: Record<string, unknown>, key: string): string | null | undefined {
  const value = source[key];
  if (value === undefined) {
    return undefined;
  }
  return typeof value === "string" ? value : null;
}

/**
 * One address, one string, in a fixed field order.
 *
 * The recipient name is left out. Visa matches the address, and a gift order
 * addressed to someone else is the same doorstep - including the name would
 * throw that match away. Province and country prefer the code over the display
 * name because `normaliseAddress` cannot know that "CA" and "California" are the
 * same place, and every order here comes from the same Shopify API, so the codes
 * are present or absent consistently.
 */
function flattenShippingAddress(raw: unknown): string | null {
  const address = asRecord(raw);

  if (!address) {
    return typeof raw === "string" ? raw : null;
  }

  const parts = [
    pickString(address, "address1"),
    pickString(address, "address2"),
    pickString(address, "city"),
    pickString(address, "provinceCode") ?? pickString(address, "province"),
    pickString(address, "zip"),
    pickString(address, "countryCodeV2") ?? pickString(address, "country")
  ].filter((part): part is string => typeof part === "string" && part.trim().length > 0);

  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * The stored form of a shipping address: normalised, then hashed.
 *
 * Normalising BEFORE hashing is the whole point. Two renderings of one address
 * differ by punctuation and case far more often than they differ by street, and
 * hashing first turns a cosmetic difference into a total mismatch - a real Visa
 * match lost to a comma.
 */
export function hashShippingAddress(raw: unknown): string | null {
  const normalised = normaliseAddress(flattenShippingAddress(raw));
  return normalised ? digest(ADDRESS_HASH_DOMAIN, normalised) : null;
}

/** The stored form of a browser IP. Trimmed and lowercased (IPv6 hex), then hashed. */
export function hashBrowserIp(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }

  const trimmed = raw.trim().toLowerCase();
  return trimmed.length > 0 ? digest(IP_HASH_DOMAIN, trimmed) : null;
}

/**
 * The four CE 3.0 matching elements for one order.
 *
 * Accepts a raw Shopify order node OR an already-projected one, because the two
 * sides of a CE 3.0 comparison come from different places: the disputed order is
 * read live out of `Dispute.sourceSnapshotJson`, its priors out of the projected
 * `OrderSnapshot.orderJson`. Taking either shape means one function and no risk
 * of the two sides being fingerprinted by slightly different code.
 *
 * The stored hash wins over a recomputed one when both exist - same value, but
 * one fewer place for the two to drift.
 */
export function ce30ElementsFromOrder(raw: unknown): Ce30Elements {
  const order = asRecord(raw);

  if (!order) {
    return { customerEmail: null, ip: null, deviceId: null, shippingAddressHash: null, userId: null };
  }

  const customer = asRecord(order.customer);
  const clientDetails = asRecord(order.clientDetails);
  const shippingAddress = asRecord(order.shippingAddress);

  return {
    customerEmail: (customer ? pickString(customer, "email") : null) ?? null,
    // A hash in the `ip` slot on purpose. CE 3.0 matching is equality only, and
    // `Ce30Elements` documents that either form is accepted, so there is no
    // reason for an IP to exist in this app in a form anyone could read.
    ip:
      (clientDetails ? pickString(clientDetails, "browserIpHash") : null) ??
      hashBrowserIp(clientDetails?.browserIp),
    // Shopify's Admin API exposes no device fingerprint under any scope, so this
    // is null for every order this app will ever see. It stays in the shape
    // because `assessCe30` reads a missing element as a non-match, which is the
    // correct answer, and because a merchant-run fraud tool could fill it later.
    deviceId: null,
    // Already-projected orders carry the digest as `shippingAddress.hash`; raw
    // Shopify orders carry the address itself and are hashed here. One function
    // reads both, so the two sides of a comparison can never be fingerprinted
    // by two slightly different pieces of code.
    shippingAddressHash:
      (shippingAddress ? pickString(shippingAddress, "hash") : null) ??
      hashShippingAddress(order.shippingAddress),
    // Visa's "user ID" is the buyer's login on the merchant's own store. Shopify
    // has a customer id, but it identifies the same customer record the email
    // already matched on, so counting it as a second element would be us
    // agreeing with ourselves twice. Left null until the app has a real
    // storefront account identifier.
    userId: null
  };
}

/**
 * Projects an order object down to the stored shape.
 *
 * Returns `null` for anything that is not an object, so a malformed payload
 * cannot smuggle itself through as a string or an array.
 */
export function projectOrder(raw: unknown): ProjectedOrder | null {
  const order = asRecord(raw);

  if (!order) {
    return null;
  }

  const projected: ProjectedOrder = {};

  for (const key of ["id", "name", "createdAt", "displayFulfillmentStatus", "displayFinancialStatus"] as const) {
    const value = pickString(order, key);
    if (value !== undefined) {
      projected[key] = value;
    }
  }

  const price = asRecord(order.currentTotalPriceSet);
  if (price) {
    const shopMoney = asRecord(price.shopMoney);
    projected.currentTotalPriceSet = {
      shopMoney: shopMoney
        ? {
            amount: pickString(shopMoney, "amount") ?? null,
            currencyCode: pickString(shopMoney, "currencyCode") ?? null
          }
        : null
    };
  }

  const customer = asRecord(order.customer);
  if (customer) {
    projected.customer = {
      firstName: pickString(customer, "firstName") ?? null,
      lastName: pickString(customer, "lastName") ?? null,
      email: pickString(customer, "email") ?? null
    };
  } else if (order.customer === null) {
    // An explicit null is information - it means the order has no customer
    // record, which is different from us not having looked.
    projected.customer = null;
  }

  if (order.shopifyProtect !== undefined) {
    projected.shopifyProtect = order.shopifyProtect;
  }

  // Hashed at write time rather than read time, because the raw address arrives
  // here and nowhere else: `enrichCustomers` merges it onto the order node just
  // before this call, and this is the last moment it exists before the whitelist
  // drops it. Only written when there is something to hash, so an order with no
  // shipping address stores no key rather than a null one.
  const shippingAddressHash = hashShippingAddress(order.shippingAddress);
  if (shippingAddressHash) {
    projected.shippingAddress = { hash: shippingAddressHash };
  }

  const browserIpHash = hashBrowserIp(asRecord(order.clientDetails)?.browserIp);
  if (browserIpHash) {
    projected.clientDetails = { browserIpHash };
  }

  return projected;
}

/** The value to write into `OrderSnapshot.orderJson`. Never the raw payload. */
export function projectOrderForStorage(raw: unknown): string {
  return JSON.stringify(projectOrder(raw) ?? {});
}
