import { PAID_PLAN, type BillingPlan } from "@/lib/billing/plans";
import { createShopifyAdminClient } from "@/lib/shopify/client";
import { extractGraphqlErrors, graphqlErrorMessages } from "@/lib/shopify/errors";

/**
 * The Shopify side of billing.
 *
 * Shopify's app billing is a two-step handshake and there is no way around it:
 *
 *   1. `appSubscriptionCreate` returns a `confirmationUrl`. Nothing is charged
 *      and nothing is active yet - the subscription sits in PENDING.
 *   2. The MERCHANT opens that URL in their admin and approves it. Shopify then
 *      sends them to our `returnUrl`.
 *
 * Which is why this module also queries `currentAppInstallation.activeSubscriptions`.
 * Our own record is a cache of an approval we did not witness; Shopify's copy is
 * the fact. The subscription can also change without us: the merchant can cancel
 * it from their admin, it can go FROZEN when their Shopify bill is unpaid, and it
 * is CANCELLED automatically if they uninstall. None of those send us anything we
 * currently listen for, so the only correct model is "ask Shopify".
 *
 * https://shopify.dev/docs/api/admin-graphql/latest/mutations/appSubscriptionCreate
 * https://shopify.dev/docs/apps/launch/billing/subscription-billing
 */

type AdminClient = ReturnType<typeof createShopifyAdminClient>;

/* -------------------------------------------------------------- test mode --- */

/**
 * Shopify's `test` flag, and the two ways of getting it wrong.
 *
 * `test: true` creates a subscription that behaves exactly like a real one -
 * approval screen, ACTIVE status, everything - and NEVER CHARGES. That is what
 * you want on a development store; Shopify will not process real money on one
 * anyway, so a live-mode charge there just fails.
 *
 * The two failure modes are not symmetrical, which is what decides the default:
 *
 *   test:true in production   -> every merchant approves a charge that never
 *                                bills. The app works perfectly and earns zero.
 *                                Visible in the first payout that does not
 *                                arrive; recoverable by fixing the flag, though
 *                                every existing subscriber has to re-approve.
 *   test:false on a dev store -> the mutation fails, or worse, a real card
 *                                belonging to whoever owns the store is put on
 *                                the hook for a subscription created during a
 *                                demo. Recovering means refunding a stranger.
 *
 * So this defaults to TEST MODE and demands an explicit opt-out to bill for
 * real. Losing revenue is embarrassing; charging someone by accident during
 * development is expensive and hard to unwind. The startup warning below exists
 * so the embarrassing version is caught from the logs on the first production
 * boot rather than from a bank statement a month later.
 *
 * Set SHOPIFY_BILLING_TEST=false in production, and nowhere else.
 */
export function isBillingTestMode(): boolean {
  const configured = process.env.SHOPIFY_BILLING_TEST?.trim().toLowerCase();

  if (configured === "false") {
    return false;
  }

  if (process.env.NODE_ENV === "production" && configured !== "true") {
    console.warn(
      "[billing] running in Shopify TEST mode in production: subscriptions will be approved but " +
        "never charged. Set SHOPIFY_BILLING_TEST=false to bill for real."
    );
  }

  return true;
}

/* --------------------------------------------------------------- the URLs --- */

/**
 * Where Shopify sends the merchant after they approve.
 *
 * `host` is carried through because it is the only thing that lets us rebuild
 * the embedded admin URL and put the merchant back INSIDE their admin. Without
 * it the callback can only redirect to the shop's own domain, and the merchant
 * ends the flow staring at a bare app page outside the admin chrome, wondering
 * whether the payment worked.
 */
export function buildBillingReturnUrl(shopDomain: string, host: string | null): string {
  const appUrl = (process.env.SHOPIFY_APP_URL ?? "").replace(/\/+$/, "");
  const query = new URLSearchParams({ shop: shopDomain });

  if (host) {
    query.set("host", host);
  }

  return `${appUrl}/api/billing/callback?${query.toString()}`;
}

/* ------------------------------------------------------------- the schema --- */

const APP_SUBSCRIPTION_CREATE = `#graphql
  mutation AppSubscriptionCreate(
    $name: String!
    $returnUrl: URL!
    $trialDays: Int
    $test: Boolean
    $lineItems: [AppSubscriptionLineItemInput!]!
  ) {
    appSubscriptionCreate(
      name: $name
      returnUrl: $returnUrl
      trialDays: $trialDays
      test: $test
      lineItems: $lineItems
    ) {
      confirmationUrl
      appSubscription {
        id
        name
        status
        test
        trialDays
        currentPeriodEnd
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const ACTIVE_SUBSCRIPTIONS_QUERY = `#graphql
  query ActiveAppSubscriptions {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        test
        trialDays
        createdAt
        currentPeriodEnd
        lineItems {
          plan {
            pricingDetails {
              __typename
              ... on AppRecurringPricing {
                interval
                price {
                  amount
                  currencyCode
                }
              }
            }
          }
        }
      }
    }
  }
`;

/* --------------------------------------------------------------- the types --- */

export type ShopifySubscription = {
  id: string;
  name: string;
  status: string;
  test: boolean;
  trialDays: number | null;
  createdAt: string | null;
  currentPeriodEnd: string | null;
};

export type SubscriptionFailure = {
  ok: false;
  /** Safe to show a merchant. Never contains a token or an internal path. */
  message: string;
  /** Shopify's own field-level complaints, for the logs. */
  userErrors: Array<{ field: string | null; message: string }>;
};

export type SubscriptionStart =
  | {
      ok: true;
      confirmationUrl: string;
      subscription: ShopifySubscription | null;
      test: boolean;
    }
  | SubscriptionFailure;

export type ActiveSubscriptions =
  | { ok: true; subscriptions: ShopifySubscription[] }
  | { ok: false; message: string };

function normalizeUserErrors(raw: unknown): Array<{ field: string | null; message: string }> {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const item = entry as { field?: unknown; message?: unknown };
      if (typeof item.message !== "string") {
        return null;
      }
      return {
        field: Array.isArray(item.field) ? item.field.join(".") : null,
        message: item.message
      };
    })
    .filter((entry): entry is { field: string | null; message: string } => Boolean(entry));
}

function normalizeSubscription(raw: unknown): ShopifySubscription | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const node = raw as Record<string, unknown>;
  if (typeof node.id !== "string") {
    return null;
  }

  return {
    id: node.id,
    name: typeof node.name === "string" ? node.name : "",
    status: typeof node.status === "string" ? node.status : "UNKNOWN",
    // Absent means "not a test subscription" - but default to true rather than
    // false, because claiming a subscription is billable when we do not know is
    // the claim that puts a wrong number in front of the owner.
    test: typeof node.test === "boolean" ? node.test : true,
    trialDays: typeof node.trialDays === "number" ? node.trialDays : null,
    createdAt: typeof node.createdAt === "string" ? node.createdAt : null,
    currentPeriodEnd: typeof node.currentPeriodEnd === "string" ? node.currentPeriodEnd : null
  };
}

/* ------------------------------------------------------------ the mutation --- */

/**
 * Starts a subscription and returns the URL the merchant must approve.
 *
 * Nothing here changes what the merchant is allowed to do. The plan is only
 * ever raised in the callback, after Shopify confirms the subscription is real.
 */
export async function startAppSubscription(options: {
  client: AdminClient;
  returnUrl: string;
  plan?: BillingPlan;
}): Promise<SubscriptionStart> {
  const plan = options.plan ?? PAID_PLAN;

  if (!plan.billed || !plan.shopifyPlanName) {
    return {
      ok: false,
      message: "That plan is not sold through Shopify billing.",
      userErrors: []
    };
  }

  // A price of zero would create a subscription that charges nothing and looks
  // exactly like a working one. Catch the unset constant here rather than
  // discovering it in a revenue report.
  if (!(plan.priceUsd > 0)) {
    console.error("[billing] PAID_PLAN_PRICE_USD is not set - refusing to create a zero-price subscription.");
    return {
      ok: false,
      message: "Billing is not configured for this app yet. Nothing has been charged.",
      userErrors: []
    };
  }

  if (!options.returnUrl.startsWith("https://")) {
    // Shopify rejects a non-HTTPS returnUrl, and an empty SHOPIFY_APP_URL
    // produces exactly that - a relative path Shopify refuses with an opaque
    // error about the URL scheme.
    console.error(`[billing] refusing to create a subscription with an invalid returnUrl: ${options.returnUrl}`);
    return {
      ok: false,
      message: "Billing is not configured for this app yet. Nothing has been charged.",
      userErrors: []
    };
  }

  const test = isBillingTestMode();

  const response = await options.client.request(APP_SUBSCRIPTION_CREATE, {
    variables: {
      name: plan.shopifyPlanName,
      returnUrl: options.returnUrl,
      trialDays: plan.trialDays,
      test,
      lineItems: [
        {
          plan: {
            appRecurringPricingDetails: {
              price: { amount: plan.priceUsd, currencyCode: "USD" },
              interval: plan.interval
            }
          }
        }
      ]
    }
  });

  // Transport and GraphQL errors. `response.errors` is an OBJECT, not an array -
  // see the header of lib/shopify/errors.ts for the bug that caused.
  const transportErrors = extractGraphqlErrors(response);
  if (transportErrors.length > 0) {
    console.error("[billing] appSubscriptionCreate failed:", graphqlErrorMessages(response).join(" | "));
    return {
      ok: false,
      message: "Shopify would not start the subscription. Nothing has been charged. Please try again.",
      userErrors: []
    };
  }

  const payload = (response.data as { appSubscriptionCreate?: Record<string, unknown> } | undefined)
    ?.appSubscriptionCreate;

  // userErrors are a SEPARATE failure channel from response.errors: the request
  // succeeded and Shopify refused the operation. Treating a payload with
  // userErrors as success is how apps end up telling a merchant they subscribed
  // when they did not.
  const userErrors = normalizeUserErrors(payload?.userErrors);
  if (userErrors.length > 0) {
    console.error(
      "[billing] appSubscriptionCreate userErrors:",
      userErrors.map((entry) => [entry.field, entry.message].filter(Boolean).join(": ")).join(" | ")
    );
    return {
      ok: false,
      message: "Shopify rejected the subscription. Nothing has been charged.",
      userErrors
    };
  }

  const confirmationUrl = typeof payload?.confirmationUrl === "string" ? payload.confirmationUrl : null;
  if (!confirmationUrl) {
    // No errors and no URL should be impossible. If it happens, it is still a
    // failure - there is nowhere to send the merchant.
    console.error("[billing] appSubscriptionCreate returned no confirmationUrl and no errors.");
    return {
      ok: false,
      message: "Shopify did not return an approval link. Nothing has been charged.",
      userErrors: []
    };
  }

  return {
    ok: true,
    confirmationUrl,
    subscription: normalizeSubscription(payload?.appSubscription),
    test
  };
}

/* --------------------------------------------------------------- the truth --- */

/**
 * What Shopify says this install is actually subscribed to.
 *
 * `activeSubscriptions` returns only subscriptions that are live now - an
 * approved, unexpired, uncancelled one. A PENDING subscription the merchant
 * never approved does not appear here, which is precisely the property that
 * makes this a proof of payment and a `charge_id` query parameter not one.
 */
export async function fetchActiveSubscriptions(client: AdminClient): Promise<ActiveSubscriptions> {
  const response = await client.request(ACTIVE_SUBSCRIPTIONS_QUERY);

  const errors = extractGraphqlErrors(response);
  if (errors.length > 0) {
    console.error("[billing] activeSubscriptions read failed:", graphqlErrorMessages(response).join(" | "));
    return {
      ok: false,
      message: "Could not read the subscription from Shopify."
    };
  }

  const data = response.data as
    | { currentAppInstallation?: { activeSubscriptions?: unknown[] } | null }
    | undefined;

  const nodes = Array.isArray(data?.currentAppInstallation?.activeSubscriptions)
    ? data.currentAppInstallation.activeSubscriptions
    : [];

  return {
    ok: true,
    subscriptions: nodes
      .map(normalizeSubscription)
      .filter((entry): entry is ShopifySubscription => Boolean(entry))
  };
}

/**
 * Picks the subscription that entitles the merchant to the paid plan.
 *
 * Matched on the plan NAME rather than on a stored GID on purpose: the stored
 * GID can be missing (a merchant who subscribed from a device whose write
 * failed), stale (a re-subscribe after a cancellation), or from a subscription
 * the merchant approved on a different install. The name is what Shopify prints
 * on their invoice and is the only stable link between an active subscription
 * and a plan in this file.
 *
 * ACTIVE is required. ACCEPTED, PENDING, FROZEN, EXPIRED and CANCELLED all mean
 * "not paying right now", and a FROZEN subscription in particular is a merchant
 * whose Shopify bill is unpaid - Shopify is not collecting for us either.
 */
export function findPaidSubscription(
  subscriptions: ShopifySubscription[],
  plan: BillingPlan = PAID_PLAN
): ShopifySubscription | null {
  if (!plan.shopifyPlanName) {
    return null;
  }

  return (
    subscriptions.find(
      (subscription) => subscription.status === "ACTIVE" && subscription.name === plan.shopifyPlanName
    ) ?? null
  );
}
