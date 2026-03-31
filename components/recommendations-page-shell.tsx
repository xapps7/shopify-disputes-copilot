"use client";

import { Badge, BlockStack, Card, EmptyState, InlineGrid, Page, Text } from "@shopify/polaris";

import type { PreventionRecommendationView } from "@/lib/types";

type RecommendationsPageShellProps = {
  recommendations: PreventionRecommendationView[];
};

export function RecommendationsPageShell({ recommendations }: RecommendationsPageShellProps) {
  return (
    <Page title="Recommendations" subtitle="Turn dispute outcomes into prevention actions for the merchant team.">
      {recommendations.length > 0 ? (
        <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
          {recommendations.map((item) => (
            <Card key={item.id}>
              <BlockStack gap="150">
                <Badge tone={item.priority === 1 ? "warning" : item.priority === 2 ? "attention" : "info"}>
                  {`Priority ${item.priority}`}
                </Badge>
                <Text as="h2" variant="headingMd">
                  {item.category.replaceAll("_", " ")}
                </Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  {item.recommendationText}
                </Text>
              </BlockStack>
            </Card>
          ))}
        </InlineGrid>
      ) : (
        <Card>
          <EmptyState heading="No recommendations yet" image="">
            <p>Recommendations appear after dispute outcomes are reviewed and tagged.</p>
          </EmptyState>
        </Card>
      )}
    </Page>
  );
}
