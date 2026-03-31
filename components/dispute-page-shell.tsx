"use client";

import {
  Badge,
  BlockStack,
  Box,
  Card,
  InlineGrid,
  InlineStack,
  Layout,
  Page,
  Text
} from "@shopify/polaris";

import { DisputeResponseDraft } from "@/components/dispute-response-draft";
import { EvidenceUploadForm } from "@/components/evidence-upload-form";
import { GeneratePacketButton } from "@/components/generate-packet-button";
import { PacketPreview } from "@/components/packet-preview";
import type { DisputeDetailView, DisputeResponseDraftView } from "@/lib/types";

type DisputePageShellProps = {
  dispute: DisputeDetailView;
  readinessScore: number;
  readyEvidence: number;
  responseDraft: DisputeResponseDraftView;
};

export function DisputePageShell({
  dispute,
  readinessScore,
  readyEvidence,
  responseDraft
}: DisputePageShellProps) {
  return (
    <Page
      title={`Dispute ${dispute.shopifyDisputeId.split("/").pop()}`}
      subtitle={`${(dispute.reason ?? "Unknown").replaceAll("_", " ")} · ${dispute.currencyCode ?? "USD"} ${dispute.amount}`}
      backAction={{ content: "Dashboard", url: "/dashboard" }}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="400">
                <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
                  <Box background="bg-surface-secondary" borderRadius="300" padding="400">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" tone="subdued">
                        Status
                      </Text>
                      <Badge tone={dispute.status.includes("WARNING") ? "warning" : "info"}>
                        {dispute.status.replaceAll("_", " ")}
                      </Badge>
                    </BlockStack>
                  </Box>
                  <Box background="bg-surface-secondary" borderRadius="300" padding="400">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" tone="subdued">
                        Checklist coverage
                      </Text>
                      <Text as="p" variant="headingLg">
                        {readinessScore}%
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {readyEvidence} of {dispute.evidenceChecklist.length} categories ready
                      </Text>
                    </BlockStack>
                  </Box>
                  <Box background="bg-surface-secondary" borderRadius="300" padding="400">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" tone="subdued">
                        Packet state
                      </Text>
                      <Text as="p" variant="headingMd">
                        {dispute.latestPacket?.status ?? "Not drafted"}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {dispute.latestPacket
                          ? `Version ${dispute.latestPacket.version} ready for review`
                          : "Generate after reviewing evidence"}
                      </Text>
                    </BlockStack>
                  </Box>
                </InlineGrid>

                <Text as="p" variant="bodyMd">
                  {dispute.reasonDetails ?? "No reason details available yet."}
                </Text>

                {dispute.orderSummary ? (
                  <InlineGrid columns={{ xs: 1, md: 2 }} gap="300">
                    {[
                      ["Order", dispute.orderSummary.orderName ?? "Unknown"],
                      ["Customer", dispute.orderSummary.customerName ?? "Unknown"],
                      ["Email", dispute.orderSummary.customerEmail ?? "Unknown"],
                      ["Fulfillment", dispute.orderSummary.fulfillmentStatus ?? "Unknown"]
                    ].map(([label, value]) => (
                      <Box background="bg-surface-secondary" borderRadius="300" key={label} padding="300">
                        <BlockStack gap="100">
                          <Text as="p" variant="bodySm" tone="subdued">
                            {label}
                          </Text>
                          <Text as="p" variant="bodyMd" fontWeight="medium">
                            {value}
                          </Text>
                        </BlockStack>
                      </Box>
                    ))}
                  </InlineGrid>
                ) : null}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Evidence checklist
                </Text>
                <div className="checklist-grid">
                  {dispute.evidenceChecklist.map((item) => (
                    <div className={`checklist-item checklist-item-${item.state}`} key={item.label}>
                      <div>
                        <span>{item.label}</span>
                        <p className="checklist-caption">
                          {item.state === "ready"
                            ? "Captured in the evidence shelf and ready for packet assembly."
                            : "Still missing from the current record set."}
                        </p>
                      </div>
                      <Badge tone={item.state === "ready" ? "success" : "warning"}>
                        {item.state === "ready" ? "Ready" : "Missing"}
                      </Badge>
                    </div>
                  ))}
                </div>
              </BlockStack>
            </Card>

            <DisputeResponseDraft disputeId={dispute.id} initialDraft={responseDraft} />
            <PacketPreview latestPacket={dispute.latestPacket} />

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Evidence library
                </Text>
                <div className="evidence-library-grid">
                  {dispute.evidenceItems.map((item) => (
                    <div key={item.id} className="evidence-card">
                      <BlockStack gap="150">
                        <InlineStack align="space-between">
                          <Badge>{item.category.replaceAll("_", " ")}</Badge>
                          <Text as="span" variant="bodySm" tone="subdued">
                            {item.sourceType}
                          </Text>
                        </InlineStack>
                        <Text as="h3" variant="headingSm">
                          {item.title}
                        </Text>
                        <Text as="p" variant="bodyMd" tone="subdued">
                          {item.description ?? "No description provided."}
                        </Text>
                        {item.fileUrl ? (
                          <a className="table-link" href={item.fileUrl} rel="noreferrer" target="_blank">
                            Open file
                          </a>
                        ) : null}
                      </BlockStack>
                    </div>
                  ))}
                </div>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  Add merchant evidence
                </Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Attach files or notes that close missing checklist categories.
                </Text>
                <EvidenceUploadForm disputeId={dispute.id} />
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  Packet draft
                </Text>
                <GeneratePacketButton disputeId={dispute.id} />
                {dispute.latestPacket ? (
                  <BlockStack gap="100">
                    <Text as="p" variant="bodySm" tone="subdued">
                      Version {dispute.latestPacket.version}
                    </Text>
                    {dispute.latestPacket.pdfUrl ? (
                      <a className="table-link" href={dispute.latestPacket.pdfUrl} target="_blank">
                        Open exported draft
                      </a>
                    ) : null}
                  </BlockStack>
                ) : (
                  <Text as="p" variant="bodyMd" tone="subdued">
                    No packet generated yet.
                  </Text>
                )}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  Timeline
                </Text>
                <div className="timeline-list">
                  {dispute.timeline.map((event) => (
                    <div key={event.id} className="timeline-item">
                      <Text as="p" variant="bodyMd" fontWeight="medium">
                        {event.eventType.replaceAll("_", " ")}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {new Date(event.eventTimestamp).toLocaleString()}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {event.source}
                      </Text>
                    </div>
                  ))}
                </div>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
