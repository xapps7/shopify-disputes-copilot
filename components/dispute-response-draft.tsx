"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  Divider,
  InlineGrid,
  InlineStack,
  List,
  Text,
  TextField
} from "@shopify/polaris";

import { AIPackageAssessment } from "@/components/ai-package-assessment";
import type { DisputeResponseDraftView } from "@/lib/types";
import type { AIPackageAssessmentView } from "@/lib/types";

type DisputeResponseDraftProps = {
  disputeId: string;
  initialDraft: DisputeResponseDraftView;
  initialAssessment: AIPackageAssessmentView;
};

export function DisputeResponseDraft({
  disputeId,
  initialDraft,
  initialAssessment
}: DisputeResponseDraftProps) {
  const router = useRouter();
  const [draft, setDraft] = useState(initialDraft);
  const [assessment, setAssessment] = useState(initialAssessment);
  const [merchantReply, setMerchantReply] = useState(initialDraft.merchantReply);
  const [message, setMessage] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  async function handleRefresh() {
    setIsRefreshing(true);
    setMessage(null);

    const response = await fetch(`/api/disputes/${disputeId}/draft`, {
      method: "POST"
    });

    const payload = (await response.json().catch(() => null)) as
      | { draft?: DisputeResponseDraftView; assessment?: AIPackageAssessmentView; message?: string }
      | null;

    if (response.ok && payload?.draft) {
      setDraft(payload.draft);
      setMerchantReply(payload.draft.merchantReply);
      if (payload.assessment) {
        setAssessment(payload.assessment);
      }
      setMessage("Draft refreshed from the current dispute record.");
      startTransition(() => {
        router.refresh();
      });
    } else {
      setMessage(payload?.message ?? "Draft refresh failed.");
    }

    setIsRefreshing(false);
  }

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="start">
          <BlockStack gap="100">
            <Text as="h3" variant="headingMd">
              AI reply draft
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              Merchant-reviewable narrative built from the order context, evidence shelf, and dispute
              checklist.
            </Text>
          </BlockStack>
          <Button loading={isRefreshing} onClick={handleRefresh} variant="primary">
            Refresh draft
          </Button>
        </InlineStack>

        <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
          <Box background="bg-surface-secondary" borderRadius="300" padding="400">
            <BlockStack gap="200">
              <Text as="h4" variant="headingSm">
                Case readout
              </Text>
              <Text as="p" variant="bodyMd">
                {draft.executiveSummary}
              </Text>
            </BlockStack>
          </Box>

          <Box background="bg-surface-secondary" borderRadius="300" padding="400">
            <AIPackageAssessment assessment={assessment} />
          </Box>
        </InlineGrid>

        <Divider />

        <TextField
          autoComplete="off"
          label="Merchant reply draft"
          multiline={8}
          value={merchantReply}
          onChange={setMerchantReply}
          helpText="Use this as the first pass for the seller's response inside Shopify. Review every statement before submission."
        />

        <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
          <Box background="bg-surface-secondary" borderRadius="300" padding="400">
            <BlockStack gap="200">
              <InlineStack align="space-between">
                <Text as="h4" variant="headingSm">
                  Current strengths
                </Text>
              </InlineStack>
              {draft.strengths.length > 0 ? (
                <List type="bullet">
                  {draft.strengths.map((item) => (
                    <List.Item key={item}>{item}</List.Item>
                  ))}
                </List>
              ) : (
                <Text as="p" variant="bodyMd">
                  No explicit strengths have been identified yet.
                </Text>
              )}
            </BlockStack>
          </Box>

          <Box background="bg-surface-secondary" borderRadius="300" padding="400">
            <BlockStack gap="200">
              <InlineStack align="space-between">
                <Text as="h4" variant="headingSm">
                  Missing evidence
                </Text>
                <Badge tone={draft.missingEvidence.length > 0 ? "warning" : "success"}>
                  {draft.missingEvidence.length > 0 ? `${draft.missingEvidence.length} gaps` : "Covered"}
                </Badge>
              </InlineStack>
              {draft.missingEvidence.length > 0 ? (
                <List type="bullet">
                  {draft.missingEvidence.map((item) => (
                    <List.Item key={item}>{item}</List.Item>
                  ))}
                </List>
              ) : (
                <Text as="p" variant="bodyMd">
                  No missing checklist categories remain.
                </Text>
              )}
            </BlockStack>
          </Box>
        </InlineGrid>

        <Box background="bg-fill-secondary" borderRadius="300" padding="400">
          <BlockStack gap="200">
            <Text as="h4" variant="headingSm">
              Operator guidance
            </Text>
            <List type="bullet">
              {draft.internalGuidance.map((item) => (
                <List.Item key={item}>{item}</List.Item>
              ))}
            </List>
            <Divider />
            <Text as="h4" variant="headingSm">
              Next actions
            </Text>
            <List type="bullet">
              {draft.nextActions.map((item) => (
                <List.Item key={item}>{item}</List.Item>
              ))}
            </List>
          </BlockStack>
        </Box>

        {message ? (
          <Text as="p" tone="subdued" variant="bodySm">
            {message}
          </Text>
        ) : null}
      </BlockStack>
    </Card>
  );
}
