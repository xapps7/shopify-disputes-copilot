"use client";

import Link from "next/link";
import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Banner,
  Badge,
  BlockStack,
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
      title="Overview"
      subtitle="Start with urgent disputes, then work through evidence and packet readiness."
      primaryAction={{ content: "View disputes", url: "/disputes" }}
      secondaryActions={[
        { content: "Open evidence library", url: "/evidence" },
        { content: "Sync disputes", onAction: handleSync, loading: isSyncing }
      ]}
    >
      <BlockStack gap="400">
        {metrics.dueSoon > 0 ? (
          <Banner tone="warning">
            <p>{metrics.dueSoon} disputes are due within 48 hours. Review deadlines before editing response narratives.</p>
          </Banner>
        ) : null}

        {syncMessage ? (
          <Text as="p" tone="subdued" variant="bodySm">
            {syncMessage}
          </Text>
        ) : null}

        <Card>
          <BlockStack gap="300">
            <Text as="p" variant="bodyMd" tone="subdued">
              Overview
            </Text>
            <Text as="h2" variant="heading2xl">
              {metrics.openDisputes} open disputes
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              Review due dates first, then complete missing evidence before refining merchant replies.
            </Text>
            <Divider />
            <BlockStack gap="150">
              <Text as="h3" variant="headingSm">
                Attention needed
              </Text>
              <InlineStack align="space-between">
                <Text as="p" variant="bodyMd" fontWeight="medium">
                  Disputes due within 48 hours
                </Text>
                <Badge tone={metrics.dueSoon > 0 ? "warning" : "success"}>{String(metrics.dueSoon)}</Badge>
              </InlineStack>
              <Divider />
              <InlineStack align="space-between">
                <Text as="p" variant="bodyMd" fontWeight="medium">
                  Evidence-ready cases
                </Text>
                <Badge tone="info">{String(metrics.evidenceReady)}</Badge>
              </InlineStack>
              <Divider />
              <InlineStack align="space-between">
                <Text as="p" variant="bodyMd" fontWeight="medium">
                  Open disputes
                </Text>
                <Text as="p" variant="bodyMd">
                  {metrics.openDisputes}
                </Text>
              </InlineStack>
            </BlockStack>
            <Divider />
            <InlineStack gap="600" wrap>
              {[
                ["Due soon", String(metrics.dueSoon)],
                ["Evidence ready", String(metrics.evidenceReady)],
                ["Total disputed", `$${metrics.totalAmount.toFixed(0)}`]
              ].map(([label, value]) => (
                <BlockStack gap="050" key={label}>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {label}
                  </Text>
                  <Text as="p" variant="headingMd">
                    {value}
                  </Text>
                </BlockStack>
              ))}
            </InlineStack>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              Prevention insights
            </Text>
            {recommendations.length > 0 ? (
              <BlockStack gap="200">
                {recommendations.slice(0, 3).map((item, index) => (
                  <BlockStack gap="050" key={item.id}>
                    <Text as="p" variant="bodyMd" fontWeight="semibold">
                      {item.category.replaceAll("_", " ")}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {item.recommendationText}
                    </Text>
                    {index < Math.min(recommendations.length, 3) - 1 ? <Divider /> : null}
                  </BlockStack>
                ))}
              </BlockStack>
            ) : (
              <Text as="p" variant="bodySm" tone="subdued">
                Recommendations appear after dispute outcomes are recorded.
              </Text>
            )}
          </BlockStack>
        </Card>

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
                  </IndexTable.Row>
                ))}
              </IndexTable>
            ) : (
              <EmptyState
                heading="No disputes yet"
                action={{ content: "Sync disputes", onAction: handleSync }}
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
