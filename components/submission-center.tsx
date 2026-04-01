"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, BlockStack, Button, InlineStack, Select, Text, TextField } from "@shopify/polaris";

type SubmissionCenterProps = {
  disputeId: string;
  packetReady: boolean;
  packetStatus: string | null;
  submittedAt: string | null;
  evidenceSentOn: string | null;
};

export function SubmissionCenter({
  disputeId,
  packetReady,
  packetStatus,
  submittedAt,
  evidenceSentOn
}: SubmissionCenterProps) {
  const router = useRouter();
  const [method, setMethod] = useState("SHOPIFY_ADMIN");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit() {
    setIsSubmitting(true);
    setMessage(null);

    const response = await fetch(`/api/disputes/${disputeId}/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ method, notes })
    });

    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    setMessage(payload?.message ?? (response.ok ? "Submission recorded." : "Submission failed."));

    if (response.ok) {
      startTransition(() => {
        router.refresh();
      });
    }

    setIsSubmitting(false);
  }

  return (
    <BlockStack gap="300">
      <BlockStack gap="150">
        <InlineStack align="space-between">
          <Text as="p" variant="bodySm" tone="subdued">
            Packet status
          </Text>
          <Badge tone={packetReady ? "success" : "warning"}>{packetStatus ?? "Not generated"}</Badge>
        </InlineStack>
        <InlineStack align="space-between">
          <Text as="p" variant="bodySm" tone="subdued">
            Last recorded submission
          </Text>
          <Text as="p" variant="bodySm">
            {submittedAt ?? evidenceSentOn
              ? new Date(submittedAt ?? evidenceSentOn ?? "").toLocaleString()
              : "Not submitted"}
          </Text>
        </InlineStack>
      </BlockStack>

      <Text as="p" variant="bodySm" tone="subdued">
        Direct API submission is not enabled yet. Record the merchant's manual submission in Shopify Admin so the dispute timeline stays accurate.
      </Text>

      <Select
        label="Submission method"
        options={[
          { label: "Shopify Admin", value: "SHOPIFY_ADMIN" },
          { label: "Bank / processor portal", value: "PROCESSOR_PORTAL" },
          { label: "Email / support handoff", value: "EMAIL_HANDOFF" }
        ]}
        value={method}
        onChange={setMethod}
      />

      <TextField
        autoComplete="off"
        label="Submission notes"
        multiline={3}
        value={notes}
        onChange={setNotes}
        placeholder="Add a short note about how and where the seller submitted the packet."
      />

      <Button disabled={!packetReady} loading={isSubmitting} onClick={handleSubmit} variant="primary">
        Record submission
      </Button>

      {!packetReady ? (
        <Text as="p" variant="bodySm" tone="subdued">
          Generate a packet draft before recording submission.
        </Text>
      ) : null}

      {message ? (
        <Text as="p" variant="bodySm" tone="subdued">
          {message}
        </Text>
      ) : null}
    </BlockStack>
  );
}
