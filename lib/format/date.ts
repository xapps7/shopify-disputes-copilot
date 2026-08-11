/**
 * Shared, deterministic date + deadline formatting.
 *
 * Every date in the app used to be rendered with bare
 * `new Date(value).toLocaleDateString()` inside "use client" components that
 * Next.js also renders on the server. That produced two defects:
 *   1. a hydration mismatch (server locale/timezone != browser locale/timezone);
 *   2. deadlines that could read one day off, because the server and the
 *      browser were bucketing the same instant into different calendar days.
 *
 * Both the locale and the timezone are therefore explicit and default to UTC.
 * Dispute deadlines come off Shopify as UTC instants, so UTC is the only
 * bucketing that is stable everywhere.
 */

export const DATE_LOCALE = "en-US";
export const DEFAULT_TIME_ZONE = "UTC";

const MS_PER_DAY = 86_400_000;

export type DateInput = string | number | Date | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "Mar 25, 2026" — or `fallback` when there is no usable date. */
export function formatDate(
  value: DateInput,
  options: { timeZone?: string; fallback?: string } = {}
): string {
  const { timeZone = DEFAULT_TIME_ZONE, fallback = "—" } = options;
  const date = toDate(value);

  if (!date) {
    return fallback;
  }

  return new Intl.DateTimeFormat(DATE_LOCALE, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone
  }).format(date);
}

/** "Mar 25, 2026, 14:03 UTC" — or `fallback` when there is no usable date. */
export function formatDateTime(
  value: DateInput,
  options: { timeZone?: string; fallback?: string } = {}
): string {
  const { timeZone = DEFAULT_TIME_ZONE, fallback = "—" } = options;
  const date = toDate(value);

  if (!date) {
    return fallback;
  }

  return new Intl.DateTimeFormat(DATE_LOCALE, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
    timeZoneName: "short"
  }).format(date);
}

/**
 * Calendar-day index of an instant in a given timezone. Comparing day indexes
 * (rather than subtracting raw milliseconds) is what makes "due today" mean the
 * same thing at 00:30 and at 23:30.
 */
function dayIndex(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone
  }).formatToParts(date);

  const lookup = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");

  return Date.UTC(lookup("year"), lookup("month") - 1, lookup("day")) / MS_PER_DAY;
}

/**
 * Whole calendar days between now and the deadline. `null` when there is no
 * deadline — callers must handle that explicitly instead of defaulting to
 * `Date.now()`, which silently made every deadline-less dispute look urgent.
 */
export function daysUntil(
  value: DateInput,
  now: DateInput = new Date(),
  timeZone: string = DEFAULT_TIME_ZONE
): number | null {
  const due = toDate(value);
  const reference = toDate(now) ?? new Date();

  if (!due) {
    return null;
  }

  return dayIndex(due, timeZone) - dayIndex(reference, timeZone);
}

export type DeadlineState = "none" | "overdue" | "today" | "soon" | "upcoming";

export type DeadlineDescription = {
  state: DeadlineState;
  /** Explicit text so urgency is never conveyed by colour alone. */
  label: string;
  /** Polaris Badge tone. `undefined` renders the neutral default badge. */
  tone: "critical" | "warning" | "info" | undefined;
  daysRemaining: number | null;
  isUrgent: boolean;
  dateLabel: string;
};

/** Deadlines within this many days are treated as urgent. */
export const URGENT_WITHIN_DAYS = 2;

/**
 * The single source of truth for deadline urgency.
 *
 * A missing deadline is its own state ("No deadline"), never urgent.
 */
export function describeDeadline(
  value: DateInput,
  now: DateInput = new Date(),
  timeZone: string = DEFAULT_TIME_ZONE
): DeadlineDescription {
  const days = daysUntil(value, now, timeZone);
  const dateLabel = formatDate(value, { timeZone, fallback: "No deadline" });

  if (days === null) {
    return {
      state: "none",
      label: "No deadline",
      tone: undefined,
      daysRemaining: null,
      isUrgent: false,
      dateLabel
    };
  }

  if (days < 0) {
    const overdueBy = Math.abs(days);
    return {
      state: "overdue",
      label: overdueBy === 1 ? "Overdue by 1 day" : `Overdue by ${overdueBy} days`,
      tone: "critical",
      daysRemaining: days,
      isUrgent: true,
      dateLabel
    };
  }

  if (days === 0) {
    return {
      state: "today",
      label: "Due today",
      tone: "critical",
      daysRemaining: 0,
      isUrgent: true,
      dateLabel
    };
  }

  return {
    state: days <= URGENT_WITHIN_DAYS ? "soon" : "upcoming",
    label: days === 1 ? "Due in 1 day" : `Due in ${days} days`,
    tone: days <= URGENT_WITHIN_DAYS ? "warning" : "info",
    daysRemaining: days,
    isUrgent: days <= URGENT_WITHIN_DAYS,
    dateLabel
  };
}

/** True only when a deadline exists and falls inside the urgency window. */
export function isDueSoon(
  value: DateInput,
  now: DateInput = new Date(),
  timeZone: string = DEFAULT_TIME_ZONE
): boolean {
  return describeDeadline(value, now, timeZone).isUrgent;
}
