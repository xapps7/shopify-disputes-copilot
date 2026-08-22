"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  ChoiceList,
  DropZone,
  InlineError,
  InlineStack,
  ProgressBar,
  Text,
  TextField,
  Thumbnail
} from "@shopify/polaris";
import { NoteIcon } from "@shopify/polaris-icons";

import { authenticatedFetch } from "@/components/authenticated-fetch";
import { EvidenceGapHint, gapsForCategories, gapsOutsideCategories } from "@/components/evidence-gap-coach";
import {
  ALLOWED_EVIDENCE_MIME_TYPES,
  EVIDENCE_FILE_SLOTS,
  MAX_TOTAL_EVIDENCE_BYTES
} from "@/lib/disputes/evidence-fields";
import type { EvidenceGapInsight } from "@/lib/disputes/workflow";
import { EvidenceFileActions } from "@/components/evidence-file-actions";

/**
 * Shopify's file slots, made honest.
 *
 * Two facts about Shopify's form drive this whole component:
 *   1. Each slot takes exactly ONE file. Our evidence model is one-to-many, so
 *      several uploads can compete for a slot - the merchant has to choose, and
 *      the losing files have to stay visible rather than being silently dropped.
 *   2. The 4 MB cap is TOTAL across every slot, not per file. A packet can pass
 *      every per-file check and still be rejected whole, so the budget is a
 *      running total the merchant can watch.
 */

export type EvidenceFileRef = {
  id: string;
  category: string;
  title: string;
  fileUrl: string | null;
  fileMimeType: string | null;
  fileSizeBytes?: number | null;
};

const NO_FILE = "__none__";

const MIME_LABEL: Record<string, string> = {
  "application/pdf": "PDF",
  "image/png": "PNG",
  "image/jpeg": "JPEG"
};

const ACCEPTED_TYPES_SENTENCE = ALLOWED_EVIDENCE_MIME_TYPES.map((mime) => MIME_LABEL[mime] ?? mime).join(", ");

function describeMime(mime: string | null): string {
  if (!mime) {
    return "unknown file type";
  }
  return MIME_LABEL[mime] ?? mime;
}

function isUsable(item: EvidenceFileRef): boolean {
  return Boolean(item.fileMimeType) && (ALLOWED_EVIDENCE_MIME_TYPES as readonly string[]).includes(item.fileMimeType ?? "");
}

/**
 * A URL saved as evidence: a carrier tracking page rather than a PDF. Shopify's
 * file slot cannot take it, but it is not a broken upload either - it belongs
 * in the response text, and saying so is more use than calling it unusable.
 */
function isLinkOnly(item: EvidenceFileRef): boolean {
  return !item.fileMimeType && Boolean(item.fileUrl);
}

/** Locale-free so server and client renders agree. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  const megabytes = bytes / (1024 * 1024);
  const rounded = megabytes >= 10 ? megabytes.toFixed(0) : megabytes.toFixed(1);
  return `${rounded.replace(/\.0$/, "")} MB`;
}

export const MAX_TOTAL_EVIDENCE_LABEL = formatBytes(MAX_TOTAL_EVIDENCE_BYTES);

function matchesForSlot(items: EvidenceFileRef[], categories: string[]): EvidenceFileRef[] {
  return items.filter((item) => categories.includes(item.category));
}

/**
 * Priority slots with nothing uploaded against them, so the readiness meter can
 * name the missing files as well as the missing text.
 */
export function missingPriorityFileSlots(items: EvidenceFileRef[], prioritySlotKeys: string[]): string[] {
  return EVIDENCE_FILE_SLOTS.filter(
    (slot) => prioritySlotKeys.includes(slot.key) && matchesForSlot(items, slot.categories).length === 0
  ).map((slot) => slot.label);
}

/**
 * One file per slot, and a file already claimed by an earlier slot is not
 * offered again by default - `POLICY_DISCLOSURE` matches both the refund and
 * the cancellation slot, and auto-selecting it twice would double-count it
 * against the 4 MB budget.
 */
function defaultSelection(items: EvidenceFileRef[]): Record<string, string | null> {
  const claimed = new Set<string>();
  const selection: Record<string, string | null> = {};

  for (const slot of EVIDENCE_FILE_SLOTS) {
    const matches = matchesForSlot(items, slot.categories).filter((item) => !claimed.has(item.id));
    const chosen = matches.find(isUsable) ?? matches[0] ?? null;

    selection[slot.key] = chosen?.id ?? null;
    if (chosen) {
      claimed.add(chosen.id);
    }
  }

  return selection;
}

const FILE_INPUT_ACCEPT = ".pdf,.png,.jpg,.jpeg";

/** Strips the extension so the default title reads as a name, not a filename. */
function titleFromFileName(name: string): string {
  const withoutExtension = name.replace(/\.[^./\\]+$/, "").trim();
  return withoutExtension || name;
}

type SlotUploaderProps = {
  disputeId: string;
  slotKey: string;
  slotLabel: string;
  /** The slot's first category — what this upload gets filed under. */
  category: string;
  /** Shopify's 4 MB total, minus everything already uploaded to this dispute. */
  remainingBytes: number;
};

/**
 * Upload straight into the slot.
 *
 * Sending the merchant to a general upload form elsewhere on the page and
 * asking them to guess the right category is how slots stay empty. Both of
 * Shopify's hard limits are stated before a file is chosen and enforced on the
 * client, so a rejection costs nothing and explains itself - the server checks
 * the same two rules again, because a client check is a courtesy, not a
 * guarantee.
 *
 * The link field exists because a carrier's tracking page is very often the
 * only "document" a merchant has, and it is worth more than nothing in the
 * slot.
 */
function SlotUploader({ disputeId, slotKey, slotLabel, category, remainingBytes }: SlotUploaderProps) {
  const router = useRouter();

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkTitle, setLinkTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<"file" | "link" | null>(null);

  const budgetSentence =
    remainingBytes <= 0
      ? `No room left: this dispute already uses all ${MAX_TOTAL_EVIDENCE_LABEL} Shopify allows. Remove a file before adding another.`
      : `${ACCEPTED_TYPES_SENTENCE} only · ${formatBytes(remainingBytes)} left of Shopify's ${MAX_TOTAL_EVIDENCE_LABEL} total`;

  const rejectFile = useCallback(
    (candidate: File): string | null => {
      if (!(ALLOWED_EVIDENCE_MIME_TYPES as readonly string[]).includes(candidate.type)) {
        return `Shopify accepts ${ACCEPTED_TYPES_SENTENCE} only. "${candidate.name}" is ${describeMime(
          candidate.type || null
        )}, so it cannot be attached — convert it first.`;
      }

      if (candidate.size > remainingBytes) {
        return `"${candidate.name}" is ${formatBytes(candidate.size)} and only ${formatBytes(
          remainingBytes
        )} is left of Shopify's ${MAX_TOTAL_EVIDENCE_LABEL} total for this dispute. Compress it, or remove a file you have already uploaded.`;
      }

      return null;
    },
    [remainingBytes]
  );

  const handleDrop = useCallback(
    (dropped: File[]) => {
      const [candidate] = dropped;
      if (!candidate) {
        return;
      }

      const reason = rejectFile(candidate);
      setMessage(null);

      if (reason) {
        setFile(null);
        setError(reason);
        return;
      }

      setError(null);
      setFile(candidate);
      setTitle((previous) => previous || titleFromFileName(candidate.name));
    },
    [rejectFile]
  );

  async function handleUpload() {
    if (!file) {
      setError("Choose a file first.");
      return;
    }

    const reason = rejectFile(file);
    if (reason) {
      setError(reason);
      return;
    }

    const resolvedTitle = title.trim() || titleFromFileName(file.name);

    setError(null);
    setMessage(null);
    setBusy("file");

    try {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("title", resolvedTitle);
      formData.set("category", category);

      const response = await authenticatedFetch(`/api/disputes/${disputeId}/evidence`, {
        method: "POST",
        body: formData
      });

      const payload = (await response.json().catch(() => null)) as { message?: string } | null;

      if (!response.ok) {
        setError(payload?.message ?? "Upload failed. The file was not attached.");
        return;
      }

      setFile(null);
      setTitle("");
      setMessage(`"${resolvedTitle}" added to ${slotLabel}.`);
      startTransition(() => {
        router.refresh();
      });
    } catch {
      setError("Upload failed — check your connection and try again. Nothing was attached.");
    } finally {
      setBusy(null);
    }
  }

  async function handleSaveLink() {
    const url = linkUrl.trim();

    if (!url) {
      setLinkError("Paste a link first.");
      return;
    }

    if (!/^https?:\/\/\S+$/i.test(url)) {
      setLinkError("Enter a full link starting with https:// so the reviewer can open it.");
      return;
    }

    const resolvedTitle = linkTitle.trim() || `${slotLabel} link`;

    setLinkError(null);
    setMessage(null);
    setBusy("link");

    try {
      const formData = new FormData();
      formData.set("url", url);
      formData.set("title", resolvedTitle);
      formData.set("category", category);

      const response = await authenticatedFetch(`/api/disputes/${disputeId}/evidence`, {
        method: "POST",
        body: formData
      });

      const payload = (await response.json().catch(() => null)) as { message?: string } | null;

      if (!response.ok) {
        setLinkError(payload?.message ?? "The link was not saved.");
        return;
      }

      setLinkUrl("");
      setLinkTitle("");
      setMessage(`Link saved to ${slotLabel}.`);
      startTransition(() => {
        router.refresh();
      });
    } catch {
      setLinkError("The link was not saved — check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  const errorFieldId = `slot-upload-${slotKey}`;

  return (
    <Box background="bg-surface-secondary" borderRadius="200" padding="300">
      <BlockStack gap="300">
        <BlockStack gap="100">
          <Text as="h5" variant="headingXs">
            {`Add a file to ${slotLabel}`}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {budgetSentence}
          </Text>
        </BlockStack>

        <DropZone
          accept={FILE_INPUT_ACCEPT}
          allowMultiple={false}
          disabled={remainingBytes <= 0 || busy !== null}
          error={Boolean(error)}
          errorOverlayText={`Shopify accepts ${ACCEPTED_TYPES_SENTENCE} only`}
          id={errorFieldId}
          label={`Add a file to ${slotLabel}`}
          labelHidden
          onDrop={handleDrop}
        >
          {file ? (
            <Box padding="300">
              <InlineStack gap="200" blockAlign="center" wrap>
                <Thumbnail alt={file.name} size="small" source={NoteIcon} />
                <BlockStack gap="050">
                  <Text as="span" variant="bodySm" fontWeight="medium">
                    {file.name}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {`${describeMime(file.type || null)} · ${formatBytes(file.size)}`}
                  </Text>
                </BlockStack>
              </InlineStack>
            </Box>
          ) : (
            <DropZone.FileUpload
              actionTitle="Add file"
              actionHint={`Accepted: ${ACCEPTED_TYPES_SENTENCE}`}
            />
          )}
        </DropZone>

        {error ? <InlineError message={error} fieldID={errorFieldId} /> : null}

        {file ? (
          <BlockStack gap="200">
            <TextField
              autoComplete="off"
              helpText="Shown next to the file in this slot, so you can tell two uploads apart."
              label="File title"
              name={`slot-title-${slotKey}`}
              onChange={setTitle}
              value={title}
            />
            <InlineStack gap="200" wrap>
              <Button loading={busy === "file"} onClick={handleUpload} variant="primary">
                {busy === "file" ? "Uploading..." : "Upload to this slot"}
              </Button>
              <Button
                disabled={busy !== null}
                onClick={() => {
                  setFile(null);
                  setTitle("");
                  setError(null);
                }}
              >
                Choose a different file
              </Button>
            </InlineStack>
          </BlockStack>
        ) : null}

        <BlockStack gap="200">
          <TextField
            autoComplete="off"
            helpText="No PDF? A carrier tracking page or a hosted policy page can go in this slot instead."
            label="Or add a link"
            name={`slot-link-${slotKey}`}
            onChange={(value) => {
              setLinkUrl(value);
              setLinkError(null);
            }}
            placeholder="https://tracking.carrier.com/..."
            type="url"
            value={linkUrl}
            error={linkError ?? undefined}
          />
          {linkUrl.trim() ? (
            <TextField
              autoComplete="off"
              label="Link title"
              name={`slot-link-title-${slotKey}`}
              onChange={setLinkTitle}
              placeholder={`${slotLabel} link`}
              value={linkTitle}
            />
          ) : null}
          <InlineStack>
            <Button disabled={busy === "file"} loading={busy === "link"} onClick={handleSaveLink}>
              {busy === "link" ? "Saving..." : "Save link"}
            </Button>
          </InlineStack>
        </BlockStack>

        <span aria-live="polite" className="copy-status" role="status">
          {message ?? ""}
        </span>
      </BlockStack>
    </Box>
  );
}

export type EvidenceFileSlotsProps = {
  /** Needed to upload into a slot: POSTs go to /api/disputes/[id]/evidence. */
  disputeId: string;
  items: EvidenceFileRef[];
  /** Slot keys this dispute's reason code makes decisive. */
  prioritySlotKeys?: string[];
  onSelectionChange?: (selection: Record<string, string | null>) => void;
  /**
   * Checklist gaps, rendered against the slot that would close them rather than
   * in a coaching tab elsewhere.
   */
  gaps?: EvidenceGapInsight[];
  /**
   * The dispute is decided or already submitted. Nothing here may change the
   * record: no uploads, no re-picking which file goes in which slot.
   */
  locked?: boolean;
};

export function EvidenceFileSlots({
  disputeId,
  items,
  prioritySlotKeys = [],
  onSelectionChange,
  gaps = [],
  locked = false
}: EvidenceFileSlotsProps) {
  // Only the identity of the uploaded files matters for re-seeding the picks;
  // re-rendering for any other reason must not discard the merchant's choices.
  const itemSignature = items.map((item) => item.id).join(" ");
  const [selection, setSelection] = useState<Record<string, string | null>>(() => defaultSelection(items));
  const lastSignature = useRef(itemSignature);

  useEffect(() => {
    if (lastSignature.current !== itemSignature) {
      lastSignature.current = itemSignature;
      setSelection(defaultSelection(items));
    }
    // `items` is intentionally excluded: a new array with the same files is not
    // a reason to throw away the merchant's selections.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemSignature]);

  useEffect(() => {
    onSelectionChange?.(selection);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  const selected = EVIDENCE_FILE_SLOTS.map((slot) => selection[slot.key])
    .filter((id): id is string => Boolean(id))
    .map((id) => byId.get(id))
    .filter((item): item is EvidenceFileRef => Boolean(item));

  const usableSelected = selected.filter(isUsable);
  // Links are not "unusable files" — they are simply not files, and lumping
  // them into the format warning tells the merchant to convert something that
  // was never convertible.
  const unusableSelected = selected.filter((item) => !isUsable(item) && !isLinkOnly(item));
  const unknownSizeCount = usableSelected.filter(
    (item) => item.fileSizeBytes === null || item.fileSizeBytes === undefined
  ).length;

  const totalBytes = usableSelected.reduce((sum, item) => sum + (item.fileSizeBytes ?? 0), 0);
  const overBudget = totalBytes > MAX_TOTAL_EVIDENCE_BYTES;
  const percent = Math.min(100, Math.round((totalBytes / MAX_TOTAL_EVIDENCE_BYTES) * 100));

  /**
   * Uploads are policed against a different number than the selection budget
   * above: the server counts EVERY file already uploaded to this dispute,
   * selected or not. Mirroring that here means the client rejects exactly what
   * the server would, instead of accepting a file and having it bounce.
   */
  const uploadedBytes = items.reduce((sum, item) => sum + (item.fileSizeBytes ?? 0), 0);
  const remainingUploadBytes = Math.max(0, MAX_TOTAL_EVIDENCE_BYTES - uploadedBytes);

  const slotCategories = EVIDENCE_FILE_SLOTS.flatMap((slot) => slot.categories);
  const unclaimedGaps = gapsOutsideCategories(gaps, slotCategories);

  return (
    <BlockStack gap="400">
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="center" gap="200" wrap>
          <Text as="h3" variant="headingSm">
            Attachment size budget
          </Text>
          <Text as="p" variant="bodyMd" fontWeight="medium">
            {`${formatBytes(totalBytes)} of ${MAX_TOTAL_EVIDENCE_LABEL} used`}
          </Text>
        </InlineStack>
        <ProgressBar progress={percent} tone={overBudget ? "critical" : "primary"} />
        <Text as="p" variant="bodySm" tone="subdued">
          {`Shopify rejects packets over ${MAX_TOTAL_EVIDENCE_LABEL} in total. That is the total across every slot, not per file. It accepts ${ACCEPTED_TYPES_SENTENCE} only.`}
        </Text>
        <Text as="p" variant="bodySm" tone="subdued">
          {remainingUploadBytes > 0
            ? `${formatBytes(remainingUploadBytes)} left to upload — everything you have uploaded to this dispute counts against the same ${MAX_TOTAL_EVIDENCE_LABEL}, whether or not it is selected below.`
            : `Nothing left to upload: this dispute already holds ${MAX_TOTAL_EVIDENCE_LABEL} of files. Remove one before adding another.`}
        </Text>

        {overBudget ? (
          <Banner tone="critical" title="This packet is over Shopify's total size limit">
            <p>
              {`The files you have selected come to ${formatBytes(totalBytes)}, which is ${formatBytes(
                totalBytes - MAX_TOTAL_EVIDENCE_BYTES
              )} over the ${MAX_TOTAL_EVIDENCE_LABEL} limit. Shopify will reject the whole submission, not just the last file. Deselect a slot, or replace a file with a smaller PDF or a compressed image.`}
            </p>
          </Banner>
        ) : null}

        {unusableSelected.length > 0 ? (
          <Banner tone="warning" title="Some selected files cannot be attached">
            <p>
              {`${unusableSelected.length === 1 ? "One file is" : `${unusableSelected.length} files are`} in a format Shopify does not accept. Convert ${
                unusableSelected.length === 1 ? "it" : "them"
              } to ${ACCEPTED_TYPES_SENTENCE} and upload again — ${
                unusableSelected.length === 1 ? "it is" : "they are"
              } not counted in the budget above because ${
                unusableSelected.length === 1 ? "it cannot" : "they cannot"
              } be submitted at all.`}
            </p>
          </Banner>
        ) : null}

        {unknownSizeCount > 0 ? (
          <Text as="p" variant="bodySm" tone="subdued">
            {`${unknownSizeCount === 1 ? "One selected file has" : `${unknownSizeCount} selected files have`} no recorded size, so the total above may be low.`}
          </Text>
        ) : null}
      </BlockStack>

      <BlockStack gap="300">
        {EVIDENCE_FILE_SLOTS.map((slot) => {
          const matches = matchesForSlot(items, slot.categories);
          const selectedId = selection[slot.key] ?? null;
          const selectedItem = selectedId ? (byId.get(selectedId) ?? null) : null;
          const isPriority = prioritySlotKeys.includes(slot.key);
          const selectedUsable = selectedItem ? isUsable(selectedItem) : false;
          const slotGaps = gapsForCategories(gaps, slot.categories);

          const statusBadge = selectedItem ? (
            selectedUsable ? (
              <Badge tone="success">Ready</Badge>
            ) : isLinkOnly(selectedItem) ? (
              <Badge tone="attention">Link, not a file</Badge>
            ) : (
              <Badge tone="critical">Unusable file</Badge>
            )
          ) : isPriority ? (
            <Badge tone="attention">Needed</Badge>
          ) : (
            <Badge>Empty</Badge>
          );

          return (
            <Box
              background="bg-surface"
              borderColor={isPriority ? "border-emphasis" : "border"}
              borderRadius="300"
              borderWidth="025"
              key={slot.key}
              padding="400"
            >
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="start" gap="300" wrap>
                  <BlockStack gap="100">
                    <Text as="h4" variant="headingSm">
                      {slot.label}
                    </Text>
                    <InlineStack gap="150" blockAlign="center" wrap>
                      <Text as="span" variant="bodySm" tone="subdued">
                        Shopify field
                      </Text>
                      <span className="shopify-field-key">{slot.key}</span>
                    </InlineStack>
                  </BlockStack>
                  <InlineStack gap="200" blockAlign="center" wrap>
                    {statusBadge}
                    {isPriority ? <Badge tone="attention">Decisive here</Badge> : null}
                  </InlineStack>
                </InlineStack>

                <Text as="p" variant="bodySm" tone="subdued">
                  {slot.prompt}
                </Text>

                {/*
                  The coaching for this slot, attached to the slot. Hidden on a
                  locked dispute: "here is how to go and get it" is wrong advice
                  for a case that can no longer be changed - the closed record
                  of what was missing lives under Case and history instead.
                */}
                {!locked
                  ? slotGaps.map((gap) => (
                      <EvidenceGapHint gap={gap} idPrefix={`slot-${slot.key}`} key={`${slot.key}-${gap.category}`} />
                    ))
                  : null}

                {matches.length === 0 ? (
                  <BlockStack gap="100">
                    <Text as="p" variant="bodySm" fontWeight="medium">
                      Nothing in this slot yet
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {locked
                        ? `This slot went to Shopify empty. It takes ${slot.categories
                            .map((category) => category.replaceAll("_", " ").toLowerCase())
                            .join(" or ")}.`
                        : `Add a file or a link below. Anything already saved to your evidence library under ${slot.categories
                            .map((category) => category.replaceAll("_", " ").toLowerCase())
                            .join(" or ")} appears here too.`}
                    </Text>
                    {isPriority ? (
                      <Text as="p" variant="bodySm">
                        This dispute&rsquo;s reason code turns on this file. It is the gap worth closing first.
                      </Text>
                    ) : null}
                  </BlockStack>
                ) : (
                  <BlockStack gap="200">
                    {matches.length > 1 ? (
                      <Text as="p" variant="bodySm" fontWeight="medium">
                        {`${matches.length} files match this slot, Shopify accepts 1. Pick the strongest one — the rest stay in your evidence library and are not submitted.`}
                      </Text>
                    ) : null}

                    <ChoiceList
                      disabled={locked}
                      choices={[
                        ...matches.map((item) => ({
                          value: item.id,
                          label: item.title,
                          helpText: isLinkOnly(item) ? (
                            <>
                              {`Link · ${item.fileUrl} — Shopify's file slot takes a file, so quote this link in your response text instead. It still counts as evidence, and it uses none of the ${MAX_TOTAL_EVIDENCE_LABEL}.`}
                            </>
                          ) : (
                            <>
                              {`${describeMime(item.fileMimeType)} · ${
                                item.fileSizeBytes === null || item.fileSizeBytes === undefined
                                  ? "size unknown"
                                  : formatBytes(item.fileSizeBytes)
                              }`}
                              {isUsable(item)
                                ? null
                                : ` · Shopify cannot accept this file: it is ${describeMime(
                                    item.fileMimeType
                                  )} and only ${ACCEPTED_TYPES_SENTENCE} are allowed.`}
                            </>
                          )
                        })),
                        { value: NO_FILE, label: "Leave this slot empty" }
                      ]}
                      name={`slot-${slot.key}`}
                      onChange={(next) => {
                        const [value] = next;
                        setSelection((previous) => ({
                          ...previous,
                          [slot.key]: value === NO_FILE ? null : (value ?? null)
                        }));
                      }}
                      selected={[selectedId ?? NO_FILE]}
                      title={`File for ${slot.label}`}
                      titleHidden
                    />

                    {selectedItem && !selectedUsable ? (
                      isLinkOnly(selectedItem) ? (
                        <Text as="p" variant="bodySm">
                          {`"${selectedItem.title}" is a link, so this slot goes to Shopify empty. Paste the link into your response text, or save a PDF or screenshot of the page here as well.`}
                        </Text>
                      ) : (
                        <Text as="p" variant="bodySm" tone="critical">
                          {`"${selectedItem.title}" is ${describeMime(
                            selectedItem.fileMimeType
                          )}. Shopify accepts ${ACCEPTED_TYPES_SENTENCE} only, so this slot will go in empty unless you convert the file and upload it again.`}
                        </Text>
                      )
                    ) : null}

                    {selectedItem?.fileUrl ? (
                      <BlockStack gap="100">
                        {/*
                          Shopify's slot is a file picker with no URL field, so
                          the merchant needs the bytes on their own disk before
                          they can attach anything. Download leads for that
                          reason; the link is for quoting the file in the
                          response text, where Shopify has no slot for it.
                        */}
                        <Text as="p" variant="bodySm" tone="subdued">
                          Download this, then attach it in Shopify under
                          {` "${slot.label}"`}.
                        </Text>
                        <EvidenceFileActions fileUrl={selectedItem.fileUrl} title={selectedItem.title} />
                      </BlockStack>
                    ) : null}
                  </BlockStack>
                )}

                {locked ? null : (
                  <SlotUploader
                    category={slot.categories[0] ?? "OTHER"}
                    disputeId={disputeId}
                    remainingBytes={remainingUploadBytes}
                    slotKey={slot.key}
                    slotLabel={slot.label}
                  />
                )}
              </BlockStack>
            </Box>
          );
        })}

        {/*
          A checklist gap whose category no Shopify slot accepts still has to be
          said out loud - it belongs in the response text rather than in a file
          slot, and dropping it silently is how it gets forgotten.
        */}
        {!locked && unclaimedGaps.length > 0 ? (
          <BlockStack gap="200">
            <Text as="h4" variant="headingSm">
              Still missing, with no Shopify file slot of its own
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Shopify has no attachment slot for these. Work them into the response text above instead.
            </Text>
            {unclaimedGaps.map((gap) => (
              <EvidenceGapHint gap={gap} idPrefix="unslotted" key={gap.category} />
            ))}
          </BlockStack>
        ) : null}
      </BlockStack>
    </BlockStack>
  );
}
