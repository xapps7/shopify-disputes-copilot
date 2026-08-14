"use client";

import { startTransition, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BlockStack,
  Button,
  DropZone,
  InlineError,
  InlineStack,
  Select,
  Text,
  TextField,
  Thumbnail
} from "@shopify/polaris";
import { NoteIcon } from "@shopify/polaris-icons";
import { authenticatedFetch } from "@/components/authenticated-fetch";
import { ALLOWED_EVIDENCE_MIME_TYPES } from "@/lib/disputes/evidence-fields";

type EvidenceUploadFormProps = {
  disputeId: string;
};

/**
 * Shopify accepts PDF, PNG and JPEG for dispute evidence and nothing else - the
 * upload route rejects the rest with a 415. Offering .txt and .csv here (as
 * this form used to) only produced uploads that could never be attached.
 */
const ACCEPTED_TYPES = ".pdf,.png,.jpg,.jpeg";

export function EvidenceUploadForm({ disputeId }: EvidenceUploadFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("CUSTOMER_COMMUNICATION");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDrop = useCallback((files: File[], acceptedFiles: File[]) => {
    const [accepted] = acceptedFiles;
    if (accepted && (ALLOWED_EVIDENCE_MIME_TYPES as readonly string[]).includes(accepted.type)) {
      setFile(accepted);
      setError(null);
      return;
    }

    const [rejected] = files;
    setFile(null);
    setError(
      rejected
        ? `Shopify accepts PDF, PNG and JPEG only, so "${rejected.name}" cannot be attached to a dispute. Convert it and try again.`
        : "Choose a PDF, PNG or JPEG file."
    );
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!title.trim() || !file) {
      setError("Add a title and choose a file before uploading.");
      return;
    }

    setError(null);
    setIsSubmitting(true);
    setMessage(null);

    const formData = new FormData();
    formData.set("title", title.trim());
    formData.set("description", description.trim());
    formData.set("category", category);
    formData.set("file", file);

    const response = await authenticatedFetch(`/api/disputes/${disputeId}/evidence`, {
      method: "POST",
      body: formData
    });

    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    setMessage(payload?.message ?? (response.ok ? "Evidence uploaded." : "Upload failed."));

    if (response.ok) {
      setTitle("");
      setDescription("");
      setFile(null);
      startTransition(() => {
        router.refresh();
      });
    }

    setIsSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit} className="polaris-form">
      <BlockStack gap="300">
        <TextField
          autoComplete="off"
          label="Evidence title"
          name="title"
          onChange={setTitle}
          placeholder="Evidence title"
          requiredIndicator
          value={title}
        />
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
          onChange={setDescription}
          placeholder="Describe why this evidence matters."
          value={description}
        />

        <DropZone
          accept={ACCEPTED_TYPES}
          allowMultiple={false}
          error={Boolean(error) && !file}
          id="evidence-file"
          label="Attach file"
          onDrop={handleDrop}
          errorOverlayText="That file type is not accepted"
        >
          {file ? (
            <BlockStack gap="100" inlineAlign="center">
              <InlineStack gap="200" blockAlign="center">
                <Thumbnail alt={file.name} size="small" source={NoteIcon} />
                <Text as="span" variant="bodySm">
                  {file.name}
                </Text>
              </InlineStack>
            </BlockStack>
          ) : (
            <DropZone.FileUpload
              actionTitle="Add file"
              actionHint="Accepted: PDF, PNG, JPEG — 4 MB total across a dispute"
            />
          )}
        </DropZone>

        {error ? <InlineError message={error} fieldID="evidence-file" /> : null}

        <Text as="p" variant="bodySm" tone="subdued">
          Use the category that matches the checklist row you are trying to satisfy. For example: upload carrier labels
          or tracking exports as <strong>Shipping documentation</strong>, and proof-of-delivery scans as{" "}
          <strong>Delivery confirmation</strong>.
        </Text>

        <Button loading={isSubmitting} submit variant="primary">
          {isSubmitting ? "Uploading..." : "Upload evidence"}
        </Button>
      </BlockStack>
      {message ? <p className="sync-message">{message}</p> : null}
    </form>
  );
}
