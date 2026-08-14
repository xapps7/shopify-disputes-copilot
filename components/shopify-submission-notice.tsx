"use client";

import { Banner, BlockStack, Link as PolarisLink, Text } from "@shopify/polaris";

import { formatDateTime } from "@/lib/format/date";
import { shopifyAdminOrderUrl, shopifyAdminOrdersUrl } from "@/lib/format/shopify-admin";

type ShopifySubmissionNoticeProps = {
  shopDomain: string | null;
  shopifyDisputeId: string;
  /** Shopify Admin has no per-dispute page; the chargeback lives on the order. */
  shopifyOrderId: string | null;
  /** When the merchant recorded a submission in this app, if they have. */
  recordedAt?: string | null;
};

/**
 * The app has no `disputeEvidenceUpdate` / `disputeEvidenceSubmit` call — the
 * "submit" flow only writes local rows. This notice is deliberately always
 * visible on the dispute surfaces so the merchant is never left believing their
 * evidence reached Shopify.
 */
export function ShopifySubmissionNotice({
  shopDomain,
  shopifyDisputeId,
  shopifyOrderId,
  recordedAt = null
}: ShopifySubmissionNoticeProps) {
  const adminUrl = shopifyAdminOrderUrl(shopDomain, shopifyOrderId) ?? shopifyAdminOrdersUrl(shopDomain);

  return (
    <Banner tone="warning" title="Evidence is not sent to Shopify from this app">
      <BlockStack gap="200">
        <p>
          Disputes Co-Pilot builds and stores your evidence packet locally. It does not upload evidence to Shopify
          or to the card issuer. Download the packet, then open the order in Shopify Admin and use the chargeback
          banner&rsquo;s <strong>Add evidence</strong> button. Do it before the auto-submit date: if you do not,
          Shopify sends a response for you using whatever it holds, and that is what the bank reads.
        </p>
        {recordedAt ? (
          <p>
            {`You marked this dispute as submitted on ${formatDateTime(recordedAt)}. That note is stored in this app only. If you have not already uploaded the evidence in Shopify Admin, this dispute is still unanswered.`}
          </p>
        ) : null}
        {adminUrl ? (
          <PolarisLink url={adminUrl} target="_blank">
            Open the order in Shopify Admin to respond
          </PolarisLink>
        ) : (
          <Text as="p" variant="bodySm" tone="subdued">
            {`Open Shopify Admin, go to Orders, filter by "Chargeback and inquiry status", and open the order for dispute ${
              shopifyDisputeId.split("/").pop() ?? shopifyDisputeId
            }. The chargeback banner on the order has an "Add evidence" button.`}
          </Text>
        )}
      </BlockStack>
    </Banner>
  );
}
