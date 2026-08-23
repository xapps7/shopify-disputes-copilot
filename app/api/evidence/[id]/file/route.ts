import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { requireEvidenceItem, requireMerchant } from "@/lib/disputes/tenant";
import { guardShopRoute, toErrorResponse } from "@/lib/shopify/route-guard";
import { resolveFileUrl } from "@/lib/storage";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * The only way to read an evidence file.
 *
 * Files used to live in `public/`, which Next serves statically with no
 * authentication at all - anyone holding or guessing a URL could download
 * another merchant's delivery confirmations, complete with customer names and
 * addresses. This route closes that: it resolves the shop, checks the item
 * belongs to them, and only then hands back a short-lived link.
 *
 * A file belonging to another merchant reports not-found rather than forbidden,
 * so ids cannot be probed for existence.
 */
export async function GET(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const { shopDomain } = await guardShopRoute(request);
    const merchant = await requireMerchant(shopDomain);

    // Throws NotFoundError for anything this merchant does not own.
    await requireEvidenceItem(merchant.id, id);

    const item = await db.evidenceItem.findUnique({
      where: { id },
      select: { fileUrl: true, title: true }
    });

    if (!item?.fileUrl) {
      return NextResponse.json({ ok: false, message: "No file on this evidence item." }, { status: 404 });
    }

    const url = await resolveFileUrl(item.fileUrl);
    if (!url) {
      return NextResponse.json(
        { ok: false, message: "This file is stored in S3 but S3 is not configured on this install." },
        { status: 503 }
      );
    }

    // A redirect rather than a proxy: the bytes go straight from S3 to the
    // browser, so a large packet does not travel through the app server twice.
    return NextResponse.redirect(url, { status: 302 });
  } catch (error) {
    return toErrorResponse(error, "Could not open that file.");
  }
}
