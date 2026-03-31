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
import { InfoHint } from "@/components/info-hint";
import { OutcomeReviewForm } from "@/components/outcome-review-form";
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
                <BlockStack gap="100">
                  <InlineStack gap="200" blockAlign="center">
                    <Badge tone={dispute.status.includes("WARNING") ? "warning" : "info"}>
                      {dispute.status.replaceAll("_", " ")}
                    </Badge>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {dispute.latestPacket
                        ? `Packet v${dispute.latestPacket.version} ${dispute.latestPacket.status.toLowerCase()}`
                        : "Packet not drafted yet"}
                    </Text>
                  </InlineStack>
                  <Text as="h2" variant="headingMd">
                    What matters on this case
                  </Text>
                  <Text as="p" variant="bodyMd">
                    {dispute.reasonDetails ?? "No reason details available yet."}
                  </Text>
                </BlockStack>

                <InlineGrid columns={{ xs: 1, md: 3 }} gap="300">
                  <Box background="bg-surface-secondary" borderRadius="300" padding="300">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" tone="subdued">
                        Readiness
                      </Text>
                      <Text as="p" variant="headingMd">
                        {readinessScore}%
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {readyEvidence} of {dispute.evidenceChecklist.length} categories ready
                      </Text>
                    </BlockStack>
                  </Box>
                  <Box background="bg-surface-secondary" borderRadius="300" padding="300">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" tone="subdued">
                        Amount at risk
                      </Text>
                      <Text as="p" variant="headingMd">
                        {dispute.currencyCode ?? "USD"} {dispute.amount}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Keep the reply tightly tied to evidence, not claims.
                      </Text>
                    </BlockStack>
                  </Box>
                  <Box background="bg-surface-secondary" borderRadius="300" padding="300">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" tone="subdued">
                        Recommended next step
                      </Text>
                      <Text as="p" variant="bodyMd" fontWeight="medium">
                        {readinessScore < 70 ? "Collect evidence first" : "Review narrative and packet"}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        The page is structured in that exact order below.
                      </Text>
                    </BlockStack>
                  </Box>
                </InlineGrid>

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
                  What is missing
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
                <Text as="p" variant="bodySm" tone="subdued">
                  This is the source record set the merchant reply and packet are built from.
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
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">
                    Next step
                  </Text>
                  <Badge tone={readinessScore < 70 ? "warning" : "success"}>
                    {readinessScore < 70 ? "Collect proof" : "Review reply"}
                  </Badge>
                </InlineStack>
                <Text as="p" variant="bodyMd" tone="subdued">
                  {readinessScore < 70
                    ? "Do not spend time polishing the merchant narrative yet. Add the missing evidence first."
                    : "The evidence shelf is strong enough that the operator should now validate the reply and packet quality."}
                </Text>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="200">
                <InlineStack gap="100" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Add missing proof
                  </Text>
                  <InfoHint content="Use this when the checklist still shows gaps or a key support file is absent." />
                </InlineStack>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Add the missing items first if readiness is still low.
                </Text>
                <EvidenceUploadForm disputeId={dispute.id} />
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="200">
                <InlineStack gap="100" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Build and export packet
                  </Text>
                  <InfoHint content="This assembles the current evidence shelf and merchant settings into the latest draft packet." />
                </InlineStack>
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

            <OutcomeReviewForm
              currentStatus={dispute.status}
              disputeId={dispute.id}
              recommendations={dispute.recommendations}
            />
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
