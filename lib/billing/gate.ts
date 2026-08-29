import { NextResponse } from "next/server";

import {
  BILLING_PLANS,
  FREE_PLAN,
  FREE_PLAN_KEY,
  PAID_PLAN_KEY,
  planAllows,
  resolvePlan,
  upgradeMessage,
  type BillingPlan,
  type BillingPlanKey,
  type Capability
} from "@/lib/billing/plans";
import { db } from "@/lib/db";

/**
 * The one place the rest of the app asks "is this merchant allowed to do this?".
 *
 * Three rules, and the third is the one that matters:
 *
 *   1. The answer comes from Merchant.plan and nothing else. Not from the
 *      settingsJson billing record, not from a Shopify call. A gate that has to
 *      talk to Shopify is a gate that fails when Shopify is slow, and a paying
 *      merchant would then be told to upgrade.
 *   2. The refusal is structured, not a thrown error, so a route can turn it
 *      into a clear message instead of a 500. "Something went wrong" is the
 *      worst possible copy for a paywall - the merchant thinks the app is
 *      broken and writes the review to match.
 *   3. IT FAILS CLOSED. If the merchant row is missing, the query throws, or the
 *      plan column holds something no longer in the enum, the answer is the FREE
 *      plan. Never paid.
 *
 * Failing closed here costs a paying merchant a moment of confusion during a
 * database blip - annoying, self-correcting, and they can see their own plan on
 * the settings page. Failing OPEN costs the opposite: every merchant on earth
 * gets the paid product for free during that same blip, and nobody reports it.
 * One of those errors gets fixed and the other never does.
 */

export type CapabilityGrant = {
  allowed: true;
  plan: BillingPlan;
  capability: Capability;
};

export type CapabilityRefusal = {
  allowed: false;
  plan: BillingPlan;
  capability: Capability;
  /** The plan the merchant would need. */
  upgradeTo: BillingPlanKey;
  /** Merchant-readable. Safe to put straight on screen. */
  message: string;
  /** What a route should answer with. See the note on capabilityRefusalResponse. */
  status: 402;
};

export type CapabilityDecision = CapabilityGrant | CapabilityRefusal;

function refuse(plan: BillingPlan, capability: Capability): CapabilityRefusal {
  return {
    allowed: false,
    plan,
    capability,
    upgradeTo: PAID_PLAN_KEY,
    message: upgradeMessage(capability),
    status: 402
  };
}

function decide(plan: BillingPlan, capability: Capability): CapabilityDecision {
  return planAllows(plan.key, capability)
    ? { allowed: true, plan, capability }
    : refuse(plan, capability);
}

/**
 * Reads a merchant's plan, resolving anything unreadable to free.
 *
 * An uninstalled merchant is treated as free rather than as an error: the app
 * should never hand paid work to a shop that has removed it, and the caller's
 * own tenant guard is what decides whether the request should exist at all.
 */
export async function getMerchantPlan(merchantId: string): Promise<BillingPlan> {
  if (!merchantId) {
    return FREE_PLAN;
  }

  try {
    const merchant = await db.merchant.findUnique({
      where: { id: merchantId },
      select: { plan: true, uninstalledAt: true }
    });

    if (!merchant || merchant.uninstalledAt) {
      return FREE_PLAN;
    }

    const resolved = resolvePlan(merchant.plan);
    if (!resolved) {
      // A value the enum gained after this file was written, or a hand-edited
      // row. Log it - a silent downgrade of a paying merchant is a support
      // ticket nobody can explain otherwise.
      console.error(`[billing] merchant ${merchantId} has an unrecognised plan "${merchant.plan}" - treating as free.`);
      return FREE_PLAN;
    }

    return resolved;
  } catch (error) {
    console.error(`[billing] could not read the plan for merchant ${merchantId} - treating as free.`, error);
    return FREE_PLAN;
  }
}

/** Same, keyed on the shop domain, for routes that only went through guardShopRoute. */
export async function getPlanForShop(shopDomain: string): Promise<BillingPlan> {
  if (!shopDomain) {
    return FREE_PLAN;
  }

  try {
    const merchant = await db.merchant.findUnique({
      where: { shopDomain },
      select: { plan: true, uninstalledAt: true }
    });

    if (!merchant || merchant.uninstalledAt) {
      return FREE_PLAN;
    }

    return resolvePlan(merchant.plan) ?? FREE_PLAN;
  } catch (error) {
    console.error(`[billing] could not read the plan for ${shopDomain} - treating as free.`, error);
    return FREE_PLAN;
  }
}

/**
 * The gate. Call this at the top of any handler that does paid work, right
 * after the tenant guard.
 *
 *   const { merchant } = await guardDisputeRoute(request, id);
 *   const gate = await requireCapability(merchant.id, "AUTO_DRAFT");
 *   if (!gate.allowed) return capabilityRefusalResponse(gate);
 */
export async function requireCapability(
  merchantId: string,
  capability: Capability
): Promise<CapabilityDecision> {
  return decide(await getMerchantPlan(merchantId), capability);
}

/** The same check for a route that holds a shop domain rather than a merchant id. */
export async function requireCapabilityForShop(
  shopDomain: string,
  capability: Capability
): Promise<CapabilityDecision> {
  return decide(await getPlanForShop(shopDomain), capability);
}

/**
 * Turns a refusal into a response.
 *
 * 402 Payment Required, not 403. 403 means "you may never do this" and the
 * client should stop asking; 402 means "there is a way to do this and it costs
 * money", which is exactly the situation and lets the front end tell a paywall
 * apart from a permissions failure without string-matching the message.
 *
 * The body carries the plan and the capability so the UI can render the right
 * upgrade prompt rather than a generic one.
 */
export function capabilityRefusalResponse(refusal: CapabilityRefusal) {
  return NextResponse.json(
    {
      ok: false,
      message: refusal.message,
      reason: "PLAN_REQUIRED",
      capability: refusal.capability,
      plan: refusal.plan.key,
      upgradeTo: refusal.upgradeTo
    },
    { status: refusal.status }
  );
}

/**
 * Everything the UI needs to draw the plan card and decide which buttons to
 * show. Server-side only - the client must never be the thing deciding whether
 * a capability is granted, because the routes are what an attacker calls.
 */
export async function getPlanSummary(shopDomain: string) {
  const plan = await getPlanForShop(shopDomain);

  return {
    plan: plan.key,
    planName: plan.name,
    isPaid: plan.key !== FREE_PLAN_KEY,
    capabilities: plan.capabilities,
    priceUsd: BILLING_PLANS[PAID_PLAN_KEY].priceUsd,
    trialDays: BILLING_PLANS[PAID_PLAN_KEY].trialDays
  };
}
