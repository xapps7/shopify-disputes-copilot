"use client";

import { Badge, BlockStack, Box, Divider, InlineStack, List, ProgressBar, Text } from "@shopify/polaris";

import type { AIPackageAssessmentView } from "@/lib/types";

type AIPackageAssessmentProps = {
  assessment: AIPackageAssessmentView;
};

function toneForVerdict(verdict: AIPackageAssessmentView["verdict"]) {
  if (verdict === "weak") return "critical" as const;
  if (verdict === "improving") return "warning" as const;
  return "success" as const;
}

function verdictLabel(verdict: AIPackageAssessmentView["verdict"]) {
  if (verdict === "weak") return "Needs improvement";
  if (verdict === "improving") return "Improving";
  return "Strong";
}

export function AIPackageAssessment({ assessment }: AIPackageAssessmentProps) {
  return (
    <BlockStack gap="300">
      <InlineStack align="space-between" blockAlign="start">
        <BlockStack gap="050">
          <Text as="p" variant="bodySm" tone="subdued">
            AI package assessment
          </Text>
          <Text as="p" variant="headingLg">
            {assessment.score}%
          </Text>
        </BlockStack>
        <Badge tone={toneForVerdict(assessment.verdict)}>{verdictLabel(assessment.verdict)}</Badge>
      </InlineStack>

      <ProgressBar
        progress={assessment.score}
        tone={
          assessment.verdict === "strong"
            ? "success"
            : assessment.verdict === "weak"
              ? "critical"
              : "highlight"
        }
      />

      <Text as="p" variant="bodySm">
        {assessment.summary}
      </Text>
      <Text as="p" variant="bodySm" tone="subdued">
        {assessment.confidenceNote}
      </Text>

      {assessment.strengths.length > 0 ? (
        <BlockStack gap="100">
          <Text as="p" variant="bodySm" fontWeight="medium">
            What already helps
          </Text>
          <List type="bullet">
            {assessment.strengths.map((item) => (
              <List.Item key={item}>{item}</List.Item>
            ))}
          </List>
        </BlockStack>
      ) : null}

      {assessment.risks.length > 0 ? (
        <>
          <Divider />
          <BlockStack gap="100">
            <Text as="p" variant="bodySm" fontWeight="medium">
              What weakens the case
            </Text>
            <List type="bullet">
              {assessment.risks.map((item) => (
                <List.Item key={item}>{item}</List.Item>
              ))}
            </List>
          </BlockStack>
        </>
      ) : null}

      {assessment.improvements.length > 0 ? (
        <>
          <Divider />
          <Box background="bg-fill-secondary" borderRadius="300" padding="300">
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" fontWeight="medium">
                Best next improvements
              </Text>
              <List type="bullet">
                {assessment.improvements.map((item) => (
                  <List.Item key={item}>{item}</List.Item>
                ))}
              </List>
            </BlockStack>
          </Box>
        </>
      ) : null}
    </BlockStack>
  );
}
