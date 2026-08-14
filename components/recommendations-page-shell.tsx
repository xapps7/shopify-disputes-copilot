"use client";

import { Badge, Banner, BlockStack, Box, Divider, EmptyState, InlineGrid, Text } from "@shopify/polaris";

import { AdminPageLayout } from "@/components/admin-page-layout";
import { EMPTY_STATE_IMAGE } from "@/components/empty-state-image";
import { ResourceSection } from "@/components/resource-section";
import type { PreventionRecommendationView } from "@/lib/types";

type RecommendationsPageShellProps = {
  recommendations: PreventionRecommendationView[];
};

// Recommendations is no longer a destination of its own: prevention is what
// moves the VAMP and ECM ratios, so it belongs on Account health, next to the
// ratios it moves. The route still resolves - old links and bookmarks should
// not 404 - and it says where the work moved to.
export function RecommendationsPageShell({ recommendations }: RecommendationsPageShellProps) {
  return (
    <AdminPageLayout
      title="Recommendations"
      subtitle="Turn dispute outcomes into prevention actions for the merchant team."
      primaryAction={{ content: "Open Account health", url: "/account-health" }}
      banner={
        <Banner tone="info" title="Prevention now lives on Account health">
          <p>
            These actions sit beside the Visa and Mastercard ratios they exist to move, because avoiding a chargeback
            is the only thing that lowers those ratios — winning one does not.
          </p>
        </Banner>
      }
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
          <EmptyState heading="No recommendations yet" image={EMPTY_STATE_IMAGE}>
            <p>Recommendations appear after dispute outcomes are reviewed and tagged.</p>
          </EmptyState>
        </ResourceSection>
      )}
    </AdminPageLayout>
  );
}
