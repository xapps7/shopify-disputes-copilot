"use client";

import { startTransition, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  DropZone,
  InlineError,
  InlineStack,
  Select,
  Text,
  TextField
} from "@shopify/polaris";

import { authenticatedFetch } from "@/components/authenticated-fetch";
import { EvidenceFileActions } from "@/components/evidence-file-actions";
import { formatBytes } from "@/components/evidence-file-slots";
import {
  ALLOWED_EVIDENCE_MIME_TYPES,
  MAX_SINGLE_EVIDENCE_BYTES,
  MAX_TOTAL_EVIDENCE_BYTES,
  SHOPIFY_FILE_RULES
} from "@/lib/disputes/evidence-fields";
import {
  LIBRARY_DOCUMENT_KINDS,
  getKindDefinition,
  standingBudget,
  type LibraryDocument,
  type LibraryDocumentKind
} from "@/lib/documents/library";
import { formatDate } from "@/lib/format/date";
import { ResourceSection } from "@/components/resource-section";

/**
 * The documents a merchant uploads once.
 *
 * The old evidence library told merchants their files were "ready to reuse on
 * any other dispute". That was not true - every evidence row is bound to one
 * dispute, so nothing was reusable and the same refund policy was uploaded
 * again at every chargeback. This section is the thing that sentence described.
 *
 * Deliberately NOT in Settings. Settings is where you configure an app; this is
 * evidence, it is the merchant's own material, and it belongs beside the rest
 * of their evidence.
 */

const ACCEPTED_TYPES = ".pdf,.png,.jpg,.jpeg";

type StandingDocumentsProps = {
  documents: LibraryDocument[];
  refundPolicyStatement: string;
  cancellationPolicyStatement: string;
};

export function StandingDocuments({
  documents,
  refundPolicyStatement,
  cancellationPolicyStatement
}: StandingDocumentsProps) {
  const router = useRouter();
  const [kind, setKind] = useState<LibraryDocumentKind>("REFUND_POLICY");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [refundText, setRefundText] = useState(refundPolicyStatement);
  const [cancellationText, setCancellationText] = useState(cancellationPolicyStatement);
  const [textStatus, setTextStatus] = useState<string | null>(null);
  const [savingText, setSavingText] = useState(false);

  const budget = standingBudget(documents, MAX_TOTAL_EVIDENCE_BYTES);

  const handleDrop = useCallback((files: File[], accepted: File[]) => {
    const [chosen] = accepted;

    if (!chosen || !(ALLOWED_EVIDENCE_MIME_TYPES as readonly string[]).includes(chosen.type)) {
      setFile(null);
      setError(
        files[0]
          ? `Shopify accepts PDF, PNG and JPEG only, so "${files[0].name}" could never be attached to a dispute.`
          : "Choose a PDF, PNG or JPEG file."
      );
      return;
    }

    if (chosen.size > MAX_SINGLE_EVIDENCE_BYTES) {
      setFile(null);
      setError(
        `Shopify accepts 2 MB per evidence file. "${chosen.name}" is ${formatBytes(chosen.size)}. Compress it or split it before uploading.`
      );
      return;
    }

    setFile(chosen);
    setError(null);
  }, []);

  async function handleUpload() {
    if (!file) {
      setError("Choose a file first.");
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);

    const body = new FormData();
    body.set("kind", kind);
    body.set("title", title.trim());
    body.set("file", file);

    const response = await authenticatedFetch("/api/library/documents", { method: "POST", body });
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;

    setBusy(false);

    if (!response.ok) {
      setError(payload?.message ?? "Could not save that document.");
      return;
    }

    setFile(null);
    setTitle("");
    setMessage(payload?.message ?? "Saved.");
    startTransition(() => router.refresh());
  }

  async function handleRemove(id: string) {
    setBusy(true);
    setMessage(null);

    const response = await authenticatedFetch(`/api/library/documents/${id}`, { method: "DELETE" });
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;

    setBusy(false);

    if (!response.ok) {
      setError(payload?.message ?? "Could not remove that document.");
      return;
    }

    setMessage(payload?.message ?? "Removed.");
    startTransition(() => router.refresh());
  }

  async function handleSaveText() {
    setSavingText(true);
    setTextStatus(null);

    const response = await authenticatedFetch("/api/library/statements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        refundPolicyStatement: refundText,
        cancellationPolicyStatement: cancellationText
      })
    });
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;

    setSavingText(false);
    setTextStatus(payload?.message ?? (response.ok ? "Saved." : "Could not save that text."));

    if (response.ok) {
      startTransition(() => router.refresh());
    }
  }

  return (
    <BlockStack gap="400">
      <ResourceSection
        title="Documents you upload once"
        description="Your refund policy does not change between chargebacks. Put it here and it is offered on every dispute that has a slot for it, already the right file type and the right size."
      >
        <BlockStack gap="400">
          {documents.length > 0 ? (
            <BlockStack gap="300">
              {documents.map((document) => {
                const definition = getKindDefinition(document.kind);

                return (
                  <Box
                    background="bg-surface"
                    borderColor="border"
                    borderRadius="300"
                    borderWidth="025"
                    key={document.id}
                    padding="400"
                  >
                    <BlockStack gap="200">
                      <InlineStack align="space-between" blockAlign="start" gap="300" wrap>
                        <BlockStack gap="100">
                          <Text as="h3" variant="headingSm">
                            {document.title}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {`${definition.label} · ${formatBytes(document.sizeBytes)}${
                              document.uploadedAt ? ` · added ${formatDate(document.uploadedAt)}` : ""
                            }`}
                          </Text>
                        </BlockStack>
                        <InlineStack blockAlign="center" gap="200" wrap>
                          {/*
                            Named with the Shopify slot, not our own vocabulary,
                            so the merchant is matching labels in the admin
                            rather than translating while a clock runs.
                          */}
                          <Badge tone="info">{`Goes in ${definition.slot}`}</Badge>
                          <Button
                            disabled={busy}
                            onClick={() => handleRemove(document.id)}
                            tone="critical"
                            variant="tertiary"
                          >
                            Remove
                          </Button>
                        </InlineStack>
                      </InlineStack>

                      <EvidenceFileActions
                        fileUrl={`/api/library/documents/${document.id}/file`}
                        title={document.title}
                      />
                    </BlockStack>
                  </Box>
                );
              })}

              {budget.crowded ? (
                <Banner tone="warning" title="These files leave little room for the ones that win cases">
                  <p>
                    {`Your standing documents come to ${formatBytes(budget.usedBytes)} of Shopify's ${formatBytes(
                      MAX_TOTAL_EVIDENCE_BYTES
                    )} total. That leaves ${formatBytes(
                      budget.remainingBytes
                    )} for delivery proof and customer communication, which are the files that actually decide a dispute. Consider a smaller scan of the policy.`}
                  </p>
                </Banner>
              ) : null}
            </BlockStack>
          ) : (
            <Text as="p" variant="bodySm" tone="subdued">
              Nothing here yet. Most stores need two files: the refund policy and, if you sell subscriptions or
              services, the cancellation terms.
            </Text>
          )}

          <Box borderColor="border" borderBlockStartWidth="025" paddingBlockStart="400">
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">
                Add a document
              </Text>

              <Select
                label="What is it"
                onChange={(value) => setKind(value as LibraryDocumentKind)}
                options={LIBRARY_DOCUMENT_KINDS.map((definition) => ({
                  label: definition.label,
                  value: definition.kind
                }))}
                value={kind}
              />

              <Text as="p" variant="bodySm" tone="subdued">
                {getKindDefinition(kind).why}
              </Text>

              <TextField
                autoComplete="off"
                helpText="Optional. Left blank, it takes the name of the document type."
                label="Name it"
                onChange={setTitle}
                value={title}
              />

              <DropZone accept={ACCEPTED_TYPES} allowMultiple={false} onDrop={handleDrop} type="file">
                {file ? (
                  <Box padding="400">
                    <Text as="p" variant="bodySm">
                      {`${file.name} · ${formatBytes(file.size)}`}
                    </Text>
                  </Box>
                ) : (
                  <DropZone.FileUpload actionTitle="Add file" actionHint="PDF, PNG or JPEG. 2 MB maximum." />
                )}
              </DropZone>

              {error ? <InlineError fieldID="standing-document" message={error} /> : null}
              {message ? (
                <Text as="p" variant="bodySm" tone="success">
                  {message}
                </Text>
              ) : null}

              <InlineStack gap="200">
                <Button disabled={!file} loading={busy} onClick={handleUpload} variant="primary">
                  Save to library
                </Button>
              </InlineStack>

              <BlockStack gap="050">
                <Text as="p" variant="bodyXs" tone="subdued">
                  Shopify&rsquo;s rules for every evidence file:
                </Text>
                {SHOPIFY_FILE_RULES.map((rule) => (
                  <Text as="p" key={rule} tone="subdued" variant="bodyXs">
                    {`· ${rule}`}
                  </Text>
                ))}
              </BlockStack>
            </BlockStack>
          </Box>
        </BlockStack>
      </ResourceSection>

      <ResourceSection
        title="Text you write once"
        description="Shopify shows these two answers to the bank word for word, and the right answer is the same on every dispute. Write them properly here and every new dispute starts with them filled in."
      >
        <BlockStack gap="400">
          <TextField
            autoComplete="off"
            helpText="What the policy says and where the customer saw it before paying. Not a link - Shopify tells merchants not to include links to pages held elsewhere."
            label="Refund policy disclosure"
            multiline={4}
            onChange={setRefundText}
            placeholder="Example: Our 30-day refund policy is linked in the checkout footer and shown on every product page. The customer accepted it at checkout before payment."
            value={refundText}
          />

          <TextField
            autoComplete="off"
            helpText="For subscriptions and services. Leave blank if you sell neither."
            label="Cancellation policy disclosure"
            multiline={4}
            onChange={setCancellationText}
            placeholder="Example: Cancellation requires 7 days notice before renewal. The terms are shown at sign-up and repeated in every renewal reminder email."
            value={cancellationText}
          />

          <InlineStack blockAlign="center" gap="300" wrap>
            <Button loading={savingText} onClick={handleSaveText} variant="primary">
              Save text
            </Button>
            {textStatus ? (
              <Text as="span" variant="bodySm" tone="subdued">
                {textStatus}
              </Text>
            ) : null}
          </InlineStack>

          {/*
            Saying what this does NOT do matters as much as what it does. A
            merchant who thinks this rewrote their open disputes will not check
            them, and a stale policy sentence would then go to a bank unread.
          */}
          <Text as="p" variant="bodySm" tone="subdued">
            This fills the two fields on disputes you have not edited yet. Anything you have already written by hand on
            an open dispute stays as you wrote it.
          </Text>
        </BlockStack>
      </ResourceSection>
    </BlockStack>
  );
}
