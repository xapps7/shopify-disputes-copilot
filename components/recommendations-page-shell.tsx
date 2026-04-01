"use client";

import { Badge, BlockStack, Card, Divider, EmptyState, InlineStack, Text } from "@shopify/polaris";

import { AdminPageLayout } from "@/components/admin-page-layout";
import type { PreventionRecommendationView } from "@/lib/types";

type RecommendationsPageShellProps = {
  recommendations: PreventionRecommendationView[];
};

export function RecommendationsPageShell({ recommendations }: RecommendationsPageShellProps) {
  return (
    <AdminPageLayout
      title="Recommendations"
      subtitle="Turn dispute outcomes into prevention actions for the merchant team."
      gap="300"
    >
      {recommendations.length > 0 ? (
        <Card padding="0">
          <BlockStack gap="0">
            {recommendations.map((item, index) => (
              <BlockStack gap="150" key={item.id}>
                <InlineStack align="space-between" blockAlign="start">
                  <BlockStack gap="050">
                    <Text as="h2" variant="headingMd">
                      {item.category.replaceAll("_", " ")}
                    </Text>
                    <Text as="p" variant="bodyMd" tone="subdued">
                      {item.recommendationText}
                    </Text>
                  </BlockStack>
                  <Badge tone={item.priority === 1 ? "warning" : item.priority === 2 ? "attention" : "info"}>
                    {`Priority ${item.priority}`}
                  </Badge>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  {item.state.replaceAll("_", " ")}
                </Text>
                {index < recommendations.length - 1 ? <Divider /> : null}
              </BlockStack>
            ))}
          </BlockStack>
        </Card>
      ) : (
        <Card>
          <EmptyState heading="No recommendations yet" image="">
            <p>Recommendations appear after dispute outcomes are reviewed and tagged.</p>
          </EmptyState>
        </Card>
      )}
    </AdminPageLayout>
  );
}
