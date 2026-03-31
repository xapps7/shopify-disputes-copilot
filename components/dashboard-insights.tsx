"use client";

import { Badge, BlockStack, Box, Card, InlineStack, List, Text } from "@shopify/polaris";

import type { DashboardInsightView } from "@/lib/types";

type DashboardInsightsProps = {
  insights: DashboardInsightView[];
};

function toneToBadge(tone: DashboardInsightView["tone"]) {
  if (tone === "warning") {
    return "warning";
  }

  if (tone === "success") {
    return "success";
  }

  return "info";
}

export function DashboardInsights({ insights }: DashboardInsightsProps) {
  return (
    <div className="dashboard-insights">
      {insights.map((insight) => (
        <Card key={insight.title}>
          <BlockStack gap="300">
            <InlineStack align="space-between">
              <Text as="h3" variant="headingSm">
                {insight.title}
              </Text>
              <Badge tone={toneToBadge(insight.tone)}>{insight.tone}</Badge>
            </InlineStack>
            <Text as="p" variant="bodyMd">
              {insight.summary}
            </Text>
            <Box background="bg-surface-secondary" borderRadius="300" padding="300">
              <Text as="p" variant="bodyMd" tone="subdued">
                {insight.detail}
              </Text>
            </Box>
            <List type="bullet">
              {insight.actions.map((action) => (
                <List.Item key={action}>{action}</List.Item>
              ))}
            </List>
          </BlockStack>
        </Card>
      ))}
    </div>
  );
}
