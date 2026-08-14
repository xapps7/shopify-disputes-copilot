"use client";

import { useEffect, useState } from "react";
import { Badge, BlockStack, Box, InlineStack, Text } from "@shopify/polaris";

import { DATE_LOCALE, DEFAULT_TIME_ZONE, describeDeadline, formatDate } from "@/lib/format/date";

/**
 * The deadline, told the way it actually behaves.
 *
 * Shopify Admin has no disputes screen and sends no deadline notification. What
 * it does do is auto-submit a response at the deadline using whatever thin
 * default data it holds. So the deadline is not a due date the merchant can
 * miss quietly - it is the moment Shopify speaks on their behalf. Every label
 * below says that out loud instead of saying "Due in 3 days", which reads as
 * "nothing happens if you are late".
 */

/**
 * `Date.now()` differs between the server render and the browser render, so any
 * urgency label derived from it is a hydration mismatch waiting to happen. The
 * clock is therefore only read after mount; until then components render the
 * deadline date, which is fully deterministic.
 */
export function useNow(): number | null {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
  }, []);

  return now;
}

/** How hard the UI should push. `sent` is past tense: the damage is done. */
export type AutoSubmitSeverity = "none" | "sent" | "critical" | "warning" | "calm";

export type AutoSubmitDescription = {
  severity: AutoSubmitSeverity;
  /** The headline sentence, e.g. "Shopify sends your response in 3 days". */
  label: string;
  /** Short form for tight spaces (table cells), e.g. "Shopify sends in 3 days". */
  shortLabel: string;
  /** Polaris Badge tone. Colour never carries the meaning on its own. */
  tone: "critical" | "warning" | "info" | undefined;
  /** True inside the 48-hour window, or already past it. */
  isUrgent: boolean;
  daysRemaining: number | null;
  /** "Aug 17, 2026" — the deadline itself, always shown alongside the label. */
  dateLabel: string;
  /** "Aug 17" — for inline prose. */
  shortDateLabel: string;
};

/** Deadlines this close (or closer) get the escalated treatment. */
export const AUTO_SUBMIT_URGENT_DAYS = 2;

function formatShortDate(value: string | null): string {
  if (!value) {
    return "the deadline";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "the deadline";
  }

  return new Intl.DateTimeFormat(DATE_LOCALE, {
    month: "short",
    day: "numeric",
    timeZone: DEFAULT_TIME_ZONE
  }).format(date);
}

/**
 * The single source of truth for auto-submit copy. `now === null` (pre-mount)
 * is deliberately not handled here: callers render the date only until the
 * clock is readable, so nothing about urgency is guessed during SSR.
 */
export function describeAutoSubmit(dueBy: string | null, now: number): AutoSubmitDescription {
  const deadline = describeDeadline(dueBy, now);
  const dateLabel = formatDate(dueBy, { fallback: "No deadline" });
  const shortDateLabel = formatShortDate(dueBy);
  const days = deadline.daysRemaining;

  if (days === null) {
    return {
      severity: "none",
      label: "No auto-submit date on this dispute",
      shortLabel: "No auto-submit date",
      tone: undefined,
      isUrgent: false,
      daysRemaining: null,
      dateLabel,
      shortDateLabel
    };
  }

  if (days < 0) {
    return {
      severity: "sent",
      label: "Shopify sent an automatic response",
      shortLabel: "Shopify already responded",
      tone: "critical",
      isUrgent: true,
      daysRemaining: days,
      dateLabel,
      shortDateLabel
    };
  }

  if (days === 0) {
    return {
      severity: "critical",
      label: "Shopify sends your response today",
      shortLabel: "Shopify sends today",
      tone: "critical",
      isUrgent: true,
      daysRemaining: 0,
      dateLabel,
      shortDateLabel
    };
  }

  if (days === 1) {
    return {
      severity: "critical",
      label: "Shopify sends your response tomorrow",
      shortLabel: "Shopify sends tomorrow",
      tone: "critical",
      isUrgent: true,
      daysRemaining: 1,
      dateLabel,
      shortDateLabel
    };
  }

  if (days <= AUTO_SUBMIT_URGENT_DAYS) {
    return {
      severity: "warning",
      label: `Shopify sends your response in ${days} days`,
      shortLabel: `Shopify sends in ${days} days`,
      tone: "warning",
      isUrgent: true,
      daysRemaining: days,
      dateLabel,
      shortDateLabel
    };
  }

  return {
    severity: "calm",
    label: `Shopify sends your response in ${days} days`,
    shortLabel: `Shopify sends in ${days} days`,
    tone: "info",
    isUrgent: false,
    daysRemaining: days,
    dateLabel,
    shortDateLabel
  };
}

type DeadlineBadgeProps = {
  dueBy: string | null;
  /** Pass a shared `useNow()` value when several badges appear in one list. */
  now?: number | null;
  layout?: "stacked" | "inline";
};

/**
 * The compact form, for table cells: the date plus one short sentence naming
 * what Shopify will do on it. Colour alone never carries the urgency.
 */
export function DeadlineBadge({ dueBy, now = null, layout = "stacked" }: DeadlineBadgeProps) {
  const dateLabel = formatDate(dueBy, { fallback: "No deadline" });

  if (!dueBy) {
    return (
      <Text as="span" variant="bodySm" tone="subdued">
        No auto-submit date
      </Text>
    );
  }

  const autoSubmit = now === null ? null : describeAutoSubmit(dueBy, now);
  const urgency = autoSubmit ? <Badge tone={autoSubmit.tone}>{autoSubmit.shortLabel}</Badge> : null;

  if (layout === "inline") {
    return (
      <InlineStack gap="150" blockAlign="center" wrap>
        <Text as="span" variant="bodySm">
          {dateLabel}
        </Text>
        {urgency}
      </InlineStack>
    );
  }

  return (
    <BlockStack gap="100">
      <Text as="span" variant="bodySm">
        {dateLabel}
      </Text>
      {urgency}
    </BlockStack>
  );
}

const SEVERITY_BORDER: Record<AutoSubmitSeverity, "border-critical" | "border-caution" | "border"> = {
  none: "border",
  sent: "border-critical",
  critical: "border-critical",
  warning: "border-caution",
  calm: "border"
};

const SEVERITY_BACKGROUND: Record<
  AutoSubmitSeverity,
  "bg-surface-critical" | "bg-surface-caution" | "bg-surface-secondary"
> = {
  none: "bg-surface-secondary",
  sent: "bg-surface-critical",
  critical: "bg-surface-critical",
  warning: "bg-surface-caution",
  calm: "bg-surface-secondary"
};

export type AutoSubmitCountdownProps = {
  dueBy: string | null;
  /** Pass a shared `useNow()` value when several countdowns appear together. */
  now?: number | null;
  /**
   * What Shopify holds right now, in the merchant's words. Nothing typed in
   * this app reaches Shopify until it is pasted into their form, so the honest
   * default is the thin record Shopify already has.
   */
  whatShopifyHasNow?: string | null;
  /** Rendered under the copy — a link into the case, a button, a countdown list. */
  action?: React.ReactNode;
  /** "detailed" adds the consequence line; "compact" is heading + date only. */
  size?: "detailed" | "compact";
};

const DEFAULT_HELD_EVIDENCE = "tracking data and nothing else";

/**
 * The fuller countdown, for the dispute page and the overview. It answers the
 * two questions a merchant has: when does Shopify speak for me, and what will
 * it say if I do nothing.
 */
export function AutoSubmitCountdown({
  dueBy,
  now = null,
  whatShopifyHasNow,
  action,
  size = "detailed"
}: AutoSubmitCountdownProps) {
  const autoSubmit = now === null || !dueBy ? null : describeAutoSubmit(dueBy, now);
  const severity: AutoSubmitSeverity = autoSubmit?.severity ?? "none";
  const dateLabel = formatDate(dueBy, { fallback: "No deadline recorded" });
  const shortDateLabel = formatShortDate(dueBy);
  const held = whatShopifyHasNow?.trim() || DEFAULT_HELD_EVIDENCE;

  // Pre-mount, and for disputes with no deadline, the heading states the fact
  // rather than guessing at urgency.
  const heading = autoSubmit
    ? autoSubmit.label
    : dueBy
      ? `Shopify sends your response on ${dateLabel}`
      : "No auto-submit date on this dispute";

  const consequence = !dueBy
    ? "Shopify has not published a deadline for this one yet. Treat it as live: once a deadline appears, Shopify submits on it whether or not you have written anything."
    : severity === "sent"
      ? `Shopify already submitted on ${shortDateLabel}, using ${held}. Anything you add now only helps if the bank is still reviewing — check the status before spending time on it.`
      : `Shopify will submit whatever it has on ${shortDateLabel}. Right now that's ${held}.`;

  return (
    <Box
      background={SEVERITY_BACKGROUND[severity]}
      borderColor={SEVERITY_BORDER[severity]}
      borderRadius="300"
      borderWidth="025"
      padding="400"
    >
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="start" gap="300" wrap>
          <BlockStack gap="100">
            <Text as="h3" variant="headingMd">
              {heading}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {dueBy ? `Auto-submit date: ${dateLabel}` : "No deadline recorded"}
            </Text>
          </BlockStack>
          {autoSubmit && autoSubmit.isUrgent ? (
            <Badge tone={autoSubmit.tone}>
              {severity === "sent" ? "Response already sent" : "Acts without you"}
            </Badge>
          ) : null}
        </InlineStack>

        {size === "detailed" ? (
          <Text as="p" variant="bodyMd">
            {consequence}
          </Text>
        ) : null}

        {action}
      </BlockStack>
    </Box>
  );
}
