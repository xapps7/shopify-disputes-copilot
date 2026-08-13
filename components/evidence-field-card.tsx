"use client";

import { useEffect, useRef, useState } from "react";
import { Badge, BlockStack, Box, Button, InlineStack, Text, TextField } from "@shopify/polaris";
import { ClipboardIcon } from "@shopify/polaris-icons";

import { copyToClipboard } from "@/components/copy-to-clipboard";
import type { EvidenceFieldKey, EvidenceFieldState, FieldSource } from "@/lib/disputes/evidence-fields";

/**
 * One box on Shopify's evidence form.
 *
 * The merchant is looking at two screens: this one and Shopify Admin. So the
 * card names the Shopify field it maps to, says where its text came from, and
 * puts Copy where the thumb already is. Nothing here persists anything - it
 * reports upward and lets the parent own saving.
 */

/**
 * How tall each box should be. Declared as a total record so a new field key in
 * `EvidenceFieldKey` fails the typecheck here rather than silently rendering a
 * one-line input for a paragraph of text. `1` means single line.
 */
const FIELD_ROWS: Record<EvidenceFieldKey, number> = {
  customerFirstName: 1,
  customerLastName: 1,
  customerEmailAddress: 1,
  shippingAddress: 3,
  accessActivityLog: 5,
  refundPolicyDisclosure: 4,
  refundRefusalExplanation: 4,
  cancellationPolicyDisclosure: 4,
  cancellationRebuttal: 4,
  uncategorizedText: 8
};

const SOURCE_LABEL: Record<FieldSource, string> = {
  auto: "Filled from your order",
  drafted: "Draft — review this",
  merchant: "Your text"
};

type FieldStatus = EvidenceFieldState["status"];

const STATUS_LABEL: Record<FieldStatus, string> = {
  ready: "Ready",
  needed: "Needed",
  optional: "Optional"
};

/** `undefined` renders Polaris' neutral badge, which is the subdued one. */
const STATUS_TONE: Record<FieldStatus, "success" | "attention" | undefined> = {
  ready: "success",
  needed: "attention",
  optional: undefined
};

type CopyState = "idle" | "copied" | "failed";

export type EvidenceFieldCardProps = {
  field: EvidenceFieldState;
  /** Fires on every keystroke. The parent debounces and persists. */
  onChange: (key: EvidenceFieldKey, value: string) => void;
  /** Lets a page-level live region repeat the confirmation, if the parent has one. */
  onCopied?: (message: string) => void;
};

export function EvidenceFieldCard({ field, onChange, onCopied }: EvidenceFieldCardProps) {
  const [value, setValue] = useState(field.value);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  /**
   * Tracks the last value that arrived from the server so a re-render with the
   * same props never overwrites what the merchant is mid-way through typing.
   */
  const externalValue = useRef(field.value);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (field.value !== externalValue.current) {
      externalValue.current = field.value;
      setValue(field.value);
    }
  }, [field.value]);

  useEffect(
    () => () => {
      if (copyTimer.current) {
        clearTimeout(copyTimer.current);
      }
    },
    []
  );

  const trimmed = value.trim();
  // Recomputed locally so the badge answers to what is in the box right now,
  // not to the status the server calculated before this edit.
  const status: FieldStatus = trimmed ? "ready" : field.priority ? "needed" : "optional";
  const rows = FIELD_ROWS[field.key] ?? 4;
  const isMultiline = rows > 1;
  const fieldId = `evidence-field-${field.key}`;

  function handleChange(next: string) {
    setValue(next);
    onChange(field.key, next);
  }

  async function handleCopy() {
    const copied = await copyToClipboard(value);
    setCopyState(copied ? "copied" : "failed");
    onCopied?.(copied ? `Copied ${field.label}` : `Could not copy ${field.label}`);

    if (copyTimer.current) {
      clearTimeout(copyTimer.current);
    }
    copyTimer.current = setTimeout(() => setCopyState("idle"), 4000);
  }

  return (
    <Box
      background="bg-surface"
      borderColor={field.priority ? "border-emphasis" : "border"}
      borderRadius="300"
      borderWidth="025"
      padding="400"
    >
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="start" gap="300" wrap>
          <BlockStack gap="100">
            <Text as="h3" variant="headingSm">
              {field.label}
            </Text>
            <InlineStack gap="150" blockAlign="center" wrap>
              <Text as="span" variant="bodySm" tone="subdued">
                Shopify field
              </Text>
              <span className="shopify-field-key">{field.key}</span>
            </InlineStack>
          </BlockStack>

          <InlineStack gap="200" blockAlign="center" wrap>
            <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
            <Badge tone="info">{SOURCE_LABEL[field.source]}</Badge>
            {field.priority ? <Badge tone="attention">Decisive here</Badge> : null}
          </InlineStack>
        </InlineStack>

        <TextField
          autoComplete="off"
          helpText={field.prompt}
          id={fieldId}
          label={field.label}
          labelHidden
          multiline={isMultiline ? rows : undefined}
          onChange={handleChange}
          placeholder={field.placeholder}
          value={value}
        />

        <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
          <InlineStack gap="200" blockAlign="center">
            <Button
              accessibilityLabel={`Copy ${field.label}`}
              disabled={trimmed.length === 0}
              icon={ClipboardIcon}
              onClick={handleCopy}
            >
              Copy
            </Button>
            {/*
              Always mounted so the change of text content is what gets
              announced. An element that appears only on success is often
              missed by screen readers.
            */}
            <span aria-live="polite" className="copy-status" role="status">
              {copyState === "copied" ? "Copied" : null}
              {copyState === "failed" ? "Copy failed — select the text and copy it manually" : null}
            </span>
          </InlineStack>

          <Text as="p" variant="bodySm" tone="subdued">
            {trimmed.length === 0
              ? "Empty — Shopify will receive nothing for this field"
              : `${trimmed.length} characters`}
          </Text>
        </InlineStack>
      </BlockStack>
    </Box>
  );
}
