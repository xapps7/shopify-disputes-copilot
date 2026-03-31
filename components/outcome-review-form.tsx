"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { BlockStack, Button, Card, InlineStack, Select, Text, TextField } from "@shopify/polaris";

import type { PreventionRecommendationView } from "@/lib/types";

type OutcomeReviewFormProps = {
  disputeId: string;
  currentStatus: string;
  recommendations: PreventionRecommendationView[];
};

export function OutcomeReviewForm({
  disputeId,
  currentStatus,
  recommendations
}: OutcomeReviewFormProps) {
  const router = useRouter();
  const [outcome, setOutcome] = useState(
    ["WON", "LOST", "ACCEPTED"].includes(currentStatus) ? currentStatus : "UNDER_REVIEW"
  );
  const [rootCause, setRootCause] = useState("DOCUMENTATION_GAP");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSave() {
    setIsSaving(true);
    setMessage(null);

    const response = await fetch(`/api/disputes/${disputeId}/outcome`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        outcome,
        rootCause,
        notes
      })
    });

    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    setMessage(payload?.message ?? (response.ok ? "Outcome recorded." : "Outcome update failed."));

    if (response.ok) {
      startTransition(() => {
        router.refresh();
      });
    }

    setIsSaving(false);
  }

  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">
          Outcome and prevention
        </Text>
        <Text as="p" variant="bodySm" tone="subdued">
          Record the result of this dispute and generate prevention actions for the merchant team.
        </Text>

        <InlineStack gap="300" align="space-between">
          <Select
            label="Outcome"
            options={[
              { label: "Under review", value: "UNDER_REVIEW" },
              { label: "Won", value: "WON" },
              { label: "Lost", value: "LOST" },
              { label: "Accepted", value: "ACCEPTED" }
            ]}
            value={outcome}
            onChange={setOutcome}
          />
          <Select
            label="Root cause"
            options={[
              { label: "Documentation gap", value: "DOCUMENTATION_GAP" },
              { label: "Fraud screening", value: "FRAUD_SCREENING" },
              { label: "Fulfillment gap", value: "FULFILLMENT_GAP" },
              { label: "Policy clarity", value: "POLICY_CLARITY" },
              { label: "Customer support delay", value: "CUSTOMER_SUPPORT_DELAY" }
            ]}
            value={rootCause}
            onChange={setRootCause}
          />
        </InlineStack>

        <TextField
          autoComplete="off"
          label="Internal note"
          multiline={3}
          value={notes}
          onChange={setNotes}
          helpText="Capture what the team learned from this case. This becomes part of the prevention trail."
        />

        <Button loading={isSaving} onClick={handleSave} variant="primary">
          Save outcome
        </Button>

        {message ? (
          <Text as="p" tone="subdued" variant="bodySm">
            {message}
          </Text>
        ) : null}

        {recommendations.length > 0 ? (
          <BlockStack gap="200">
            <Text as="h3" variant="headingSm">
              Current prevention actions
            </Text>
            <div className="recommendation-list">
              {recommendations.map((item) => (
                <div className="recommendation-card" key={item.id}>
                  <Text as="p" variant="bodyMd" fontWeight="semibold">
                    {item.category.replaceAll("_", " ")}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {item.recommendationText}
                  </Text>
                </div>
              ))}
            </div>
          </BlockStack>
        ) : null}
      </BlockStack>
    </Card>
  );
}
