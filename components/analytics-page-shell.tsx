"use client";

import { BlockStack, Card, DataTable, InlineGrid, Page, Text } from "@shopify/polaris";

import type { AnalyticsSnapshotView } from "@/lib/types";

type AnalyticsPageShellProps = {
  snapshot: AnalyticsSnapshotView;
};

export function AnalyticsPageShell({ snapshot }: AnalyticsPageShellProps) {
  return (
    <Page
      title="Analytics"
      subtitle="Simple operational reporting for dispute volume, deadlines, and evidence readiness."
    >
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

        <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                Risk snapshot
              </Text>
              <DataTable
                columnContentTypes={["text", "numeric"]}
                headings={["Signal", "Value"]}
                rows={[
                  ["Due within 48 hours", String(snapshot.dueSoonCount)],
                  ["Average evidence readiness", `${snapshot.avgReadiness}%`]
                ]}
              />
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                Common reasons
              </Text>
              <DataTable
                columnContentTypes={["text", "numeric"]}
                headings={["Reason", "Cases"]}
                rows={[
                  ["Fraud", String(snapshot.fraudCount)],
                  ["Product not received", String(snapshot.productNotReceivedCount)]
                ]}
              />
            </BlockStack>
          </Card>
        </InlineGrid>
      </BlockStack>
    </Page>
  );
}
