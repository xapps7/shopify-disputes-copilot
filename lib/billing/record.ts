import { db } from "@/lib/db";

import type { BillingPlanKey } from "@/lib/billing/plans";

/**
 * Where the subscription details live, and why they live somewhere odd.
 *
 * There is no Subscription table and there is not going to be one: Prisma
 * cannot be regenerated in this environment, so adding a model or a column is
 * off the table. Two places already exist and both are used:
 *
 *   Merchant.plan          - the existing MerchantPlan enum column. This is the
 *                            AUTHORITY for what the merchant may do. Every gate
 *                            check reads it and nothing else, so a gate decision
 *                            costs one indexed column read and never has to
 *                            parse JSON.
 *   Merchant.settingsJson  - a free-form JSON text column. Everything else about
 *                            the subscription (Shopify's subscription GID, its
 *                            status, the period end, the confirmation URL we
 *                            last handed out) goes in here, under one `billing`
 *                            key. None of it is ever used to decide access; it
 *                            exists so the app can show the merchant what they
 *                            are on and so support can see what Shopify last
 *                            told us.
 *
 * lib/settings.ts owns that same column and is NOT ours to edit, so these
 * helpers have to share it without standing on it. Both sides do the same
 * thing - read the whole blob, merge, write the whole blob back - and both
 * preserve keys they do not recognise: `getMerchantSettings` spreads the parsed
 * object, so our `billing` key survives a settings-form save, and the read
 * below spreads the stored object, so the merchant's policy text survives a
 * billing write. Blind-overwriting either way would silently destroy the other
 * half of the column, which is exactly the data-loss bug the comment in
 * lib/settings.ts describes.
 *
 * The remaining honest limit: this is read-modify-write on a text column with
 * no row lock, so a settings save and a billing write landing in the same
 * millisecond can lose one of them. The window is tiny, the two are driven by
 * different actions, and the recoverable half - the billing record - is rebuilt
 * from Shopify on the next reconcile. Merchant.plan is written as a real column
 * update in the same statement, so ACCESS is never what gets lost.
 */

/** Mirrors Shopify's AppSubscriptionStatus, plus our own "NONE". */
export type BillingSubscriptionStatus =
  | "NONE"
  | "PENDING"
  | "ACTIVE"
  | "DECLINED"
  | "EXPIRED"
  | "FROZEN"
  | "CANCELLED"
  | "ACCEPTED";

export type BillingRecord = {
  /** The plan we believe the merchant is on. Merchant.plan is the authority. */
  planKey: BillingPlanKey;
  /** Shopify's AppSubscription GID, e.g. gid://shopify/AppSubscription/1234. */
  subscriptionGid: string | null;
  status: BillingSubscriptionStatus;
  /** ISO 8601. Shopify's currentPeriodEnd - when the next charge falls due. */
  currentPeriodEnd: string | null;
  /** ISO 8601. End of the free trial, when Shopify reports one. */
  trialEndsOn: string | null;
  /**
   * The last confirmation URL we handed the merchant. Kept because a merchant
   * who closes the approval screen has no way back to it, and re-creating the
   * subscription leaves an orphaned PENDING one behind on their account.
   */
  confirmationUrl: string | null;
  /**
   * Whether the subscription behind this record was created in Shopify's TEST
   * mode - i.e. it will never actually charge. Stored so "why has this merchant
   * never been billed?" is answerable from the record instead of guessed at.
   */
  test: boolean;
  /** ISO 8601. When we last reconciled this record against Shopify. */
  reconciledAt: string | null;
};

export const emptyBillingRecord: BillingRecord = {
  planKey: "STARTER",
  subscriptionGid: null,
  status: "NONE",
  currentPeriodEnd: null,
  trialEndsOn: null,
  confirmationUrl: null,
  test: true,
  reconciledAt: null
};

const BILLING_KEY = "billing";

function parseBlob(raw: string | null): Record<string, unknown> {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    // A corrupt blob must not take billing down. The settings module makes the
    // same choice for the same reason: JSON in a text column is never trusted.
    return {};
  }
}

function coerceRecord(value: unknown): BillingRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return emptyBillingRecord;
  }

  const stored = value as Partial<BillingRecord>;

  return {
    ...emptyBillingRecord,
    ...stored,
    // Field by field, because this is untyped JSON and a half-written entry
    // must not be able to produce a "subscriptionGid" that is a number.
    planKey: typeof stored.planKey === "string" ? (stored.planKey as BillingPlanKey) : emptyBillingRecord.planKey,
    subscriptionGid: typeof stored.subscriptionGid === "string" ? stored.subscriptionGid : null,
    status: typeof stored.status === "string" ? (stored.status as BillingSubscriptionStatus) : "NONE",
    currentPeriodEnd: typeof stored.currentPeriodEnd === "string" ? stored.currentPeriodEnd : null,
    trialEndsOn: typeof stored.trialEndsOn === "string" ? stored.trialEndsOn : null,
    confirmationUrl: typeof stored.confirmationUrl === "string" ? stored.confirmationUrl : null,
    test: typeof stored.test === "boolean" ? stored.test : true,
    reconciledAt: typeof stored.reconciledAt === "string" ? stored.reconciledAt : null
  };
}

/** Reads the billing half of settingsJson. Never throws; missing means "free". */
export async function readBillingRecord(shopDomain: string): Promise<BillingRecord> {
  try {
    const merchant = await db.merchant.findUnique({
      where: { shopDomain },
      select: { settingsJson: true }
    });

    return coerceRecord(parseBlob(merchant?.settingsJson ?? null)[BILLING_KEY]);
  } catch (error) {
    console.error(`[billing] could not read the billing record for ${shopDomain}`, error);
    return emptyBillingRecord;
  }
}

/**
 * Writes a PARTIAL billing update, merged onto what is stored, and optionally
 * sets Merchant.plan in the SAME statement.
 *
 * The two are written together on purpose. Writing the JSON first and the enum
 * second leaves a window where the app believes the merchant paid and the gate
 * still says free - and if the second write fails, that window never closes.
 */
export async function writeBillingRecord(
  shopDomain: string,
  patch: Partial<BillingRecord>,
  options: { plan?: BillingPlanKey } = {}
): Promise<BillingRecord> {
  const merchant = await db.merchant.findUnique({
    where: { shopDomain },
    select: { settingsJson: true }
  });

  const blob = parseBlob(merchant?.settingsJson ?? null);
  const next: BillingRecord = {
    ...coerceRecord(blob[BILLING_KEY]),
    ...patch,
    reconciledAt: patch.reconciledAt ?? new Date().toISOString()
  };

  // Spread the whole blob first so every key lib/settings.ts owns is carried
  // through untouched. Only `billing` is replaced.
  const merged = JSON.stringify({ ...blob, [BILLING_KEY]: next });

  await db.merchant.update({
    where: { shopDomain },
    data: {
      settingsJson: merged,
      ...(options.plan ? { plan: options.plan } : {})
    }
  });

  return next;
}
