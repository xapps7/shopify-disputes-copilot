"use client";

import { Badge, BlockStack, Box, Card, InlineGrid, Text } from "@shopify/polaris";

type PacketPreviewProps = {
  latestPacket: {
    version: number;
    status: string;
    generatedAt: string | null;
    pdfUrl: string | null;
    summaryText: string | null;
  } | null;
};

function parseSections(summaryText: string | null) {
  if (!summaryText) {
    return [];
  }

  return summaryText
    .split("\n\n")
    .map((section) => section.trim())
    .filter(Boolean)
    .slice(0, 6);
}

export function PacketPreview({ latestPacket }: PacketPreviewProps) {
  const sections = parseSections(latestPacket?.summaryText ?? null);

  return (
    <Card>
      <BlockStack gap="400">
        <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
          <Box background="bg-surface-secondary" borderRadius="300" padding="400">
            <BlockStack gap="100">
              <Text as="h3" variant="headingMd">
                Packet review
              </Text>
              <Text as="p" variant="bodyMd" tone="subdued">
                Review the current draft inside the app before opening the exported file.
              </Text>
            </BlockStack>
          </Box>
          <Box background="bg-fill-secondary" borderRadius="300" padding="400">
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued">
                Current packet
              </Text>
              <Text as="p" variant="headingLg">
                {latestPacket ? `v${latestPacket.version}` : "No packet yet"}
              </Text>
              <Badge tone={latestPacket ? "success" : "info"}>
                {latestPacket?.status ?? "Not drafted"}
              </Badge>
            </BlockStack>
          </Box>
        </InlineGrid>

        {latestPacket ? (
          <div className="packet-preview-grid">
            {sections.length > 0 ? (
              sections.map((section, index) => (
                <div className="packet-preview-card" key={`${latestPacket.version}-${index}`}>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Section {index + 1}
                  </Text>
                  <Text as="p" variant="bodyMd">
                    {section}
                  </Text>
                </div>
              ))
            ) : (
              <div className="packet-preview-card">
                <Text as="p" variant="bodyMd">
                  The latest packet exists, but no structured summary text is available yet.
                </Text>
              </div>
            )}
          </div>
        ) : (
          <div className="packet-preview-card">
            <Text as="p" variant="bodyMd">
              Generate the first packet draft to review the evidence narrative and merchant settings together.
            </Text>
          </div>
        )}
      </BlockStack>
    </Card>
  );
}
