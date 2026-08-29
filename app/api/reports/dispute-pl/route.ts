import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { requireMerchant } from "@/lib/disputes/tenant";
import { buildDisputeProfitAndLoss, type DisputeProfitAndLoss } from "@/lib/economics/dispute-pl";
import { buildDisputePlCsv, disputePlFilename } from "@/lib/economics/pl-export";
import { guardShopRoute, toErrorResponse } from "@/lib/shopify/route-guard";

/**
 * Download the chargeback statement.
 *
 * The account-health screen already shows this month and last month. This route
 * exists because a screen cannot be forwarded: the merchant's bank wants a
 * file, their acquirer wants a file, and their finance team wants something
 * that can be attached to a month-end pack. Handing them one is what turns the
 * app from a dashboard into the record of what disputes cost.
 *
 * Scoping is the thing to get right here. This is money data, so the shop is
 * resolved from the verified Shopify session by `guardShopRoute` and never from
 * anything the caller can set - no `?shop=`, no header. `requireMerchant` then
 * gives us the merchant row the query is filtered by, so a shop can only ever
 * read its own figures.
 */

// The figures change as disputes settle, so this must never be cached.
export const dynamic = "force-dynamic";

/** A year reads as a finance period and is what a month-end pack wants. */
const DEFAULT_MONTHS = 12;

/**
 * Two years. Past this the query and the file both grow without helping anyone,
 * and the app has not existed long enough for the older months to hold anything
 * but empty rows.
 */
const MAX_MONTHS = 24;

class BadRequestError extends Error {}

/**
 * `?months=N`, validated strictly rather than coerced.
 *
 * A silent fallback would hand back twelve months to someone who asked for
 * three and thought they got it, and they would reconcile the wrong number
 * against their bank. Wrong input gets a 400 and an explanation.
 */
function parseMonths(raw: string | null): number {
  if (raw === null || raw.trim() === "") {
    return DEFAULT_MONTHS;
  }

  const months = Number(raw);

  if (!Number.isInteger(months) || months < 1 || months > MAX_MONTHS) {
    throw new BadRequestError(`months must be a whole number between 1 and ${MAX_MONTHS}.`);
  }

  return months;
}

function monthName(date: Date): string {
  return date.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/**
 * The month windows to report, newest first.
 *
 * Months are UTC calendar months, matching `account-health.ts`, so the two
 * views of the same period cannot disagree. The current month ends at "now"
 * rather than at the end of the month and is labelled "so far", because a
 * part-month total presented as a full one is the kind of figure that gets
 * compared against a complete month and read as an improvement.
 */
function monthWindows(now: Date, months: number): Array<{ start: Date; end: Date; label: string }> {
  const windows: Array<{ start: Date; end: Date; label: string }> = [];

  for (let offset = 0; offset < months; offset += 1) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset + 1, 1));
    const isCurrentMonth = offset === 0;

    windows.push({
      start,
      end: isCurrentMonth ? now : nextMonth,
      label: isCurrentMonth ? `${monthName(start)} so far` : monthName(start)
    });
  }

  return windows;
}

export async function GET(request: Request) {
  try {
    const { shopDomain } = await guardShopRoute(request);
    const merchant = await requireMerchant(shopDomain);
    const months = parseMonths(new URL(request.url).searchParams.get("months"));

    const disputes = await db.dispute.findMany({
      where: { merchantId: merchant.id },
      select: {
        status: true,
        disputeType: true,
        amount: true,
        currencyCode: true,
        finalizedOn: true
      }
    });

    // Prisma hands back Decimal and the P&L module is deliberately Prisma-free,
    // so the conversion happens here - same boundary as `account-health.ts`.
    const records = disputes.map((dispute) => ({
      status: dispute.status,
      disputeType: dispute.disputeType,
      amount: Number(dispute.amount?.toString() ?? "0"),
      currencyCode: dispute.currencyCode,
      finalizedOn: dispute.finalizedOn
    }));

    const now = new Date();
    const windows = monthWindows(now, months);

    const periods: DisputeProfitAndLoss[] = windows.map((window) =>
      buildDisputeProfitAndLoss(records, { start: window.start, end: window.end }, window.label)
    );

    const oldest = windows[windows.length - 1];
    const newest = windows[0];
    const periodLabel =
      months === 1 ? newest.label : `${monthName(oldest.start)} to ${monthName(newest.start)}`;

    const csv = buildDisputePlCsv({ shopDomain, periodLabel, periods, generatedAt: now });

    return new NextResponse(
      // A UTF-8 byte order mark. Excel on Windows assumes the local codepage
      // for a .csv without one, which mangles any non-ASCII character in a shop
      // name. Every other reader ignores it.
      `\uFEFF${csv}`,
      {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${disputePlFilename(shopDomain, periodLabel)}"`,
          "Cache-Control": "no-store"
        }
      }
    );
  } catch (error) {
    if (error instanceof BadRequestError) {
      return NextResponse.json({ ok: false, message: error.message }, { status: 400 });
    }

    return toErrorResponse(error, "Could not build the chargeback statement.");
  }
}
