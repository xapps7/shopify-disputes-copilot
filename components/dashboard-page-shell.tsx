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
  return (
    <Page
      title="Dispute command center"
      subtitle="A lightweight operating view for triage, evidence readiness, and merchant response prep."
      primaryAction={{ content: "Sync disputes", url: "/dashboard" }}
    >
      <BlockStack gap="500">
        <InlineGrid columns={{ xs: 1, md: 4 }} gap="400">
          {[
            { label: "Open queue", value: String(openDisputes), footnote: "cases still active" },
            { label: "Exposure", value: `$${totalAmount.toFixed(0)}`, footnote: "disputed gross value" },
            { label: "Readiness", value: `${avgReadiness}%`, footnote: "evidence completeness" },
            { label: "Urgent", value: String(urgentCount), footnote: "due in 48 hours" }
          ].map((metric) => (
            <Card key={metric.label}>
              <BlockStack gap="100">
                <Text as="p" variant="bodySm" tone="subdued">
                  {metric.label}
                </Text>
                <Text as="p" variant="headingLg">
                  {metric.value}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {metric.footnote}
                </Text>
              </BlockStack>
            </Card>
          ))}
        </InlineGrid>

        <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
          <Card>
            <BlockStack gap="200">
              <InlineStack align="space-between">
                <Text as="h3" variant="headingSm">
                  Queue pressure
                </Text>
                <Badge tone={urgentCount > 0 ? "warning" : "success"}>
                  {urgentCount > 0 ? `${urgentCount} urgent` : "Stable"}
                </Badge>
              </InlineStack>
              <Text as="p" variant="bodyMd">
                Prioritize deadline pressure first. Then close evidence gaps on low-readiness cases before
                editing merchant reply language.
              </Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <InlineStack align="space-between">
                <Text as="h3" variant="headingSm">
                  Evidence posture
                </Text>
                <Badge tone={lowReadinessCount > 0 ? "attention" : "success"}>
                  {lowReadinessCount > 0 ? `${lowReadinessCount} below target` : "Healthy"}
                </Badge>
              </InlineStack>
              <Text as="p" variant="bodyMd">
                Keep the operator workflow simple: collect proof, draft the reply, regenerate the packet,
                then submit through Shopify.
              </Text>
            </BlockStack>
          </Card>
        </InlineGrid>

        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">
                  Live queue
                </Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Native merchant triage view with deadline, readiness, and direct case access.
                </Text>
              </BlockStack>
              <Button url="/dashboard">Refresh view</Button>
            </InlineStack>

            <div className="queue-list">
              {disputes.map((dispute) => {
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
