"use client";

import Link from "next/link";
import {
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Divider,
  InlineGrid,
  InlineStack,
  List,
  Page,
  Text
} from "@shopify/polaris";

import { PacketQualityPanel } from "@/components/packet-quality-panel";
import { assessPacketQuality } from "@/lib/disputes/workflow";
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
  const sections = splitSections(dispute.latestPacket?.summaryText ?? null);
  const packetReview = assessPacketQuality(dispute);

  return (
    <Page
      fullWidth
      title="Packet preview"
      subtitle="Review the compiled evidence narrative before export or submission."
      backAction={{ content: "Back to dispute", url: `/disputes/${dispute.id}` }}
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
        <Banner tone="info">
          <p>Banks and card issuers decide final outcomes. Review the evidence package before sending it onward.</p>
        </Banner>

        <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
          <Card>
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued">
                Current packet
              </Text>
              <Text as="p" variant="headingMd">
                {dispute.latestPacket ? `Version ${dispute.latestPacket.version}` : "Not generated"}
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued">
                Dispute
              </Text>
              <Text as="p" variant="headingMd">
                {dispute.shopifyDisputeId.split("/").pop()}
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued">
                Amount
              </Text>
              <Text as="p" variant="headingMd">
                {dispute.currencyCode ?? "USD"} {dispute.amount}
              </Text>
            </BlockStack>
          </Card>
        </InlineGrid>

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
            </BlockStack>
          </Card>

          <BlockStack gap="400">
            <Card>
              <PacketQualityPanel review={packetReview} />
            </Card>

            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  Included evidence
                </Text>
                <List type="bullet">
                  {dispute.evidenceItems.map((item) => (
                    <List.Item key={item.id}>{item.title}</List.Item>
                  ))}
                </List>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  Actions
                </Text>
                <InlineStack gap="200" wrap>
                  <Button url={`/disputes/${dispute.id}`}>Back to dispute</Button>
                  {dispute.latestPacket ? (
                    <Button url={`/api/disputes/${dispute.id}/packet/download`} target="_blank" variant="primary">
                      Download packet
                    </Button>
                  ) : null}
                </InlineStack>
                <Box>
                  <Link className="table-link" href={`/disputes/${dispute.id}` as never}>
                    Return to evidence and submission workflow
                  </Link>
                </Box>
              </BlockStack>
            </Card>
          </BlockStack>
        </InlineGrid>
      </BlockStack>
    </Page>
  );
}
