"use client";

import { BlockStack, Card, Layout, SkeletonBodyText, SkeletonDisplayText, SkeletonPage } from "@shopify/polaris";

export default function DisputeDetailLoading() {
  return (
    <SkeletonPage primaryAction title="Dispute">
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="300">
                <SkeletonDisplayText size="small" />
                <SkeletonBodyText lines={4} />
              </BlockStack>
            </Card>
            <Card>
              <SkeletonBodyText lines={8} />
            </Card>
          </BlockStack>
        </Layout.Section>
        <Layout.Section variant="oneThird">
          <Card>
            <SkeletonBodyText lines={6} />
          </Card>
        </Layout.Section>
      </Layout>
    </SkeletonPage>
  );
}
