import { FEE_RECOVERY_ON_WIN } from "./fees.ts";
import type { DisputePlLine, DisputeProfitAndLoss } from "./dispute-pl.ts";

/**
 * The monthly chargeback statement, as a file a merchant can send to someone.
 *
 * `dispute-pl.ts` already works out what a period cost. This module does the
 * other half of the job, which is getting that number out of the app and into
 * the hands of a bank, an acquirer or a finance team - people who will never
 * log in here and should not have to. That is the whole point: a screen is an
 * opinion, a statement is a record.
 *
 * So the reader we write for is a finance person who has never seen this app,
 * has no idea what a "dispute type" is, and will open the file in Excel. Three
 * consequences run through everything below:
 *
 *   1. THE FILE EXPLAINS ITSELF. A header block names the shop, the period and
 *      the basis of the figures, and a footer states the two things a reader
 *      would otherwise get wrong. A bare grid of numbers with no provenance is
 *      worse than no export, because it will be pasted into a board pack.
 *
 *   2. NOTHING IS SILENTLY MISSING. Settled disputes with no finalisation date
 *      belong to no month, so they are counted and stated rather than dropped.
 *      A month with nothing in it gets a row saying so, rather than vanishing -
 *      "we checked, it was zero" and "we did not look" must not look the same.
 *
 *   3. CURRENCIES STAY APART. Same rule as the P&L itself: there is no exchange
 *      rate in this app, so a blended total would be a guess wearing a number's
 *      clothes. Three currencies means three rows, and the reader adds them up
 *      themselves at a rate they can defend.
 *
 * This module is deliberately Prisma-free and imports nothing aliased with
 * `@/`, so it runs unchanged under `node --experimental-strip-types` in tests.
 */

/** RFC 4180 says CRLF, and Excel is happiest when it gets it. */
const ROW_SEPARATOR = "\r\n";

/** Every value we print, so the grid stays rectangular in any reader. */
const COLUMNS = [
  "Period",
  "Currency",
  "Disputes settled",
  "Won",
  "Lost",
  "Total value disputed",
  "Money kept by winning",
  "Money lost",
  "Fees paid",
  "Fees paid on disputes you won",
  "Net cost",
  "Fee basis"
] as const;

export type DisputePlCsvInput = {
  shopDomain: string;
  /** Covers the whole statement, e.g. "September 2025 to August 2026". */
  periodLabel: string;
  /** One entry per month, printed in the order given. */
  periods: DisputeProfitAndLoss[];
  generatedAt: Date;
};

/**
 * Characters that make a spreadsheet treat a cell as a formula rather than
 * text. `=` and `+` are the obvious ones; `-` and `@` are the two people
 * forget, and `\t` and `\r` are how you smuggle one of the first four past a
 * naive check.
 */
const FORMULA_TRIGGERS = ["=", "+", "-", "@", "\t", "\r"];

/**
 * Stops a text value being executed when the file is opened.
 *
 * A shop domain or a currency code is merchant-controlled data, and Excel and
 * Google Sheets will happily run `=HYPERLINK(...)` out of a cell in a CSV that
 * arrived by email. We are handing this file to a bank, so the bar is that
 * nothing in it can ever be a live formula.
 *
 * The fix is a leading apostrophe, which spreadsheets read as "the rest of this
 * is text". The cost, stated because it is real: some readers show that
 * apostrophe in the cell, so a shop literally called `-example.myshopify.com`
 * displays slightly wrong. A visibly odd label is a much cheaper failure than a
 * formula running in a finance team's spreadsheet, so we take that trade.
 *
 * Note this is applied to TEXT ONLY, never to the money columns. Those are
 * formatted by us from numbers we computed, so they cannot contain a formula,
 * and prefixing a negative figure would turn it into text and quietly break the
 * reader's SUM - a worse outcome than the one we set out to prevent.
 */
function neutraliseFormula(value: string): string {
  return FORMULA_TRIGGERS.some((trigger) => value.startsWith(trigger)) ? `'${value}` : value;
}

/** A text cell: neutralised, then quoted, with embedded quotes doubled. */
function textCell(value: string): string {
  return `"${neutraliseFormula(value).replace(/"/g, '""')}"`;
}

/**
 * A money cell, in the currency's own units, to two decimal places.
 *
 * Left unquoted and unprefixed so it arrives as a number the reader can total.
 * `+ 0` normalises the `-0` that rounding can produce, because "-0.00" in a
 * statement looks like a bug even when it is arithmetically harmless.
 */
function moneyCell(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return (Math.round(safe * 100) / 100 + 0).toFixed(2);
}

function countCell(value: number): string {
  return String(Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0);
}

function row(cells: string[]): string {
  return cells.join(",");
}

function lineCells(periodLabel: string, line: DisputePlLine): string[] {
  return [
    textCell(periodLabel),
    textCell(line.currencyCode),
    countCell(line.settledCount),
    countCell(line.wonCount),
    countCell(line.lostCount),
    moneyCell(line.disputedVolume),
    moneyCell(line.recovered),
    moneyCell(line.lost),
    moneyCell(line.feesPaid),
    moneyCell(line.feesOnWins),
    moneyCell(line.netCost),
    // Said on every row rather than once in a footnote, because this row may be
    // the one that gets copied into someone else's spreadsheet on its own.
    textCell(
      line.feeEstimated
        ? "Estimated - no published Shopify fee for this currency, the US fee was used"
        : "Published Shopify Payments fee for this currency"
    )
  ];
}

/** The row a month with nothing in it gets, so zero cannot be read as absent. */
function emptyPeriodCells(periodLabel: string): string[] {
  return [
    textCell(periodLabel),
    textCell("No settled disputes"),
    "0",
    "0",
    "0",
    "0.00",
    "0.00",
    "0.00",
    "0.00",
    "0.00",
    "0.00",
    textCell("Not applicable")
  ];
}

/**
 * How many settled disputes are in no period at all.
 *
 * `buildDisputeProfitAndLoss` reports this per window, but it is a property of
 * the merchant's book rather than of any one month - run it over twelve months
 * and the same undated disputes are reported twelve times. Summing them would
 * multiply the same handful of records by the number of months in the
 * statement, so we take the largest figure any window saw instead.
 */
function undatedSettled(periods: DisputeProfitAndLoss[]): number {
  return periods.reduce((most, period) => Math.max(most, period.undatedSettled), 0);
}

export function buildDisputePlCsv(input: DisputePlCsvInput): string {
  const rows: string[] = [];

  rows.push(row([textCell("Chargeback profit and loss")]));
  rows.push(row([textCell("Shop"), textCell(input.shopDomain)]));
  rows.push(row([textCell("Period"), textCell(input.periodLabel)]));
  rows.push(row([textCell("Generated"), textCell(input.generatedAt.toISOString())]));
  rows.push(
    row([
      textCell("Basis"),
      textCell(
        "Settled cash. A dispute appears in the month it was finalised, not the month it was raised. Disputes still open are not in this statement."
      )
    ])
  );
  rows.push("");

  rows.push(row(COLUMNS.map((column) => textCell(column))));

  for (const period of input.periods) {
    if (period.lines.length === 0) {
      rows.push(row(emptyPeriodCells(period.label)));
      continue;
    }

    for (const line of period.lines) {
      rows.push(row(lineCells(period.label, line)));
    }
  }

  rows.push("");

  // Stated as its own row, immediately under the table, because a reader who
  // reconciles this against their bank statement needs to know before they
  // start that some settled disputes are in none of the months above.
  rows.push(
    row([
      textCell("Settled disputes with no finalisation date, so in no month above"),
      countCell(undatedSettled(input.periods))
    ])
  );

  rows.push("");
  rows.push(row([textCell("Notes")]));
  rows.push(
    row([
      textCell(
        "The chargeback fee is charged whether you win or lose. A won dispute is not a free dispute - the fee is its entire cost, and it is in the fees column above."
      )
    ])
  );
  rows.push(row([textCell(FEE_RECOVERY_ON_WIN.note)]));
  rows.push(
    row([
      textCell(
        "Money kept by winning is NOT subtracted from net cost. It is a debit that did not happen, not income, and netting it would let a good month of wins hide a bad month of fees."
      )
    ])
  );
  rows.push(
    row([
      textCell(
        "Net cost = money lost + all fees. Currencies are never added together, because this app holds no exchange rate and will not invent one."
      )
    ])
  );
  rows.push(
    row([
      textCell(
        "Inquiries and retrieval requests carry no chargeback fee, so none is charged for them here."
      )
    ])
  );
  rows.push(
    row([
      textCell(
        "This covers disputes this app has synced. Anything raised before install, or while syncing was interrupted, is not included."
      )
    ])
  );

  // A trailing separator so the last note is a complete line. Readers that
  // ignore a final empty line are fine; readers that do not get a clean row.
  return rows.join(ROW_SEPARATOR) + ROW_SEPARATOR;
}

/**
 * The download filename.
 *
 * It carries the shop and the period because these files end up in an email
 * thread and a shared drive, where "export.csv" is worthless. Everything
 * outside a small safe set is collapsed to a hyphen - this string goes into a
 * `Content-Disposition` header, so a stray quote, semicolon or newline in a
 * shop domain must not be able to shape the header.
 */
export function disputePlFilename(shopDomain: string, periodLabel: string): string {
  const safe = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);

  const shop = safe(shopDomain) || "shop";
  const period = safe(periodLabel) || "period";

  return `chargeback-pl-${shop}-${period}.csv`;
}
