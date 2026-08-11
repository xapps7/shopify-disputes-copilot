"use client";

import {
  BlockStack,
  Card,
  Layout,
  SkeletonBodyText,
  SkeletonDisplayText,
  SkeletonPage
} from "@shopify/polaris";

export default function Loading() {
  return (
    <SkeletonPage primaryAction>
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="300">
                <SkeletonDisplayText size="small" />
                <SkeletonBodyText lines={3} />
              </BlockStack>
            </Card>
            <Card>
              <SkeletonBodyText lines={6} />
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </SkeletonPage>
  );
}
