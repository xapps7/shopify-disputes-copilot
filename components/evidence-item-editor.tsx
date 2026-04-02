"use client";

import { startTransition, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, BlockStack, Button, InlineStack, Modal, Select, Text, TextField } from "@shopify/polaris";

import type { DisputeOptionView, EvidenceLibraryItemView } from "@/lib/types";

type EvidenceItemEditorProps = {
  item: EvidenceLibraryItemView | null;
  disputeOptions: DisputeOptionView[];
  open: boolean;
  onClose: () => void;
};

export function EvidenceItemEditor({ item, disputeOptions, open, onClose }: EvidenceItemEditorProps) {
  const router = useRouter();
  const [category, setCategory] = useState("OTHER");
  const [description, setDescription] = useState("");
  const [disputeId, setDisputeId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!item) return;
    setCategory(item.category);
    setDescription(item.description ?? "");
    setDisputeId(item.disputeId);
    setMessage(null);
  }, [item]);

  async function handleSave() {
    if (!item) return;
    setIsSaving(true);
    setMessage(null);

    const response = await fetch(`/api/evidence/${item.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        category,
        description,
        disputeId
      })
    });

    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    setMessage(payload?.message ?? (response.ok ? "Evidence updated." : "Evidence update failed."));

    if (response.ok) {
      startTransition(() => {
        router.refresh();
      });
    }

    setIsSaving(false);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={item ? `Edit ${item.title}` : "Edit evidence"}
      primaryAction={{ content: "Save", onAction: handleSave, loading: isSaving, disabled: !item }}
      secondaryActions={[{ content: "Close", onAction: onClose }]}
    >
      <Modal.Section>
        {item ? (
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="p" variant="bodySm" tone="subdued">
                Source
              </Text>
              <Badge>{item.sourceType}</Badge>
            </InlineStack>

            <Select
              label="Linked dispute"
              options={disputeOptions.map((option) => ({ label: option.label, value: option.id }))}
              value={disputeId}
              onChange={setDisputeId}
            />

            <Select
              label="Evidence category"
              options={[
                { label: "Customer communication", value: "CUSTOMER_COMMUNICATION" },
                { label: "Refund proof", value: "REFUND_PROOF" },
                { label: "Delivery confirmation", value: "DELIVERY_CONFIRMATION" },
                { label: "Shipping documentation", value: "SHIPPING_DOCUMENTATION" },
                { label: "Policy disclosure", value: "POLICY_DISCLOSURE" },
                { label: "Product proof", value: "PRODUCT_PROOF" },
                { label: "Other", value: "OTHER" }
              ]}
              value={category}
              onChange={setCategory}
            />

            <TextField
              autoComplete="off"
              label="Operator note"
              multiline={4}
              value={description}
              onChange={setDescription}
              helpText="Keep a short note about why this file matters in the packet."
            />

            {message ? (
              <Text as="p" variant="bodySm" tone="subdued">
                {message}
              </Text>
            ) : null}
          </BlockStack>
        ) : null}
      </Modal.Section>
    </Modal>
  );
}
