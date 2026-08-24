import { NextResponse } from "next/server";

import { findDocument } from "@/lib/documents/library";
import { getMerchantSettings } from "@/lib/settings";
import { guardShopRoute, toErrorResponse } from "@/lib/shopify/route-guard";
import { resolveFileUrl } from "@/lib/storage";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * The only way to read a library document.
 *
 * Same shape as the evidence file route and for the same reason: the stored
 * value is an `s3://` reference, not a URL, so there is nothing to link to
 * directly and nothing to guess. Tenant scoping is implicit - the manifest is
 * read from THIS shop's settings, so another merchant's id is simply absent and
 * reports not-found.
 */
export async function GET(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const { shopDomain } = await guardShopRoute(request);

    const settings = await getMerchantSettings(shopDomain);
    const document = findDocument(settings.standingDocuments, id);

    if (!document) {
      return NextResponse.json({ ok: false, message: "That document is not in your library." }, { status: 404 });
    }

    const url = await resolveFileUrl(document.storageRef);
    if (!url) {
      return NextResponse.json(
        { ok: false, message: "This file is stored in S3 but S3 is not configured on this install." },
        { status: 503 }
      );
    }

    return NextResponse.redirect(url, { status: 302 });
  } catch (error) {
    return toErrorResponse(error, "Could not open that document.");
  }
}
