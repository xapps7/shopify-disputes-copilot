"use client";

import { Banner, Page } from "@shopify/polaris";

/**
 * Shown when the shop cannot be resolved. Rendering empty meters here would
 * read as a measured "zero risk", which is the one thing this screen must
 * never imply.
 */
export function AccountHealthUnavailable() {
  return (
    <Page title="Account health">
      <Banner tone="warning" title="We cannot measure your account health yet">
        <p>
          This shop is not connected, so your Visa and Mastercard dispute ratios cannot be calculated. Open the app
          from your Shopify admin, then sync your disputes.
        </p>
      </Banner>
    </Page>
  );
}
