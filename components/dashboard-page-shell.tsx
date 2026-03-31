"use client";

import Link from "next/link";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  InlineGrid,
  InlineStack,
  Page,
  ProgressBar,
  Text
} from "@shopify/polaris";

import { DashboardInsights } from "@/components/dashboard-insights";
import { InfoHint } from "@/components/info-hint";
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
    <Page>
      <BlockStack gap="500">
        <div className="page-lead">
          <BlockStack gap="100">
            <Text as="h2" variant="headingXl">
              Inbox
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              Handle urgent cases first, then collect missing proof, then review reply quality.
            </Text>
          </BlockStack>
          <div className="page-lead__actions">
            <Button variant="primary" url="/dashboard">
              Sync disputes
            </Button>
          </div>
        </div>

        <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
          <Card>
            <BlockStack gap="150">
              <InlineStack align="space-between">
                <InlineStack gap="100" blockAlign="center">
                  <Text as="h3" variant="headingMd">
                    Today&apos;s exposure
                  </Text>
                  <InfoHint content="Total disputed value across the currently active queue." />
                </InlineStack>
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
                <InlineStack gap="100" blockAlign="center">
                  <Text as="h3" variant="headingMd">
                    Readiness posture
                  </Text>
                  <InfoHint content="Readiness estimates how complete the evidence shelf is for expected dispute categories." />
                </InlineStack>
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
          <BlockStack gap="200">
            <InlineStack align="space-between">
              <Text as="h2" variant="headingMd">
                Next best actions
              </Text>
              <Badge tone="info">Operator flow</Badge>
            </InlineStack>
            <div className="next-steps-grid">
              {[
                ["1. Clear urgent cases", "Any case due today or tomorrow should move first."],
                ["2. Close evidence gaps", "If readiness is low, collect proof before editing the merchant reply."],
                ["3. Review packet quality", "Only after evidence is solid should the merchant narrative be refined."]
              ].map(([title, detail]) => (
                <div className="next-step-card" key={title}>
                  <Text as="p" variant="bodyMd" fontWeight="semibold">
                    {title}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {detail}
                  </Text>
                </div>
              ))}
            </div>
          </BlockStack>
        </Card>

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
                    <InlineStack gap="100" blockAlign="center">
                      <Text as="h3" variant="headingSm">
                        {section.title}
                      </Text>
                      <InfoHint
                        content={
                          section.title === "Needs action now"
                            ? "These cases are due immediately or already overdue."
                            : section.title === "Blocked on evidence"
                              ? "These cases need more proof before drafting should continue."
                              : "These cases are strong enough for narrative and packet review."
                        }
                      />
                    </InlineStack>
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
