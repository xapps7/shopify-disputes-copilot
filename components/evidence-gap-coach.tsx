"use client";

import { Badge, BlockStack, Divider, InlineStack, Text } from "@shopify/polaris";

import type { EvidenceGapInsight } from "@/lib/disputes/workflow";

type EvidenceGapCoachProps = {
  gaps: EvidenceGapInsight[];
};

export function EvidenceGapCoach({ gaps }: EvidenceGapCoachProps) {
  return (
    <BlockStack gap="200">
      {gaps.length > 0 ? (
        gaps.map((gap, index) => (
          <BlockStack gap="150" key={gap.label}>
            <InlineStack align="space-between" blockAlign="start">
              <BlockStack gap="050">
                <Text as="p" variant="bodyMd" fontWeight="medium">
                  {gap.label}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {gap.whyItMatters}
                </Text>
              </BlockStack>
              <Badge tone={gap.severity}>{gap.severity === "critical" ? "Needed now" : "Missing"}</Badge>
            </InlineStack>
            {index < gaps.length - 1 ? <Divider /> : null}
          </BlockStack>
        ))
      ) : (
        <Text as="p" variant="bodySm" tone="subdued">
          No checklist gaps remain. The operator can move to packet review and submission.
        </Text>
      )}
    </BlockStack>
  );
}
