/**
 * Shared money formatting.
 *
 * Two bugs this replaces:
 *   1. `$${amount}` — a hardcoded dollar sign regardless of the dispute currency.
 *   2. `${currencyCode ?? "USD"} ${amount}` — raw output like "USD 129.5".
 *
 * The locale is pinned so server and client renders agree (these values are
 * rendered inside "use client" components that Next.js also renders on the
 * server, so `Intl` defaults would produce a hydration mismatch).
 */

export const MONEY_LOCALE = "en-US";

/** Rendered when there is no amount to show at all. */
export const EMPTY_MONEY = "—";

export type MoneyInput = string | number | null | undefined;

function toNumber(amount: MoneyInput): number | null {
  if (amount === null || amount === undefined) {
    return null;
  }

  if (typeof amount === "number") {
    return Number.isFinite(amount) ? amount : null;
  }

  const trimmed = amount.trim();
  if (trimmed === "") {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeCurrency(currencyCode: string | null | undefined): string | null {
  if (!currencyCode) {
    return null;
  }

  const normalized = currencyCode.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : null;
}

/**
 * Formats an amount in its own currency, e.g. "$129.50", "€129.50", "¥130".
 *
 * - `null`/`undefined`/unparseable amounts render as `EMPTY_MONEY` ("—"), never
 *   as "0" — a missing amount and a zero amount are not the same thing.
 * - A missing or non-ISO currency code falls back to a plain number so we never
 *   silently claim an amount is USD.
 */
export function formatMoney(amount: MoneyInput, currencyCode?: string | null): string {
  const value = toNumber(amount);

  if (value === null) {
    return EMPTY_MONEY;
  }

  const currency = normalizeCurrency(currencyCode);

  if (!currency) {
    return new Intl.NumberFormat(MONEY_LOCALE, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  }

  try {
    return new Intl.NumberFormat(MONEY_LOCALE, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol"
    }).format(value);
  } catch {
    // Unknown-but-well-formed codes (or runtimes without narrowSymbol) still
    // need to render something honest.
    return `${currency} ${new Intl.NumberFormat(MONEY_LOCALE, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value)}`;
  }
}

export type CurrencyTotal = {
  currencyCode: string | null;
  total: number;
  count: number;
};

type MoneyRecord = {
  amount: MoneyInput;
  currencyCode?: string | null;
};

/**
 * Groups amounts by currency instead of adding them together. Summing mixed
 * currencies into a single number is meaningless, so the UI shows one total per
 * currency.
 */
export function sumByCurrency(records: ReadonlyArray<MoneyRecord>): CurrencyTotal[] {
  const totals = new Map<string, CurrencyTotal>();

  for (const record of records) {
    const value = toNumber(record.amount);
    if (value === null) {
      continue;
    }

    const currency = normalizeCurrency(record.currencyCode);
    const key = currency ?? "";
    const existing = totals.get(key);

    if (existing) {
      existing.total += value;
      existing.count += 1;
    } else {
      totals.set(key, { currencyCode: currency, total: value, count: 1 });
    }
  }

  return [...totals.values()].sort((a, b) => {
    if (b.total !== a.total) {
      return b.total - a.total;
    }
    return (a.currencyCode ?? "").localeCompare(b.currencyCode ?? "");
  });
}

/**
 * Renders per-currency totals as separate labelled values, e.g.
 * "$1,240.00 + €310.00". Never collapses currencies into one figure.
 */
export function formatCurrencyTotals(totals: ReadonlyArray<CurrencyTotal>): string {
  if (totals.length === 0) {
    return EMPTY_MONEY;
  }

  return totals.map((entry) => formatMoney(entry.total, entry.currencyCode)).join(" + ");
}
