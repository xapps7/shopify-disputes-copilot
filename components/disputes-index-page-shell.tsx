"use client";

import Link from "next/link";
import {
  Badge,
  BlockStack,
  Card,
  EmptyState,
  IndexFilters,
  IndexTable,
  Page,
  Text,
  useSetIndexFiltersMode
} from "@shopify/polaris";

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

  return (
    <Page title="Disputes" subtitle="Review active disputes, deadlines, and evidence readiness.">
      <BlockStack gap="300">
        <Card padding="0">
          <IndexFilters
            tabs={[
              { id: "all", content: "All" },
              { id: "due-soon", content: "Due soon" },
              { id: "blocked", content: "Blocked" },
              { id: "ready", content: "Ready to review" }
            ]}
            selected={0}
            onSelect={() => {}}
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
          {disputes.length > 0 ? (
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
              itemCount={disputes.length}
              selectable={false}
            >
              {disputes.map((dispute, index) => (
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
                    {dispute.evidenceDueBy
                      ? new Date(dispute.evidenceDueBy).toLocaleDateString()
                      : "No deadline"}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {dispute.currencyCode ?? "USD"} {dispute.amount}
                  </IndexTable.Cell>
                  <IndexTable.Cell>{dispute.completenessScore}%</IndexTable.Cell>
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
    </Page>
  );
}
