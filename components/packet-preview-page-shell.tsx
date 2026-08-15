"use client";

import { useSearchParams } from "next/navigation";
import {
  Banner,
  BlockStack,
  Card,
  Divider,
  InlineGrid,
  InlineStack,
  List,
  Page,
  Text
} from "@shopify/polaris";

import { AIPackageAssessment } from "@/components/ai-package-assessment";
import { PacketQualityPanel } from "@/components/packet-quality-panel";
import { PacketSummaryEditor } from "@/components/packet-summary-editor";
import { ShopifySubmissionNotice } from "@/components/shopify-submission-notice";
import { useShopDomain } from "@/components/use-shop-domain";
import { generatePackageAssessment } from "@/lib/ai/package-assessment";
import { assessPacketQuality } from "@/lib/disputes/workflow";
import { formatMoney } from "@/lib/format/money";
import type { DisputeDetailView } from "@/lib/types";

type PacketPreviewPageShellProps = {
  dispute: DisputeDetailView;
};

function splitSections(summaryText: string | null) {
  if (!summaryText) {
    return [];
  }

  return summaryText
    .split("\n\n")
    .map((section) => section.trim())
    .filter(Boolean);
}

export function PacketPreviewPageShell({ dispute }: PacketPreviewPageShellProps) {
  const searchParams = useSearchParams();
  const shopDomain = useShopDomain();
  const sections = splitSections(dispute.latestPacket?.summaryText ?? null);
  const packetReview = assessPacketQuality(dispute);
  const aiAssessment = generatePackageAssessment(dispute);
  const embeddedQuery = searchParams.toString();
  const disputeUrl = `/disputes/${dispute.id}${embeddedQuery ? `?${embeddedQuery}` : ""}`;

  return (
    <Page
      fullWidth
      title="Packet preview"
      subtitle="Review the compiled evidence narrative before export or submission."
      backAction={{ content: "Back to dispute", url: disputeUrl }}
      primaryAction={
        dispute.latestPacket
          ? {
              content: "Open export",
              url: `/api/disputes/${dispute.id}/packet/download`,
              external: true
            }
          : undefined
      }
    >
      <BlockStack gap="400">
        <ShopifySubmissionNotice
          shopDomain={shopDomain}
          shopifyDisputeId={dispute.shopifyDisputeId}
          shopifyOrderId={dispute.shopifyOrderId}
          recordedAt={dispute.latestPacket?.submittedAt ?? dispute.evidenceSentOn ?? null}
        />

        <Banner tone="info">
          <p>Banks and card issuers decide final outcomes. Review the evidence package before sending it onward.</p>
        </Banner>

        {/*
          Three cards, each holding a single value, took a third of the screen
          to say what one line says. Same three facts, one strip.
        */}
        <Card padding="300">
          <InlineStack align="start" blockAlign="center" gap="800" wrap>
            <BlockStack gap="050">
              <Text as="p" variant="bodyXs" tone="subdued">
                Current packet
              </Text>
              <Text as="p" variant="bodyMd" fontWeight="medium">
                {dispute.latestPacket ? `Version ${dispute.latestPacket.version}` : "Not generated"}
              </Text>
            </BlockStack>
            <BlockStack gap="050">
              <Text as="p" variant="bodyXs" tone="subdued">
                Dispute
              </Text>
              <Text as="p" variant="bodyMd" fontWeight="medium">
                {dispute.shopifyDisputeId.split("/").pop()}
              </Text>
            </BlockStack>
            <BlockStack gap="050">
              <Text as="p" variant="bodyXs" tone="subdued">
                Amount
              </Text>
              <Text as="p" variant="bodyMd" fontWeight="medium">
                {formatMoney(dispute.amount, dispute.currencyCode)}
              </Text>
            </BlockStack>
          </InlineStack>
        </Card>

        <InlineGrid columns={{ xs: 1, md: "2fr 1fr" }} gap="400">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Narrative summary
              </Text>
              {sections.length > 0 ? (
                <BlockStack gap="300">
                  {sections.map((section, index) => (
                    <BlockStack gap="100" key={`${dispute.id}-${index}`}>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Section {index + 1}
                      </Text>
                      <Text as="p" variant="bodyMd">
                        {section}
                      </Text>
                      {index < sections.length - 1 ? <Divider /> : null}
                    </BlockStack>
                  ))}
                </BlockStack>
              ) : (
                <Text as="p" variant="bodyMd" tone="subdued">
                  Generate a packet draft to review the assembled narrative.
                </Text>
              )}
              {dispute.latestPacket?.summaryText ? (
                <PacketSummaryEditor
                  disputeId={dispute.id}
                  initialSummary={dispute.latestPacket.summaryText}
                />
              ) : null}
            </BlockStack>
          </Card>

          <BlockStack gap="400">
            <Card>
              <PacketQualityPanel review={packetReview} />
            </Card>

            <Card>
              <AIPackageAssessment assessment={aiAssessment} />
            </Card>

            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  Included evidence
                </Text>
                {dispute.evidenceItems.length > 0 ? (
                  <List type="bullet">
                    {dispute.evidenceItems.map((item) => (
                      <List.Item key={item.id}>{item.title}</List.Item>
                    ))}
                  </List>
                ) : (
                  <Text as="p" variant="bodySm" tone="subdued">
                    No evidence files are attached to this dispute yet, so the packet contains the narrative only. Add
                    files from the dispute page before submitting.
                  </Text>
                )}
              </BlockStack>
            </Card>

            {/*
              The "Actions" card offered a third way back to the dispute (the
              page already has a back action) and a second download button (the
              page already has the primary action). Both are gone; nothing is
              now reachable only from here.
            */}
          </BlockStack>
        </InlineGrid>
      </BlockStack>
    </Page>
  );
}
