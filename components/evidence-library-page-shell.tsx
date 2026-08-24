"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  InlineStack,
  EmptyState,
  IndexFilters,
  IndexTable,
  Text,
  useSetIndexFiltersMode
} from "@shopify/polaris";

import { AdminPageLayout } from "@/components/admin-page-layout";
import { EMPTY_STATE_IMAGE } from "@/components/empty-state-image";
import { EvidenceItemEditor } from "@/components/evidence-item-editor";
import { ResourceSection } from "@/components/resource-section";
import { StandingDocuments } from "@/components/standing-documents";
import type { LibraryDocument } from "@/lib/documents/library";
import { filterEvidenceItems } from "@/lib/disputes/workflow";
import { formatDate } from "@/lib/format/date";
import type { DisputeOptionView, EvidenceLibraryItemView } from "@/lib/types";

type EvidenceLibraryPageShellProps = {
  items: EvidenceLibraryItemView[];
  disputeOptions: DisputeOptionView[];
  standingDocuments: LibraryDocument[];
  refundPolicyStatement: string;
  cancellationPolicyStatement: string;
};

export function EvidenceLibraryPageShell({
  items,
  disputeOptions,
  standingDocuments,
  refundPolicyStatement,
  cancellationPolicyStatement
}: EvidenceLibraryPageShellProps) {
  const { mode, setMode } = useSetIndexFiltersMode();
  const searchParams = useSearchParams();
  const [selectedTab, setSelectedTab] = useState(0);
  const [queryValue, setQueryValue] = useState("");
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const filteredItems = useMemo(() => filterEvidenceItems(items, selectedTab, queryValue), [items, queryValue, selectedTab]);
  const editingItem = items.find((item) => item.id === editingItemId) ?? null;
  const embeddedQuery = searchParams.toString();
  const disputesUrl = `/disputes${embeddedQuery ? `?${embeddedQuery}` : ""}`;

  return (
    <AdminPageLayout
      title="Evidence library"
      subtitle="The documents you keep on file for every dispute, and every file attached to an individual one."
      // "View disputes" was the primary action here: navigation dressed up as a
      // page action, in the slot reserved for the most useful thing you can DO.
      // Going back to the parent is a backAction.
      backAction={{ content: "Disputes", url: "/disputes" }}
      gap="300"
    >
      {/*
        The "when to use this" paragraph moved below the table. Someone who
        opened the evidence library is already looking for a file; the guidance
        matters to the person who arrived by accident, and they can read it
        after the thing they came for.
      */}
      {/*
        Standing documents come FIRST. They are the only thing on this page a
        merchant can act on before a dispute exists, and doing so is what makes
        the next dispute quick. The per-dispute list below is a lookup, not a
        task.
      */}
      <StandingDocuments
        cancellationPolicyStatement={cancellationPolicyStatement}
        documents={standingDocuments}
        refundPolicyStatement={refundPolicyStatement}
      />

      <ResourceSection
        title="Files attached to a dispute"
        description="Uploaded against one case. Each one stays with the dispute it belongs to."
        flush
      >
        <IndexFilters
          tabs={[
            { id: "all", content: "All files" },
            { id: "communication", content: "Communication" },
            { id: "refunds", content: "Refund proof" },
            { id: "fulfillment", content: "Fulfillment" }
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
          queryValue={queryValue}
          queryPlaceholder="Search files"
          onQueryChange={setQueryValue}
          onQueryClear={() => setQueryValue("")}
        />
        {filteredItems.length > 0 ? (
          <IndexTable
            headings={[
              { title: "File" },
              { title: "Category" },
              { title: "Dispute" },
              { title: "Source" },
              { title: "Added" }
            ]}
            itemCount={filteredItems.length}
            selectable={false}
          >
            {filteredItems.map((item, index) => (
              <IndexTable.Row id={item.id} key={item.id} position={index}>
                <IndexTable.Cell>
                  <BlockStack gap="100">
                    <Text as="p" variant="bodyMd" fontWeight="medium">
                      {item.title}
                    </Text>
                    <InlineStack gap="200" wrap>
                      {/*
                        Never the stored value. Since files moved to S3 the
                        column holds an `s3://` reference, which a browser
                        cannot open - this link went dead the day storage was
                        switched on. The authenticated route resolves it to a
                        short-lived signed URL and checks the file belongs to
                        this shop first.
                      */}
                      {item.fileUrl ? (
                        <Button
                          url={`/api/evidence/${item.id}/file`}
                          target="_blank"
                          size="micro"
                          variant="plain"
                        >
                          Open file
                        </Button>
                      ) : null}
                      <Button onClick={() => setEditingItemId(item.id)} size="micro" variant="plain">
                        Edit details
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Badge>{item.category.replaceAll("_", " ")}</Badge>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Link
                    className="table-link"
                    href={`/disputes/${item.disputeId}${embeddedQuery ? `?${embeddedQuery}` : ""}` as never}
                  >
                    {item.disputeReference}
                  </Link>
                </IndexTable.Cell>
                <IndexTable.Cell>{item.sourceType}</IndexTable.Cell>
                <IndexTable.Cell>{formatDate(item.createdAt)}</IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
        ) : (
          <Box padding="400">
            <BlockStack gap="200">
              {items.length === 0 ? (
                <EmptyState
                  heading="No evidence files yet"
                  image={EMPTY_STATE_IMAGE}
                  action={{ content: "View disputes", url: disputesUrl }}
                >
                  <p>
                    Files you upload on a dispute appear here. For the documents that are the same on every dispute,
                    use the section above instead.
                  </p>
                </EmptyState>
              ) : (
                <EmptyState
                  heading="No evidence files match this view"
                  image={EMPTY_STATE_IMAGE}
                  action={
                    queryValue
                      ? { content: "Clear search", onAction: () => setQueryValue("") }
                      : { content: "Show all files", onAction: () => setSelectedTab(0) }
                  }
                >
                  <p>
                    {`${items.length} file${items.length === 1 ? " is" : "s are"} stored, but none match the current category or search.`}
                  </p>
                </EmptyState>
              )}
            </BlockStack>
          </Box>
        )}
      </ResourceSection>

      <Text as="p" variant="bodySm" tone="subdued">
        Looking for one case rather than one file? Start in <strong>Disputes</strong>.
      </Text>

      <EvidenceItemEditor
        item={editingItem}
        disputeOptions={disputeOptions}
        open={Boolean(editingItem)}
        onClose={() => setEditingItemId(null)}
      />
    </AdminPageLayout>
  );
}
