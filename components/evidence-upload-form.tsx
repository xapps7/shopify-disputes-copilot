"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { BlockStack, Button, Select, Text, TextField } from "@shopify/polaris";

type EvidenceUploadFormProps = {
  disputeId: string;
};

export function EvidenceUploadForm({ disputeId }: EvidenceUploadFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [category, setCategory] = useState("CUSTOMER_COMMUNICATION");

  async function handleSubmit(formData: FormData) {
    setIsSubmitting(true);
    setMessage(null);

    const response = await fetch(`/api/disputes/${disputeId}/evidence`, {
      method: "POST",
      body: formData
    });

    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    setMessage(payload?.message ?? (response.ok ? "Evidence uploaded." : "Upload failed."));

    if (response.ok) {
      startTransition(() => {
        router.refresh();
      });
    }

    setIsSubmitting(false);
  }

  return (
    <form action={handleSubmit} className="polaris-form">
      <BlockStack gap="300">
        <TextField autoComplete="off" label="Evidence title" name="title" placeholder="Evidence title" />
        <Select
          label="Evidence category"
          name="category"
          value={category}
          onChange={setCategory}
          options={[
            { label: "Delivery confirmation", value: "DELIVERY_CONFIRMATION" },
            { label: "Shipping documentation", value: "SHIPPING_DOCUMENTATION" },
            { label: "Customer communication", value: "CUSTOMER_COMMUNICATION" },
            { label: "Refund proof", value: "REFUND_PROOF" },
            { label: "Service documentation", value: "SERVICE_DOCUMENTATION" },
            { label: "Policy disclosure", value: "POLICY_DISCLOSURE" },
            { label: "Product proof", value: "PRODUCT_PROOF" },
            { label: "Other", value: "OTHER" }
          ]}
        />
        <TextField
          autoComplete="off"
          label="Why this evidence matters"
          multiline={4}
          name="description"
          placeholder="Describe why this evidence matters."
        />
        <BlockStack gap="100">
          <Text as="p" variant="bodyMd">
            Attach file
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Accepted formats: PDF, PNG, JPG, TXT, and CSV. Use the category that matches the checklist row you are trying to satisfy.
          </Text>
          <input accept=".pdf,.png,.jpg,.jpeg,.txt,.csv" name="file" required type="file" />
        </BlockStack>
        <Text as="p" variant="bodySm" tone="subdued">
          Example: upload carrier labels or tracking exports as <strong>Shipping documentation</strong>, and proof-of-delivery scans as <strong>Delivery confirmation</strong>.
        </Text>
        <Button loading={isSubmitting} submit variant="primary">
          {isSubmitting ? "Uploading..." : "Upload evidence"}
        </Button>
      </BlockStack>
      {message ? <p className="sync-message">{message}</p> : null}
    </form>
  );
}
