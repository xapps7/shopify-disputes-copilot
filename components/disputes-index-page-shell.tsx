"use client";

import Link from "next/link";
import { startTransition, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  BlockStack,
  Card,
  EmptyState,
  IndexFilters,
  IndexTable,
  Text,
  useSetIndexFiltersMode
} from "@shopify/polaris";

import { AdminPageLayout } from "@/components/admin-page-layout";
import type { DashboardDispute } from "@/lib/types";

type DisputesIndexPageShellProps = {
  disputes: DashboardDispute[];
};

function toneForStatus(status: string) {
  if (status.includes("WARNING") || status === "NEEDS_RESPONSE") return "warning" as const;
  if (status === "UNDER_REVIEW") return "info" as const;
  if (status === "WON") return "success" as const;
  if (status === "LOST" || status === "ACCEPTED") return "critical" as const;
  return undefined;
}

export function DisputesIndexPageShell({ disputes }: DisputesIndexPageShellProps) {
  const { mode, setMode } = useSetIndexFiltersMode();
  const router = useRouter();
  const [selectedTab, setSelectedTab] = useState(0);
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

  const filteredDisputes = useMemo(() => {
    switch (selectedTab) {
      case 1:
        return disputes.filter((dispute) => {
          if (!dispute.evidenceDueBy) return false;
          return new Date(dispute.evidenceDueBy).getTime() - Date.now() <= 172800000;
        });
      case 2:
        return disputes.filter((dispute) =>
          ["NEEDS_RESPONSE", "WARNING_NEEDS_RESPONSE"].includes(dispute.status)
        );
      case 3:
        return disputes.filter((dispute) => dispute.status === "UNDER_REVIEW");
      default:
        return disputes;
    }
  }, [disputes, selectedTab]);

  return (
    <AdminPageLayout
      title="Disputes"
      subtitle="Review active disputes, deadlines, and evidence readiness."
      primaryAction={{ content: "Sync disputes", onAction: handleSync, loading: isSyncing }}
      secondaryActions={[{ content: "Open evidence library", url: "/evidence" }]}
      gap="300"
    >
      <BlockStack gap="300">
        {syncMessage ? (
          <Text as="p" variant="bodySm" tone="subdued">
            {syncMessage}
          </Text>
        ) : null}
        <Card padding="0">
          <IndexFilters
            tabs={[
              { id: "all", content: "All" },
              { id: "due-soon", content: "Due soon" },
              { id: "needs-response", content: "Needs response" },
              { id: "under-review", content: "Under review" }
            ]}
            selected={selectedTab}
            onSelect={setSelectedTab}
            canCreateNewView={false}
            cancelAction={{ onAction: () => {}, disabled: true, loading: false }}
            filters={[]}
            appliedFilters={[]}
            onClearAll={() => {}}
            mode={mode}
            setMode={setMode}
            queryValue=""
            queryPlaceholder="Search disputes"
            onQueryChange={() => {}}
            onQueryClear={() => {}}
          />
          {filteredDisputes.length > 0 ? (
            <IndexTable
              headings={[
                { title: "Dispute" },
                { title: "Order" },
                { title: "Reason" },
                { title: "Status" },
                { title: "Due" },
                { title: "Amount" },
                { title: "Readiness" }
              ]}
              itemCount={filteredDisputes.length}
              selectable={false}
            >
              {filteredDisputes.map((dispute, index) => (
                <IndexTable.Row id={dispute.id} key={dispute.id} position={index}>
                  <IndexTable.Cell>
                    <Link className="table-link" href={`/disputes/${dispute.id}` as never}>
                      {dispute.shopifyDisputeId.split("/").pop()}
                    </Link>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {dispute.shopifyOrderId?.split("/").pop() ?? "Unavailable"}
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
                  <IndexTable.Cell>
                    <Badge tone={dispute.completenessScore >= 75 ? "success" : dispute.completenessScore >= 50 ? "warning" : "critical"}>
                      {`${dispute.completenessScore}%`}
                    </Badge>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          ) : (
            <EmptyState heading="No disputes available" image="">
              <p>Sync disputes to populate the operating queue.</p>
            </EmptyState>
          )}
        </Card>
      </BlockStack>
    </AdminPageLayout>
  );
}
