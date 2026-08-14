"use client";

import { Badge, BlockStack, Box, Card, InlineStack, List, Text } from "@shopify/polaris";

import { formatMoney } from "@/lib/format/money";
import type { StrategyRecommendation } from "@/lib/economics/strategy";

const ACTION_TONE: Record<string, "success" | "warning" | "critical" | "info"> = {
  FIGHT: "success",
  FIGHT_BUT_PRIORITISE_PREVENTION: "warning",
  RESPOND_TO_INQUIRY: "success",
  ACCEPT: "info",
  TOO_LATE: "critical",
  ALREADY_DECIDED: "info"
};

const ACTION_LABEL: Record<string, string> = {
  FIGHT: "Fight this",
  FIGHT_BUT_PRIORITISE_PREVENTION: "Fight, but your ratio matters more",
  RESPOND_TO_INQUIRY: "Answer now — this one is free",
  ACCEPT: "Not worth fighting",
  TOO_LATE: "Shopify already responded",
  ALREADY_DECIDED: "Closed"
};

/**
 * The recommendation, with its reasoning shown rather than a bare score.
 * A merchant who disagrees needs to see what drove it.
 */
export function DisputeStrategyCard({ strategy }: { strategy: StrategyRecommendation }) {
  const { win } = strategy;
  const currency = strategy.fee.currencyCode;

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center" wrap={false}>
          <InlineStack gap="200" blockAlign="center">
            <Badge tone={ACTION_TONE[strategy.action] ?? "info"}>
              {ACTION_LABEL[strategy.action] ?? strategy.action}
            </Badge>
          </InlineStack>
          <Text as="span" variant="bodySm" tone="subdued">
            {`${formatMoney(String(strategy.amountAtRisk), currency)} at risk`}
          </Text>
        </InlineStack>

        <Text as="p" variant="headingMd">
          {strategy.headline}
        </Text>

        <InlineStack gap="400" wrap>
          <Box>
            <Text as="p" variant="bodySm" tone="subdued">
              Estimated chance of winning
            </Text>
            <Text as="p" variant="headingLg">
              {`${Math.round(win.probability * 100)}%`}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {`Range ${Math.round(win.low * 100)}–${Math.round(win.high * 100)}%`}
            </Text>
          </Box>
          <Box>
            <Text as="p" variant="bodySm" tone="subdued">
              Worth recovering
            </Text>
            <Text as="p" variant="headingLg">
              {formatMoney(String(Math.max(0, Math.round(strategy.expectedValue))), currency)}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {`Includes the ${formatMoney(String(strategy.fee.amount), currency)} chargeback fee you pay either way`}
            </Text>
          </Box>
        </InlineStack>

        {strategy.reasons.length > 0 ? (
          <BlockStack gap="100">
            <Text as="h3" variant="headingSm">
              Why
            </Text>
            <List type="bullet">
              {strategy.reasons.map((reason) => (
                <List.Item key={reason}>{reason}</List.Item>
              ))}
            </List>
          </BlockStack>
        ) : null}

        {strategy.warnings.length > 0 ? (
          <BlockStack gap="100">
            <Text as="h3" variant="headingSm">
              Worth knowing
            </Text>
            <List type="bullet">
              {strategy.warnings.map((warning) => (
                <List.Item key={warning}>{warning}</List.Item>
              ))}
            </List>
          </BlockStack>
        ) : null}

        <Text as="p" variant="bodySm" tone="subdued">
          {win.confidence === "observed"
            ? `Based on ${win.sampleSize} of your own resolved disputes of this type.`
            : win.confidence === "blended"
              ? `Based on ${win.sampleSize} of your own resolved disputes, blended with a structural estimate. Directional only.`
              : "No resolved disputes of this type yet, so this is a structural estimate from the evidence — not a measured rate. There is no reliable published win-rate data for anyone to quote."}
        </Text>
      </BlockStack>
    </Card>
  );
}
