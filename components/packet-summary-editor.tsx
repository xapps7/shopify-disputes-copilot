"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { BlockStack, Button, Text, TextField } from "@shopify/polaris";

type PacketSummaryEditorProps = {
  disputeId: string;
  initialSummary: string;
};

export function PacketSummaryEditor({ disputeId, initialSummary }: PacketSummaryEditorProps) {
  const router = useRouter();
  const [summaryText, setSummaryText] = useState(initialSummary);
  const [message, setMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSave() {
    setIsSaving(true);
    setMessage(null);

    const response = await fetch(`/api/disputes/${disputeId}/packet`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ summaryText })
    });

    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    setMessage(payload?.message ?? (response.ok ? "Packet narrative updated." : "Packet update failed."));

    if (response.ok) {
      startTransition(() => {
        router.refresh();
      });
    }

    setIsSaving(false);
  }

  return (
    <BlockStack gap="300">
      <TextField
        autoComplete="off"
        label="Editable packet narrative"
        multiline={12}
        value={summaryText}
        onChange={setSummaryText}
        helpText="Refine the packet narrative before exporting or recording submission."
      />
      <Button loading={isSaving} onClick={handleSave}>
        Save narrative
      </Button>
      {message ? (
        <Text as="p" variant="bodySm" tone="subdued">
          {message}
        </Text>
      ) : null}
    </BlockStack>
  );
}
