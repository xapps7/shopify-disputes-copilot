"use client";

import { Badge, BlockStack, List, ProgressBar, Text } from "@shopify/polaris";

import type { PacketQualityReview } from "@/lib/disputes/workflow";

type PacketQualityPanelProps = {
  review: PacketQualityReview;
};

function toneForStatus(status: PacketQualityReview["status"]) {
  if (status === "blocked") return "critical" as const;
  if (status === "needs_review") return "warning" as const;
  return "success" as const;
}

export function PacketQualityPanel({ review }: PacketQualityPanelProps) {
  return (
    <BlockStack gap="300">
      <BlockStack gap="150">
        <Text as="p" variant="bodySm" tone="subdued">
          Packet quality
        </Text>
        <Text as="p" variant="headingLg">
          {review.score}%
        </Text>
        <Badge tone={toneForStatus(review.status)}>
          {review.status === "blocked"
            ? "Blocked"
            : review.status === "needs_review"
              ? "Needs review"
              : "Ready"}
        </Badge>
        <ProgressBar
          progress={review.score}
          tone={review.status === "ready" ? "success" : review.status === "blocked" ? "critical" : "highlight"}
        />
        <Text as="p" variant="bodySm" tone="subdued">
          {review.summary}
        </Text>
      </BlockStack>

      {review.blockers.length > 0 ? (
        <BlockStack gap="100">
          <Text as="p" variant="bodySm" fontWeight="medium">
            Current blockers
          </Text>
          <List type="bullet">
            {review.blockers.map((item) => (
              <List.Item key={item}>{item}</List.Item>
            ))}
          </List>
        </BlockStack>
      ) : null}

      {review.strengths.length > 0 ? (
        <BlockStack gap="100">
          <Text as="p" variant="bodySm" fontWeight="medium">
            Current strengths
          </Text>
          <List type="bullet">
            {review.strengths.map((item) => (
              <List.Item key={item}>{item}</List.Item>
            ))}
          </List>
        </BlockStack>
      ) : null}

      <BlockStack gap="100">
        <Text as="p" variant="bodySm" fontWeight="medium">
          Next actions
        </Text>
        <List type="bullet">
          {review.nextActions.map((item) => (
            <List.Item key={item}>{item}</List.Item>
          ))}
        </List>
      </BlockStack>
    </BlockStack>
  );
}
