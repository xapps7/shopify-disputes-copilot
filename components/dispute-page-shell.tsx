"use client";

import Link from "next/link";
import {
  Banner,
  Badge,
  BlockStack,
  Card,
  DataTable,
  Divider,
  InlineStack,
  Layout,
  Page,
  ProgressBar,
  Text
} from "@shopify/polaris";
import { useState } from "react";

import { DisputeResponseDraft } from "@/components/dispute-response-draft";
import { EvidenceGapCoach } from "@/components/evidence-gap-coach";
import { EvidenceUploadForm } from "@/components/evidence-upload-form";
import { GeneratePacketButton } from "@/components/generate-packet-button";
import { OutcomeReviewForm } from "@/components/outcome-review-form";
import { PacketQualityPanel } from "@/components/packet-quality-panel";
import { SubmissionCenter } from "@/components/submission-center";
import { assessPacketQuality, buildEvidenceGapInsights } from "@/lib/disputes/workflow";
import type { DisputeDetailView, DisputeResponseDraftView } from "@/lib/types";

type DisputePageShellProps = {
  dispute: DisputeDetailView;
  readinessScore: number;
  readyEvidence: number;
  responseDraft: DisputeResponseDraftView;
};

function statusTone(status: string) {
  if (status.includes("WARNING") || status === "NEEDS_RESPONSE") return "warning" as const;
  if (status === "WON") return "success" as const;
  if (status === "LOST" || status === "ACCEPTED") return "critical" as const;
  return "info" as const;
}

function deadlineTone(evidenceDueBy: string | null) {
  if (!evidenceDueBy) return "info" as const;
  const days = Math.ceil((new Date(evidenceDueBy).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (days < 0) return "critical" as const;
  if (days <= 2) return "warning" as const;
  return "info" as const;
}

function nextStep(readinessScore: number) {
  if (readinessScore < 60) {
    return {
      title: "Collect evidence before editing the reply",
      detail: "The record is still missing key proof. Close the checklist gaps first so the merchant narrative can stay factual.",
      tone: "warning" as const
    };
  }

  if (readinessScore < 100) {
    return {
      title: "Review the packet and confirm the narrative",
      detail: "Most required proof is present. Validate how the packet explains the facts and fill any remaining weaker areas.",
      tone: "info" as const
    };
  }

  return {
    title: "Prepare for submission",
    detail: "The packet is evidence-complete. Finalize the merchant response and choose the submission path.",
    tone: "success" as const
  };
}

function categoryLabel(category: string) {
  return category.replaceAll("_", " ").toLowerCase();
}

export function DisputePageShell({
  dispute,
  readinessScore,
  readyEvidence,
  responseDraft
}: DisputePageShellProps) {
  const actionGuidance = nextStep(readinessScore);
  const dueDateLabel = dispute.evidenceDueBy
    ? new Date(dispute.evidenceDueBy).toLocaleDateString()
    : "No deadline";
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const gapInsights = buildEvidenceGapInsights(dispute);
  const packetReview = assessPacketQuality(dispute);
  const evidenceByCategory = dispute.evidenceItems.reduce<Record<string, DisputeDetailView["evidenceItems"]>>(
    (acc, item) => {
      acc[item.category] = [...(acc[item.category] ?? []), item];
      return acc;
    },
    {}
  );

  return (
    <Page
      fullWidth
      title={`Dispute ${dispute.shopifyDisputeId.split("/").pop()}`}
      subtitle={`${(dispute.reason ?? "Unknown").replaceAll("_", " ")} · ${dispute.currencyCode ?? "USD"} ${dispute.amount}`}
      backAction={{ content: "Disputes", url: "/disputes" }}
      primaryAction={{
        content: "Submit evidence",
        onAction: () => {
          setSubmitMessage(
            dispute.latestPacket
              ? "Use the submission center to record the merchant's manual submission after sending the packet in Shopify Admin."
              : "Generate a packet draft before submitting evidence."
          );
        }
      }}
      secondaryActions={[
        ...(dispute.latestPacket
          ? [
              {
                content: "Download packet",
                url: `/api/disputes/${dispute.id}/packet/download`,
                external: true
              }
            ]
          : [])
      ]}
    >
      <BlockStack gap="400">
        <Banner tone={actionGuidance.tone}>
          <p>{actionGuidance.detail}</p>
        </Banner>

        {submitMessage ? (
          <Banner tone="info">
            <p>{submitMessage}</p>
          </Banner>
        ) : null}

        {dispute.evidenceSentOn || dispute.latestPacket?.submittedAt ? (
          <Banner tone="success">
            <p>
              Submission has been detected on this dispute. The workspace is now tracking review and outcome updates from
              synced Shopify status changes.
            </p>
          </Banner>
        ) : null}

        <Layout>
          <Layout.Section>
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="start">
                    <BlockStack gap="150">
                      <InlineStack gap="200" blockAlign="center">
                        <Badge tone={statusTone(dispute.status)}>{dispute.status.replaceAll("_", " ")}</Badge>
                        <Badge tone={deadlineTone(dispute.evidenceDueBy)}>{`Due ${dueDateLabel}`}</Badge>
                      </InlineStack>
                      <Text as="h2" variant="headingMd">
                        Dispute summary
                      </Text>
                      <Text as="p" variant="bodyMd" tone="subdued">
                        {dispute.reasonDetails ?? "No additional issuer context is available yet."}
                      </Text>
                    </BlockStack>
                  </InlineStack>

                  <InlineStack gap="600" wrap>
                    {[
                      ["Amount", `${dispute.currencyCode ?? "USD"} ${dispute.amount}`],
                      ["Reason", (dispute.reason ?? "Unknown").replaceAll("_", " ")],
                      ["Order", dispute.orderSummary?.orderName ?? "Unknown"],
                      ["Readiness", `${readinessScore}%`]
                    ].map(([label, value]) => (
                      <BlockStack gap="050" key={label}>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {label}
                        </Text>
                        <Text as="p" variant="bodyMd" fontWeight="medium">
                          {value}
                        </Text>
                      </BlockStack>
                    ))}
                  </InlineStack>
                  <ProgressBar progress={readinessScore} tone={readinessScore < 60 ? "critical" : "primary"} />
                  <Text as="p" variant="bodySm" tone="subdued">
                    {readyEvidence} of {dispute.evidenceChecklist.length} required categories are ready.
                  </Text>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between">
                    <Text as="h2" variant="headingMd">
                      Evidence checklist
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Make this the first stop. Close missing rows before refining the final response.
                    </Text>
                  </InlineStack>

                  <BlockStack gap="200">
                    {dispute.evidenceChecklist.map((item, index) => (
                      <BlockStack gap="200" key={item.label}>
                        <InlineStack align="space-between" blockAlign="center">
                          <BlockStack gap="050">
                            <Text as="p" variant="bodyMd" fontWeight="medium">
                              {item.label}
                            </Text>
                            <Text as="p" variant="bodySm">
                              {item.whyItMatters}
                            </Text>
                            <Text as="p" variant="bodySm" tone="subdued">
                              <strong>How to get it:</strong> {item.howToGet}
                            </Text>
                            <Text as="p" variant="bodySm" tone="subdued">
                              <strong>Best source:</strong> {item.bestSource}
                            </Text>
                            <Text as="p" variant="bodySm" tone="subdued">
                              <strong>App help:</strong> {item.appSupport}
                            </Text>
                            {item.state === "ready" ? (
                              <BlockStack gap="050">
                                <Text as="p" variant="bodySm" tone="subdued">
                                  <strong>Attached evidence:</strong>
                                </Text>
                                {(evidenceByCategory[item.category] ?? []).length > 0 ? (
                                  <InlineStack gap="200" wrap>
                                    {(evidenceByCategory[item.category] ?? []).map((evidence) =>
                                      evidence.fileUrl ? (
                                        <a
                                          className="table-link"
                                          href={evidence.fileUrl}
                                          key={evidence.id}
                                          rel="noreferrer"
                                          target="_blank"
                                        >
                                          {evidence.title}
                                        </a>
                                      ) : (
                                        <Text as="span" key={evidence.id} variant="bodySm">
                                          {evidence.title}
                                        </Text>
                                      )
                                    )}
                                  </InlineStack>
                                ) : (
                                  <Text as="p" variant="bodySm" tone="subdued">
                                    This row is marked ready from the case record, but no standalone file is linked yet.
                                  </Text>
                                )}
                              </BlockStack>
                            ) : (
                              <Text as="p" variant="bodySm">
                                <strong>Next step:</strong> Upload this as <strong>{categoryLabel(item.category)}</strong> in
                                the <strong>Add evidence</strong> panel below, or link an existing file from the evidence
                                library.
                              </Text>
                            )}
                          </BlockStack>
                          <Badge tone={item.state === "ready" ? "success" : "warning"}>
                            {item.state === "ready" ? "Ready" : "Missing"}
                          </Badge>
                        </InlineStack>
                        {index < dispute.evidenceChecklist.length - 1 ? <Divider /> : null}
                      </BlockStack>
                    ))}
                  </BlockStack>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">
                      Evidence collection playbook
                    </Text>
                    <Badge tone={gapInsights.length > 0 ? "warning" : "success"}>
                      {gapInsights.length > 0 ? `${gapInsights.length} gaps` : "Covered"}
                    </Badge>
                  </InlineStack>
                  <EvidenceGapCoach gaps={gapInsights} />
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Timeline
                  </Text>
                  <BlockStack gap="200">
                    {dispute.timeline.map((event, index) => (
                      <BlockStack gap="100" key={event.id}>
                        <InlineStack align="space-between">
                          <Text as="p" variant="bodyMd" fontWeight="medium">
                            {event.eventType.replaceAll("_", " ")}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {new Date(event.eventTimestamp).toLocaleDateString()}
                          </Text>
                        </InlineStack>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {event.source}
                        </Text>
                        {index < dispute.timeline.length - 1 ? <Divider /> : null}
                      </BlockStack>
                    ))}
                  </BlockStack>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="050">
                      <Text as="h2" variant="headingMd">
                        Evidence files
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Review source files linked to this dispute.
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Use <strong>Disputes</strong> to work one case. Use <strong>Evidence library</strong> to reuse files across multiple disputes and keep an audit trail.
                      </Text>
                    </BlockStack>
                    <Link className="table-link" href={"/evidence" as never}>
                      Open evidence library
                    </Link>
                  </InlineStack>

                  <DataTable
                    columnContentTypes={["text", "text", "text"]}
                    headings={["File", "Category", "Source"]}
                    rows={dispute.evidenceItems.map((item) => [
                      item.fileUrl ? (
                        <a className="table-link" href={item.fileUrl} key={`${item.id}-link`} rel="noreferrer" target="_blank">
                          {item.title}
                        </a>
                      ) : (
                        item.title
                      ),
                      item.category.replaceAll("_", " "),
                      item.sourceType
                    ])}
                  />
                </BlockStack>
              </Card>

              <DisputeResponseDraft disputeId={dispute.id} initialDraft={responseDraft} />

              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Packet preview and submission
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Review the packet before export. If direct submission is unavailable, download the packet and submit it manually in Shopify Admin.
                  </Text>
                  <InlineStack gap="300" wrap>
                    <Link className="table-link" href={`/packets/${dispute.id}` as never}>
                      Open packet preview
                    </Link>
                    {dispute.latestPacket ? (
                      <a className="table-link" href={`/api/disputes/${dispute.id}/packet/download`} rel="noreferrer" target="_blank">
                        Download current packet
                      </a>
                    ) : null}
                  </InlineStack>
                  <GeneratePacketButton disputeId={dispute.id} />
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    Order summary
                  </Text>
                  <DataTable
                    columnContentTypes={["text", "text"]}
                    headings={["Field", "Value"]}
                    rows={[
                      ["Order", dispute.orderSummary?.orderName ?? "Unavailable"],
                      ["Customer", dispute.orderSummary?.customerName ?? "Unavailable"],
                      ["Email", dispute.orderSummary?.customerEmail ?? "Unavailable"]
                    ]}
                  />
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    Fulfillment
                  </Text>
                  <DataTable
                    columnContentTypes={["text", "text"]}
                    headings={["Field", "Value"]}
                    rows={[
                      ["Status", dispute.orderSummary?.fulfillmentStatus ?? "Unavailable"],
                      ["Delivery evidence", readyEvidence > 0 ? "Present in evidence record" : "Not yet linked"]
                    ]}
                  />
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    Payment and refunds
                  </Text>
                  <DataTable
                    columnContentTypes={["text", "text"]}
                    headings={["Field", "Value"]}
                    rows={[
                      ["Disputed amount", `${dispute.currencyCode ?? "USD"} ${dispute.amount}`],
                      ["Refund proof", dispute.evidenceItems.some((item) => item.category === "REFUND_PROOF") ? "Present" : "Not linked"],
                      ["Packet status", dispute.latestPacket?.status ?? "Not generated"]
                    ]}
                  />
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    Risk indicators
                  </Text>
                  <BlockStack gap="100">
                    <InlineStack align="space-between">
                      <Text as="p" variant="bodySm">
                        Missing evidence categories
                      </Text>
                      <Badge tone={readinessScore < 100 ? "warning" : "success"}>
                        {String(dispute.evidenceChecklist.length - readyEvidence)}
                      </Badge>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="p" variant="bodySm">
                        Deadline state
                      </Text>
                      <Badge tone={deadlineTone(dispute.evidenceDueBy)}>
                        {new Date(dispute.evidenceDueBy ?? Date.now()).getTime() - Date.now() <= 172800000 ? "Urgent" : "On track"}
                      </Badge>
                    </InlineStack>
                  </BlockStack>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    Add evidence
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Upload the file that closes the checklist gap. Choose the category that matches the missing checklist
                    row so the packet can place it correctly.
                  </Text>
                  <EvidenceUploadForm disputeId={dispute.id} />
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    Submission center
                  </Text>
                  <PacketQualityPanel review={packetReview} />
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    Record submission
                  </Text>
                  <SubmissionCenter
                    disputeId={dispute.id}
                    packetReady={packetReview.status !== "blocked" && Boolean(dispute.latestPacket)}
                    packetStatus={dispute.latestPacket?.status ?? null}
                    submittedAt={dispute.latestPacket?.submittedAt ?? null}
                    evidenceSentOn={dispute.evidenceSentOn}
                  />
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    Recommendations
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {dispute.recommendations.length > 0
                      ? dispute.recommendations[0].recommendationText
                      : "Recommendations appear after outcome review and tagging."}
                  </Text>
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
      </BlockStack>
    </Page>
  );
}
