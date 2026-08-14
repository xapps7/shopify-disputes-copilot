/**
 * Shopify Payments chargeback fees.
 *
 * Published per country, flat within a country (unlike processing rates, this
 * does not vary by plan). Source:
 * https://help.shopify.com/en/manual/payments/chargebacks/chargeback-process
 *
 * Two traps encoded here because they silently corrupt any money model:
 *   - Ireland adds 23% VAT on top of the EUR fee.
 *   - Several countries are dual-currency (Canada, the Nordics, CEE,
 *     Switzerland) and charge in whichever currency the payout is in.
 */

export type FeeQuote = {
  amount: number;
  currencyCode: string;
  /** True when we matched the currency exactly rather than falling back. */
  exact: boolean;
  note: string | null;
};

const FEES_BY_CURRENCY: Record<string, number> = {
  USD: 15,
  CAD: 15,
  GBP: 10,
  EUR: 15,
  AUD: 25,
  NZD: 20,
  JPY: 1300,
  HKD: 85,
  SGD: 16.35,
  MXN: 200,
  DKK: 115,
  SEK: 150,
  NOK: 200,
  CHF: 15,
  CZK: 400,
  PLN: 75,
  HUF: 7000,
  RON: 75
};

/** Country overrides where the country, not the currency, sets the fee. */
const COUNTRY_OVERRIDES: Record<string, { amount: number; currencyCode: string; note: string }> = {
  // Gibraltar pays £15, not the £10 the rest of GBP does.
  GI: { amount: 15, currencyCode: "GBP", note: "Gibraltar is charged £15, not the standard £10." },
  IE: {
    amount: 15 * 1.23,
    currencyCode: "EUR",
    note: "Ireland adds 23% VAT to the €15 fee."
  }
};

export function chargebackFee(currencyCode: string | null, countryCode?: string | null): FeeQuote {
  const country = countryCode?.trim().toUpperCase();

  if (country && COUNTRY_OVERRIDES[country]) {
    const override = COUNTRY_OVERRIDES[country];
    return { amount: override.amount, currencyCode: override.currencyCode, exact: true, note: override.note };
  }

  const currency = currencyCode?.trim().toUpperCase();

  if (currency && FEES_BY_CURRENCY[currency] !== undefined) {
    return { amount: FEES_BY_CURRENCY[currency], currencyCode: currency, exact: true, note: null };
  }

  return {
    amount: FEES_BY_CURRENCY.USD,
    currencyCode: "USD",
    exact: false,
    note: `No published fee for ${currency ?? "this currency"}; showing the US figure as an estimate.`
  };
}

/**
 * Whether the fee comes back on a win.
 *
 * Shopify's own pages disagree: two say the fee is returned unconditionally, a
 * third says Shopify "might refund the chargeback fee depending on your country
 * or region". Stripe - whose infrastructure sits underneath - says its dispute
 * fee is never returned outside Mexico. Given that conflict, the honest model is
 * "likely but not guaranteed", and we never let it inflate an expected value.
 */
export const FEE_RECOVERY_ON_WIN = {
  assumeRecovered: false,
  note:
    "Shopify's documentation is inconsistent about whether the chargeback fee is refunded when you win, so this figure excludes it. If your region does refund it, you recover slightly more than shown."
} as const;
