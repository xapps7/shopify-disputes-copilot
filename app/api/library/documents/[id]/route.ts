import { NextResponse } from "next/server";

import { findDocument, withoutDocument } from "@/lib/documents/library";
import { getMerchantSettings, saveMerchantSettings } from "@/lib/settings";
import { guardShopRoute, toErrorResponse } from "@/lib/shopify/route-guard";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Removes a document from the library.
 *
 * The S3 object is deliberately left in place. A dispute submitted last month
 * may still reference this file in its record, and destroying the bytes would
 * turn a tidy-up into a hole in the merchant's own history. The retention sweep
 * is what deletes objects; this only stops the document being offered on new
 * disputes.
 */
export async function DELETE(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const { shopDomain } = await guardShopRoute(request);

    // NOT gated, deliberately.
    //
    // Adding a document to the library is a paid feature. Getting your own
    // documents back is not. A merchant who lapses to free must still be able
    // to open and remove what they already stored - holding their files
    // hostage to a subscription is the one thing this pricing model is
    // explicitly not doing. The paywall is on the work the app does, never on
    // the merchant's own data.

    const settings = await getMerchantSettings(shopDomain);

    // Scoped by construction: the manifest read here belongs to this shop, so a
    // document id from another merchant simply is not in it.
    if (!findDocument(settings.standingDocuments, id)) {
      return NextResponse.json({ ok: false, message: "That document is not in your library." }, { status: 404 });
    }

    await saveMerchantSettings(shopDomain, {
      standingDocuments: withoutDocument(settings.standingDocuments, id)
    });

    return NextResponse.json({ ok: true, message: "Removed from your library." });
  } catch (error) {
    return toErrorResponse(error, "Could not remove that document.");
  }
}
