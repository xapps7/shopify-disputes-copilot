"use client";

import Link from "next/link";
import { Badge, BlockStack, Box, EmptyState, IndexFilters, IndexTable, Text, useSetIndexFiltersMode } from "@shopify/polaris";

import { AdminPageLayout } from "@/components/admin-page-layout";
import { ResourceSection } from "@/components/resource-section";
import type { EvidenceLibraryItemView } from "@/lib/types";

type EvidenceLibraryPageShellProps = {
  items: EvidenceLibraryItemView[];
};

export function EvidenceLibraryPageShell({ items }: EvidenceLibraryPageShellProps) {
  const { mode, setMode } = useSetIndexFiltersMode();

  return (
    <AdminPageLayout
      title="Evidence library"
      subtitle="Search and organize uploaded files across disputes."
      primaryAction={{ content: "View disputes", url: "/disputes" }}
      gap="300"
    >
      <ResourceSection title="Evidence files" flush>
        <IndexFilters
          tabs={[
            { id: "all", content: "All files" },
            { id: "communication", content: "Communication" },
            { id: "refunds", content: "Refund proof" },
            { id: "fulfillment", content: "Fulfillment" }
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
          queryPlaceholder="Search files"
          onQueryChange={() => {}}
          onQueryClear={() => {}}
        />
        {items.length > 0 ? (
          <IndexTable
            headings={[
              { title: "File" },
              { title: "Category" },
              { title: "Dispute" },
              { title: "Source" },
              { title: "Added" }
            ]}
            itemCount={items.length}
            selectable={false}
          >
            {items.map((item, index) => (
              <IndexTable.Row id={item.id} key={item.id} position={index}>
                <IndexTable.Cell>
                  {item.fileUrl ? (
                    <a className="table-link" href={item.fileUrl} target="_blank">
                      {item.title}
                    </a>
                  ) : (
                    item.title
                  )}
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Badge>{item.category.replaceAll("_", " ")}</Badge>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Link className="table-link" href={`/disputes/${item.disputeId}` as never}>
                    {item.disputeReference}
                  </Link>
                </IndexTable.Cell>
                <IndexTable.Cell>{item.sourceType}</IndexTable.Cell>
                <IndexTable.Cell>{new Date(item.createdAt).toLocaleDateString()}</IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
        ) : (
          <Box padding="400">
            <BlockStack gap="200">
              <EmptyState heading="No evidence files yet" image="">
                <p>Files attached to disputes will appear here for cross-case review and auditability.</p>
              </EmptyState>
              <Text as="p" variant="bodySm" tone="subdued">
                Evidence items are organized by category, source, and linked dispute.
              </Text>
            </BlockStack>
          </Box>
        )}
      </ResourceSection>
    </AdminPageLayout>
  );
}
