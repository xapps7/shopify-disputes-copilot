"use client";

import Link from "next/link";
import { Badge, BlockStack, Card, EmptyState, IndexTable, Page, Text } from "@shopify/polaris";

import type { EvidenceLibraryItemView } from "@/lib/types";

type EvidenceLibraryPageShellProps = {
  items: EvidenceLibraryItemView[];
};

export function EvidenceLibraryPageShell({ items }: EvidenceLibraryPageShellProps) {
  return (
    <Page title="Evidence Library" subtitle="Search and organize evidence across disputes.">
      <Card>
        <BlockStack gap="200">
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
            <EmptyState heading="No evidence files yet" image="">
              <p>Files attached to disputes will appear here for cross-case review and auditability.</p>
            </EmptyState>
          )}
          <Text as="p" variant="bodySm" tone="subdued">
            Evidence items are organized by category, source, and linked dispute.
          </Text>
        </BlockStack>
      </Card>
    </Page>
  );
}
