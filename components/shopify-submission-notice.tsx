"use client";

import { Banner, BlockStack, Link as PolarisLink, Text } from "@shopify/polaris";

import { formatDateTime } from "@/lib/format/date";
import { shopifyAdminDisputeUrl } from "@/lib/format/shopify-admin";

type ShopifySubmissionNoticeProps = {
  shopDomain: string | null;
  shopifyDisputeId: string;
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
  recordedAt = null
}: ShopifySubmissionNoticeProps) {
  const adminUrl = shopifyAdminDisputeUrl(shopDomain, shopifyDisputeId);

  return (
    <Banner tone="warning" title="Evidence is not sent to Shopify from this app">
      <BlockStack gap="200">
        <p>
          Disputes Co-Pilot builds and stores your evidence packet locally. It does not upload evidence to Shopify
          or to the card issuer. Download the packet, then submit it yourself in Shopify Admin before the response
          deadline.
        </p>
        {recordedAt ? (
          <p>
            {`You marked this dispute as submitted on ${formatDateTime(recordedAt)}. That note is stored in this app only. If you have not already uploaded the evidence in Shopify Admin, this dispute is still unanswered.`}
          </p>
        ) : null}
        {adminUrl ? (
          <PolarisLink url={adminUrl} target="_blank">
            Open this dispute in Shopify Admin
          </PolarisLink>
        ) : (
          <Text as="p" variant="bodySm" tone="subdued">
            {`Open Shopify Admin, then go to Settings › Payments › Disputes and select dispute ${
              shopifyDisputeId.split("/").pop() ?? shopifyDisputeId
            }.`}
          </Text>
        )}
      </BlockStack>
    </Banner>
  );
}
