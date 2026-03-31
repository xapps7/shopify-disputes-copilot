"use client";

import { BlockStack, Card, DataTable, InlineGrid, Page, Text } from "@shopify/polaris";

import type { AnalyticsSnapshotView } from "@/lib/types";

type AnalyticsPageShellProps = {
  snapshot: AnalyticsSnapshotView;
};

export function AnalyticsPageShell({ snapshot }: AnalyticsPageShellProps) {
  return (
    <Page title="Analytics" subtitle="Simple operational reporting for dispute volume, risk, and readiness.">
      <BlockStack gap="400">
        <InlineGrid columns={{ xs: 1, md: 4 }} gap="400">
          {[
            ["Open", snapshot.openCount],
            ["Won", snapshot.wonCount],
            ["Lost", snapshot.lostCount],
            ["Accepted", snapshot.acceptedCount]
          ].map(([label, value]) => (
            <Card key={label}>
              <BlockStack gap="100">
                <Text as="p" variant="bodySm" tone="subdued">
                  {label}
                </Text>
                <Text as="p" variant="headingLg">
                  {String(value)}
                </Text>
              </BlockStack>
            </Card>
          ))}
        </InlineGrid>

        <Card>
          <DataTable
            columnContentTypes={["text", "numeric"]}
            headings={["Signal", "Value"]}
            rows={[
              ["Due-date risk", String(snapshot.dueSoonCount)],
              ["Average readiness", `${snapshot.avgReadiness}%`],
              ["Fraud disputes", String(snapshot.fraudCount)],
              ["Product not received", String(snapshot.productNotReceivedCount)]
            ]}
          />
        </Card>
      </BlockStack>
    </Page>
  );
}
