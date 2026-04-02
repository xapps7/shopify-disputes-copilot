"use client";

import { Badge, BlockStack, Card, Divider, InlineStack, Text } from "@shopify/polaris";

import type { SetupReadinessItem } from "@/lib/platform-readiness";

type SetupReadinessCardProps = {
  items: SetupReadinessItem[];
};

function toneForStatus(status: SetupReadinessItem["status"]) {
  if (status === "ready") return "success" as const;
  if (status === "attention") return "warning" as const;
  return "critical" as const;
}

export function SetupReadinessCard({ items }: SetupReadinessCardProps) {
  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">
          Setup readiness
        </Text>
        {items.map((item, index) => (
          <BlockStack gap="150" key={item.key}>
            <InlineStack align="space-between" blockAlign="start">
              <BlockStack gap="050">
                <Text as="p" variant="bodyMd" fontWeight="medium">
                  {item.label}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {item.detail}
                </Text>
              </BlockStack>
              <Badge tone={toneForStatus(item.status)}>
                {item.status === "ready" ? "Ready" : item.status === "attention" ? "Needs work" : "Blocked"}
              </Badge>
            </InlineStack>
            {index < items.length - 1 ? <Divider /> : null}
          </BlockStack>
        ))}
      </BlockStack>
    </Card>
  );
}
