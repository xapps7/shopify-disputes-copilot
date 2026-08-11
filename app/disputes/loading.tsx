"use client";

import { BlockStack, Card, SkeletonBodyText, SkeletonDisplayText, SkeletonPage } from "@shopify/polaris";

export default function DisputesLoading() {
  return (
    <SkeletonPage primaryAction title="Disputes">
      <Card>
        <BlockStack gap="300">
          <SkeletonDisplayText size="small" />
          <SkeletonBodyText lines={8} />
        </BlockStack>
      </Card>
    </SkeletonPage>
  );
}
