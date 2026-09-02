"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge, Banner, BlockStack, Button, Card, Divider, InlineStack, Link, List, Text } from "@shopify/polaris";

import { authenticatedFetch } from "@/components/authenticated-fetch";

/**
 * The merchant's plan, and the only place in the app that sells anything.
 *
 * The pricing line this card has to communicate is in lib/billing/plans.ts:
 * FREE SHOWS THE MERCHANT WHAT IS HAPPENING, PAID DOES THE WORK FOR THEM. Free
 * has no volume cap and never will, deadline emails are free, and nothing a
 * merchant can see today is taken away by not paying. So this card states both
 * halves plainly and side by side, and never implies that data is being held
 * back - only labour is.
 *
 * It takes the plan as PROPS. It must not read the plan itself: the answer
 * comes from `getPlanSummary` on the server (lib/billing/gate.ts), which fails
 * closed to free, and a client component has no database and no business being
 * the thing that decides what a merchant is entitled to.
 */

/**
 * Structurally what `getPlanSummary` returns, re-declared rather than imported.
 *
 * Importing the type from lib/billing/gate.ts would pull `next/server` and the
 * Prisma client into a "use client" module graph. The server page passes the
 * whole summary object; the extra keys on it are ignored here.
 */
export type PlanCardSummary = {
  /** Merchant-facing plan name, e.g. "Free" or "Pro". */
  planName: string;
  /** True for any plan that is not the free one. */
  isPaid: boolean;
  /** Price of the paid plan, in USD per month. */
  priceUsd: number;
  /** Free days before the first charge on the paid plan. */
  trialDays: number;
};

type PlanCardProps = {
  plan: PlanCardSummary;
};

type SubscribeResponse = {
  ok?: boolean;
  alreadySubscribed?: boolean;
  confirmationUrl?: string | null;
  message?: string;
};

/** Free is the whole picture: every dispute, every deadline, at any volume. */
const FREE_INCLUDES = [
  "Every dispute you get, with the deadline on each one. There is no limit on how many.",
  "Whether a dispute qualifies for Visa Compelling Evidence 3.0.",
  "Account health: the ratios the card networks and Shopify watch you against.",
  "What each dispute is costing you, on screen.",
  "Deadline reminder emails."
] as const;

/**
 * Paid is labour, and the list says so in verbs. "Sending evidence into
 * Shopify's form" carries its caveat out loud because the scope it needs is not
 * granted yet (see PUSH_TO_SHOPIFY in lib/billing/plans.ts) - selling a feature
 * that cannot run today without saying so is how an app earns a refund request.
 */
const PRO_ADDS = [
  "The app writes the first draft of the evidence text for you, from your own order data.",
  "Save a policy document once and reuse it on every dispute.",
  "Download the finished evidence pack as a file.",
  "The monthly dispute statement, as a file for your bank or your accountant.",
  "Evidence written straight into Shopify's dispute form, once Shopify grants the app that access."
] as const;

/**
 * Sends the merchant OUT of the app's iframe.
 *
 * Shopify's subscription approval screen sets frame-ancestors and refuses to
 * render inside an app's iframe. A plain `window.location = url` or an ordinary
 * `<a href>` therefore navigates the FRAME, and the merchant gets a blank panel
 * where the approve button should be - the app looks broken at the exact moment
 * it is asking for money.
 *
 * App Bridge is loaded from Shopify's CDN in app/layout.tsx (there is no
 * `createApp` in this codebase - the script tag plus the `shopify-api-key` meta
 * tag is the whole setup). It patches `window.open`, so `open(url, "_top")` is
 * the documented way to ask the Shopify admin, which owns the top frame, to
 * navigate. That is the same mechanism `ui-nav-menu` in components/app-shell.tsx
 * relies on.
 *
 * Outside the iframe - the app opened directly, or App Bridge failed to load -
 * there is nothing to escape from and an ordinary navigation is correct.
 * Returns false if every route out was refused, so the caller can offer a link
 * the merchant clicks themselves rather than leaving them on a dead button.
 */
function navigateTopLevel(url: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  if (window.top === window.self) {
    window.location.assign(url);
    return true;
  }

  try {
    window.open(url, "_top");
    return true;
  } catch {
    // App Bridge missing or the call refused. Fall through.
  }

  try {
    if (window.top) {
      window.top.location.href = url;
      return true;
    }
  } catch {
    // Cross-origin top frame with top navigation disallowed.
  }

  return false;
}

export function PlanCard({ plan }: PlanCardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Set only when the automatic hand-off failed and the merchant must click. */
  const [manualApprovalUrl, setManualApprovalUrl] = useState<string | null>(null);

  async function handleSubscribe() {
    setIsSubscribing(true);
    setError(null);
    setNotice(null);
    setManualApprovalUrl(null);

    /**
     * Local, not state: the `finally` below runs before React has re-rendered,
     * so reading a state value there would read the one from this render.
     */
    let leavingTheApp = false;

    try {
      const response = await authenticatedFetch("/api/billing/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // `host` is Shopify's base64 admin host for this session. The route puts
        // it in the return URL so approving the charge lands the merchant back
        // inside their admin rather than on a bare page.
        body: JSON.stringify({ host: searchParams.get("host") ?? undefined })
      });

      const payload = (await response.json().catch(() => null)) as SubscribeResponse | null;

      if (!response.ok || !payload?.ok) {
        setError(payload?.message ?? "The app could not start the subscription. Nothing has been charged.");
        return;
      }

      if (payload.alreadySubscribed) {
        setNotice(payload.message ?? "You are already on Pro.");
        // The route re-syncs the plan from Shopify when it finds an existing
        // subscription, so re-rendering the server page shows the right plan.
        router.refresh();
        return;
      }

      if (!payload.confirmationUrl) {
        setError("Shopify did not return an approval link. Try again in a moment; nothing has been charged.");
        return;
      }

      if (!navigateTopLevel(payload.confirmationUrl)) {
        setManualApprovalUrl(payload.confirmationUrl);
        setError("Your browser blocked the jump to Shopify. Use the link below to approve the charge.");
        return;
      }

      // Deliberately leaves the button in its loading state: the top frame is
      // navigating away, and flipping it back to "Subscribe to Pro" for the
      // moment before it does reads as a click that did nothing.
      leavingTheApp = true;
    } catch {
      setError("The request did not reach the app. Check your connection and try again. Nothing has been charged.");
    } finally {
      if (!leavingTheApp) {
        setIsSubscribing(false);
      }
    }
  }

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center" gap="200" wrap>
          <Text as="h2" variant="headingSm">
            Your plan
          </Text>
          {/* The badge names the plan in words, so colour never carries it alone. */}
          <Badge tone={plan.isPaid ? "success" : "info"}>{plan.planName}</Badge>
        </InlineStack>

        <Text as="p" variant="headingMd">
          {plan.isPaid ? `You are on ${plan.planName}.` : `You are on the ${plan.planName} plan.`}
        </Text>

        <Text as="p" variant="bodyMd">
          {plan.isPaid
            ? "Everything below is switched on for this shop, including the parts where the app does the writing and the filing for you."
            : "Free has no limit on disputes. However many you get, you see all of them, with every deadline, for as long as you use the app."}
        </Text>

        <Divider />

        <BlockStack gap="150">
          <Text as="h3" variant="headingSm">
            On every plan, free
          </Text>
          <List type="bullet">
            {FREE_INCLUDES.map((item) => (
              <List.Item key={item}>{item}</List.Item>
            ))}
          </List>
        </BlockStack>

        <BlockStack gap="150">
          <Text as="h3" variant="headingSm">
            What Pro adds
          </Text>
          <List type="bullet">
            {PRO_ADDS.map((item) => (
              <List.Item key={item}>{item}</List.Item>
            ))}
          </List>
        </BlockStack>

        {plan.isPaid ? (
          <Text as="p" tone="subdued" variant="bodySm">
            {`Shopify bills $${plan.priceUsd} a month for Pro on your usual Shopify invoice. You can cancel it from your Shopify admin, and your queue, deadlines and reminder emails carry on either way.`}
          </Text>
        ) : (
          <BlockStack gap="300">
            <Text as="p" variant="bodyMd">
              {`Pro is $${plan.priceUsd} a month, and the first ${plan.trialDays} days are free. Shopify bills it on your usual Shopify invoice.`}
            </Text>

            <Text as="p" variant="bodyMd">
              Pro pays for the work the app does for you. It takes nothing away from the free plan.
            </Text>

            {error ? (
              <Banner tone="critical" title="Could not start the subscription">
                <p>{error}</p>
                {manualApprovalUrl ? (
                  <p>
                    {/*
                      target="_top" for the same reason as navigateTopLevel:
                      Shopify's approval screen will not load inside this frame.
                      A real click carries the user activation some browsers
                      require before they allow the top frame to navigate.
                    */}
                    <Link target="_top" url={manualApprovalUrl}>
                      Open Shopify&rsquo;s approval screen
                    </Link>
                  </p>
                ) : null}
              </Banner>
            ) : null}

            {notice ? (
              <Banner tone="success" title="Pro is already on for this shop">
                <p>{notice}</p>
              </Banner>
            ) : null}

            <InlineStack>
              <Button loading={isSubscribing} onClick={handleSubscribe} variant="primary">
                {isSubscribing ? "Opening Shopify..." : "Subscribe to Pro"}
              </Button>
            </InlineStack>

            <Text as="p" tone="subdued" variant="bodySm">
              Shopify asks you to approve the charge. Nothing is charged until you do.
            </Text>
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}
