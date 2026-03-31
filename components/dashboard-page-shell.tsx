"use client";

import Link from "next/link";
import {
  Badge,
  BlockStack,
  Box,
  Card,
  InlineGrid,
  InlineStack,
  Page,
  ProgressBar,
  Text
} from "@shopify/polaris";

import { DashboardInsights } from "@/components/dashboard-insights";
import type { DashboardDispute, DashboardInsightView } from "@/lib/types";

type DashboardPageShellProps = {
  disputes: DashboardDispute[];
  openDisputes: number;
  totalAmount: number;
  avgReadiness: number;
  urgentCount: number;
  lowReadinessCount: number;
  insights: DashboardInsightView[];
};

function dueLabel(value: string | null) {
  if (!value) {
    return { label: "No deadline", tone: "new" as const };
  }

  const delta = Math.ceil((new Date(value).getTime() - Date.now()) / (1000 * 60 * 60 * 24));

  if (delta < 0) {
    return { label: "Past due", tone: "critical" as const };
  }

  if (delta <= 1) {
    return { label: delta === 0 ? "Due today" : "Due tomorrow", tone: "warning" as const };
  }

  return { label: `Due in ${delta}d`, tone: "attention" as const };
}

function priorityBucket(dispute: DashboardDispute) {
  const due = dueLabel(dispute.evidenceDueBy);

  if (due.tone === "critical" || due.tone === "warning") {
    return "urgent" as const;
  }

  if (dispute.completenessScore < 70) {
    return "blocked" as const;
  }

  return "review" as const;
}

function statusTone(status: string) {
  if (status.includes("WARNING") || status === "NEEDS_RESPONSE") {
    return "warning" as const;
  }

  if (status === "UNDER_REVIEW") {
    return "info" as const;
  }

  if (status === "WON") {
    return "success" as const;
  }

  return undefined;
}

export function DashboardPageShell({
  disputes,
  openDisputes,
  totalAmount,
  avgReadiness,
  urgentCount,
  lowReadinessCount,
  insights
}: DashboardPageShellProps) {
  const urgentItems = disputes.filter((dispute) => priorityBucket(dispute) === "urgent");
  const blockedItems = disputes.filter((dispute) => priorityBucket(dispute) === "blocked");
  const reviewItems = disputes.filter((dispute) => priorityBucket(dispute) === "review");

  return (
    <Page
      title="Inbox"
      subtitle="Start with what is due now, then move to evidence gaps, then review cases that are ready to tighten."
      primaryAction={{ content: "Sync disputes", url: "/dashboard" }}
    >
      <BlockStack gap="500">
        <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
          <Card>
            <BlockStack gap="150">
              <InlineStack align="space-between">
                <Text as="h3" variant="headingMd">
                  Today&apos;s exposure
                </Text>
                <Text as="p" variant="headingMd">
                  ${totalAmount.toFixed(0)}
                </Text>
              </InlineStack>
              <Text as="p" variant="bodyMd" tone="subdued">
                {openDisputes} active disputes in queue. Handle {urgentCount} urgent cases first before
                editing narrative quality on the rest.
              </Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="150">
              <InlineStack align="space-between">
                <Text as="h3" variant="headingMd">
                  Readiness posture
                </Text>
                <Text as="p" variant="headingMd">
                  {avgReadiness}%
                </Text>
              </InlineStack>
              <Text as="p" variant="bodyMd" tone="subdued">
                {lowReadinessCount} cases are still missing enough evidence that writing the reply too early
                would waste time.
              </Text>
            </BlockStack>
          </Card>
        </InlineGrid>

        <Card>
          <BlockStack gap="400">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">
                Work queues
              </Text>
              <Text as="p" variant="bodyMd" tone="subdued">
                Organize the desk by what needs action, what is blocked, and what is ready for a final
                merchant review.
              </Text>
            </BlockStack>

            {[
              {
                title: "Needs action now",
                description: "Deadline pressure or already overdue. Do these first.",
                tone: "warning" as const,
                items: urgentItems
              },
              {
                title: "Blocked on evidence",
                description: "Not urgent yet, but still too weak to draft confidently.",
                tone: "attention" as const,
                items: blockedItems
              },
              {
                title: "Ready to review",
                description: "Good enough to refine narrative quality and packet structure.",
                tone: "success" as const,
                items: reviewItems
              }
            ].map((section) => (
              <BlockStack gap="300" key={section.title}>
                <InlineStack align="space-between">
                  <BlockStack gap="050">
                    <Text as="h3" variant="headingSm">
                      {section.title}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {section.description}
                    </Text>
                  </BlockStack>
                  <Badge tone={section.tone}>{String(section.items.length)}</Badge>
                </InlineStack>

                {section.items.length > 0 ? (
                  <div className="queue-list">
                    {section.items.map((dispute) => {
                      const due = dueLabel(dispute.evidenceDueBy);

                      return (
                        <Link className="queue-row" href={`/disputes/${dispute.id}`} key={dispute.id}>
                          <div className="queue-row__main">
                            <InlineStack gap="200" blockAlign="center">
                              <Text as="span" variant="bodyMd" fontWeight="semibold">
                                {dispute.shopifyDisputeId.split("/").pop()}
                              </Text>
                              <Badge tone={statusTone(dispute.status)}>
                                {dispute.status.replaceAll("_", " ")}
                              </Badge>
                            </InlineStack>
                            <Text as="p" variant="bodySm" tone="subdued">
                              {(dispute.reason ?? "Unknown").replaceAll("_", " ")}
                              {" · "}
                              {dispute.shopifyOrderId?.split("/").pop()
                                ? `Order ${dispute.shopifyOrderId.split("/").pop()}`
                                : "Order unavailable"}
                            </Text>
                          </div>

                          <div className="queue-row__meta">
                            <BlockStack gap="100">
                              <Text as="p" variant="bodySm" tone="subdued">
                                Amount
                              </Text>
                              <Text as="p" variant="bodyMd" fontWeight="medium">
                                {dispute.currencyCode ?? "USD"} {dispute.amount}
                              </Text>
                            </BlockStack>

                            <BlockStack gap="100">
                              <Text as="p" variant="bodySm" tone="subdued">
                                Due
                              </Text>
                              <Badge tone={due.tone}>{due.label}</Badge>
                            </BlockStack>

                            <BlockStack gap="100">
                              <Text as="p" variant="bodySm" tone="subdued">
                                Readiness
                              </Text>
                              <Box minWidth="120px">
                                <ProgressBar progress={dispute.completenessScore} size="small" />
                              </Box>
                              <Text as="p" variant="bodySm">
                                {dispute.completenessScore}%
                              </Text>
                            </BlockStack>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                ) : (
                  <Box background="bg-surface-secondary" borderRadius="300" padding="300">
                    <Text as="p" variant="bodySm" tone="subdued">
                      Nothing here right now.
                    </Text>
                  </Box>
                )}
              </BlockStack>
            ))}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Operator guidance
            </Text>
            <DashboardInsights insights={insights} />
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
