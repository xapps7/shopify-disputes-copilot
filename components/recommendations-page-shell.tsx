"use client";

import { Badge, BlockStack, Box, Divider, EmptyState, InlineGrid, Text } from "@shopify/polaris";

import { AdminPageLayout } from "@/components/admin-page-layout";
import { ResourceSection } from "@/components/resource-section";
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
        <ResourceSection title="Prevention actions" flush>
          <BlockStack gap="0">
            {recommendations.map((item, index) => (
              <Box key={item.id} padding="400">
                <InlineGrid columns={{ xs: "1fr", md: "minmax(0,1fr) auto" }} gap="300">
                  <BlockStack gap="150">
                    <Text as="h2" variant="headingMd">
                      {item.category.replaceAll("_", " ")}
                    </Text>
                    <div className="recommendation-copy">
                      <Text as="p" variant="bodyMd" tone="subdued">
                        {item.recommendationText}
                      </Text>
                    </div>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {item.state.replaceAll("_", " ")}
                    </Text>
                  </BlockStack>
                  <Box>
                    <Badge tone={item.priority === 1 ? "warning" : item.priority === 2 ? "attention" : "info"}>
                      {`Priority ${item.priority}`}
                    </Badge>
                  </Box>
                </InlineGrid>
                {index < recommendations.length - 1 ? <Divider /> : null}
              </Box>
            ))}
          </BlockStack>
        </ResourceSection>
      ) : (
        <ResourceSection title="Prevention actions">
          <EmptyState heading="No recommendations yet" image="">
            <p>Recommendations appear after dispute outcomes are reviewed and tagged.</p>
          </EmptyState>
        </ResourceSection>
      )}
    </AdminPageLayout>
  );
}
