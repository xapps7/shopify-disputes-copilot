"use client";

import Link from "next/link";
import {
  Banner,
  Badge,
  BlockStack,
  Card,
  EmptyState,
  IndexTable,
  InlineGrid,
  InlineStack,
  Page,
  Text
} from "@shopify/polaris";

import { SyncDisputesButton } from "@/components/sync-disputes-button";
import type { DashboardDispute, OverviewMetricsView, PreventionRecommendationView } from "@/lib/types";

type OverviewPageShellProps = {
  metrics: OverviewMetricsView;
  recentDisputes: DashboardDispute[];
  recommendations: PreventionRecommendationView[];
};

function toneForStatus(status: string) {
  if (status.includes("WARNING") || status === "NEEDS_RESPONSE") return "warning" as const;
  if (status === "UNDER_REVIEW") return "info" as const;
  if (status === "WON") return "success" as const;
  if (status === "LOST" || status === "ACCEPTED") return "critical" as const;
  return undefined;
}

export function OverviewPageShell({ metrics, recentDisputes, recommendations }: OverviewPageShellProps) {
  return (
    <Page
      title="Overview"
      subtitle="Monitor open disputes, approaching deadlines, and evidence readiness."
      primaryAction={{ content: "View disputes", url: "/disputes" }}
    >
      <BlockStack gap="400">
        {metrics.dueSoon > 0 ? (
          <Banner tone="warning">
            <p>{metrics.dueSoon} disputes are due within 48 hours. Review deadlines before editing response narratives.</p>
          </Banner>
        ) : null}

        <SyncDisputesButton />

        <InlineGrid columns={{ xs: 1, md: 4 }} gap="400">
          {[
            ["Open disputes", String(metrics.openDisputes)],
            ["Due soon", String(metrics.dueSoon)],
            ["Total disputed", `$${metrics.totalAmount.toFixed(0)}`],
            ["Evidence-ready", String(metrics.evidenceReady)]
          ].map(([label, value]) => (
            <Card key={label}>
              <BlockStack gap="100">
                <Text as="p" variant="bodySm" tone="subdued">
                  {label}
                </Text>
                <Text as="p" variant="headingLg">
                  {value}
                </Text>
              </BlockStack>
            </Card>
          ))}
        </InlineGrid>

        <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                Attention needed
              </Text>
              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text as="p" variant="bodyMd">
                    Disputes due within 48 hours
                  </Text>
                  <Badge tone={metrics.dueSoon > 0 ? "warning" : "success"}>{String(metrics.dueSoon)}</Badge>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="p" variant="bodyMd">
                    Evidence-ready cases
                  </Text>
                  <Badge tone="info">{String(metrics.evidenceReady)}</Badge>
                </InlineStack>
              </BlockStack>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                Prevention insights
              </Text>
              {recommendations.length > 0 ? (
                recommendations.slice(0, 3).map((item) => (
                  <BlockStack gap="050" key={item.id}>
                    <Text as="p" variant="bodyMd" fontWeight="semibold">
                      {item.category.replaceAll("_", " ")}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {item.recommendationText}
                    </Text>
                  </BlockStack>
                ))
              ) : (
                <Text as="p" variant="bodySm" tone="subdued">
                  Recommendations appear after dispute outcomes are recorded.
                </Text>
              )}
            </BlockStack>
          </Card>
        </InlineGrid>

        <Card>
          <BlockStack gap="200">
            <InlineStack align="space-between">
              <Text as="h2" variant="headingMd">
                Recent disputes
              </Text>
              <Link className="table-link" href={"/disputes" as never}>
                View all disputes
              </Link>
            </InlineStack>
            {recentDisputes.length > 0 ? (
              <IndexTable
                headings={[
                  { title: "Dispute" },
                  { title: "Reason" },
                  { title: "Status" },
                  { title: "Due" },
                  { title: "Amount" }
                ]}
                itemCount={recentDisputes.length}
                selectable={false}
              >
                {recentDisputes.slice(0, 6).map((dispute, index) => (
                  <IndexTable.Row id={dispute.id} key={dispute.id} position={index}>
                    <IndexTable.Cell>
                      <Link className="table-link" href={`/disputes/${dispute.id}` as never}>
                        {dispute.shopifyDisputeId.split("/").pop()}
                      </Link>
                    </IndexTable.Cell>
                    <IndexTable.Cell>{(dispute.reason ?? "Unknown").replaceAll("_", " ")}</IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge tone={toneForStatus(dispute.status)}>{dispute.status.replaceAll("_", " ")}</Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      {dispute.evidenceDueBy
                        ? new Date(dispute.evidenceDueBy).toLocaleDateString()
                        : "No deadline"}
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      {dispute.currencyCode ?? "USD"} {dispute.amount}
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            ) : (
              <EmptyState
                heading="No disputes yet"
                action={{ content: "Sync disputes", url: "/disputes" }}
                image=""
              >
                <p>Once disputes are synced, the overview will highlight what needs attention first.</p>
              </EmptyState>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
