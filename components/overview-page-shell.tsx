"use client";

import Link from "next/link";
import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Banner,
  Badge,
  BlockStack,
  Box,
  Card,
  Divider,
  EmptyState,
  IndexTable,
  InlineStack,
  Page,
  Text
} from "@shopify/polaris";

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
  const router = useRouter();
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  async function handleSync() {
    setIsSyncing(true);
    setSyncMessage(null);

    const response = await fetch("/api/sync/disputes", { method: "POST" });
    const payload = (await response.json().catch(() => null)) as
      | { synced?: number; message?: string }
      | null;

    setSyncMessage(
      response.ok ? `Synced ${payload?.synced ?? 0} disputes.` : (payload?.message ?? "Sync failed.")
    );

    if (response.ok) {
      startTransition(() => {
        router.refresh();
      });
    }

    setIsSyncing(false);
  }

  return (
    <Page
      fullWidth
      title="Disputes Co-Pilot"
      subtitle="Workflow entry point for active Shopify Payments disputes."
      primaryAction={{ content: "View disputes", url: "/disputes" }}
      secondaryActions={[
        { content: "Open evidence library", url: "/evidence" },
        { content: isSyncing ? "Syncing disputes..." : "Sync disputes", onAction: handleSync, disabled: isSyncing }
      ]}
    >
      <BlockStack gap="400">
        {metrics.dueSoon > 0 ? (
          <Banner tone="critical">
            <p>{metrics.dueSoon} disputes require response within 48 hours.</p>
          </Banner>
        ) : null}

        <BlockStack gap="100">
          <Text as="p" variant="bodyMd">
            Start with urgent disputes, then complete missing evidence.
          </Text>
          {syncMessage ? (
            <Text as="p" tone="subdued" variant="bodySm">
              {syncMessage}
            </Text>
          ) : null}
        </BlockStack>

        <InlineStack gap="600" wrap>
          {[
            ["Open disputes", String(metrics.openDisputes)],
            ["Due soon", String(metrics.dueSoon)],
            ["Evidence ready", String(metrics.evidenceReady)],
            ["Total disputed", `$${metrics.totalAmount.toFixed(0)}`]
          ].map(([label, value]) => (
            <InlineStack gap="100" key={label}>
              <Text as="span" variant="bodySm" tone="subdued">
                {`${label}:`}
              </Text>
              <Text as="span" variant="bodyMd" fontWeight="medium">
                {value}
              </Text>
            </InlineStack>
          ))}
        </InlineStack>

        <BlockStack gap="200">
          <Text as="h2" variant="headingMd">
            Attention needed
          </Text>
          <BlockStack gap="150">
            <InlineStack align="space-between">
              <Link className="table-link" href={"/disputes" as never}>
                Disputes due within 48 hours
              </Link>
              <Badge tone={metrics.dueSoon > 0 ? "critical" : "success"}>{String(metrics.dueSoon)}</Badge>
            </InlineStack>
            <Divider />
            <InlineStack align="space-between">
              <Link className="table-link" href={"/disputes" as never}>
                Evidence-ready cases
              </Link>
              <Badge tone="info">{String(metrics.evidenceReady)}</Badge>
            </InlineStack>
            <Divider />
            <InlineStack align="space-between">
              <Link className="table-link" href={"/disputes" as never}>
                Missing evidence cases
              </Link>
              <Badge tone={metrics.openDisputes - metrics.evidenceReady > 0 ? "warning" : "success"}>
                {String(Math.max(metrics.openDisputes - metrics.evidenceReady, 0))}
              </Badge>
            </InlineStack>
          </BlockStack>
        </BlockStack>

        <BlockStack gap="200">
          <InlineStack align="space-between">
            <Text as="h2" variant="headingMd">
              Recent disputes
            </Text>
            <Link className="table-link" href={"/disputes" as never}>
              View all disputes
            </Link>
          </InlineStack>
          <Card padding="0">
            {recentDisputes.length > 0 ? (
              <IndexTable
                headings={[
                  { title: "Dispute" },
                  { title: "Order" },
                  { title: "Reason" },
                  { title: "Status" },
                  { title: "Due date" },
                  { title: "Amount" },
                  { title: "Readiness" }
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
                    <IndexTable.Cell>{dispute.shopifyOrderId?.split("/").pop() ?? "Unavailable"}</IndexTable.Cell>
                    <IndexTable.Cell>{(dispute.reason ?? "Unknown").replaceAll("_", " ")}</IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge tone={toneForStatus(dispute.status)}>{dispute.status.replaceAll("_", " ")}</Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      {dispute.evidenceDueBy ? (
                        <Badge tone={new Date(dispute.evidenceDueBy).getTime() - Date.now() <= 172800000 ? "critical" : "info"}>
                          {new Date(dispute.evidenceDueBy).toLocaleDateString()}
                        </Badge>
                      ) : (
                        "No deadline"
                      )}
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      {dispute.currencyCode ?? "USD"} {dispute.amount}
                    </IndexTable.Cell>
                    <IndexTable.Cell>{`${dispute.completenessScore}%`}</IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            ) : (
              <Box padding="400">
                <EmptyState
                  heading="No disputes yet"
                  action={{ content: "Sync disputes", onAction: handleSync }}
                  image=""
                >
                  <p>Once disputes are synced, the overview will highlight what needs attention first.</p>
                </EmptyState>
              </Box>
            )}
          </Card>
        </BlockStack>

        <BlockStack gap="150">
          <Text as="h2" variant="headingMd">
            Prevention insights
          </Text>
          {recommendations.length > 0 ? (
            recommendations.slice(0, 2).map((item, index) => (
              <Box key={item.id}>
                <BlockStack gap="050">
                  <Text as="p" variant="bodyMd" fontWeight="semibold">
                    {item.category.replaceAll("_", " ")}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {item.recommendationText}
                  </Text>
                </BlockStack>
                {index < Math.min(recommendations.length, 2) - 1 ? <Divider /> : null}
              </Box>
            ))
          ) : (
            <Text as="p" variant="bodySm" tone="subdued">
              Recommendations appear after dispute outcomes are recorded.
            </Text>
          )}
        </BlockStack>
      </BlockStack>
    </Page>
  );
}
