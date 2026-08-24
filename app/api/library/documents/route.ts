import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { requireMerchant } from "@/lib/disputes/tenant";
import {
  ALLOWED_EVIDENCE_MIME_TYPES,
  MAX_SINGLE_EVIDENCE_BYTES
} from "@/lib/disputes/evidence-fields";
import {
  getKindDefinition,
  isLibraryDocumentKind,
  withDocument,
  type LibraryDocument
} from "@/lib/documents/library";
import { getMerchantSettings, saveMerchantSettings } from "@/lib/settings";
import { guardShopRoute, toErrorResponse } from "@/lib/shopify/route-guard";
import { persistLibraryFile, StorageError } from "@/lib/storage";

/**
 * Uploading a document that belongs to the shop, not to a dispute.
 *
 * Same file rules as dispute evidence, because the file ends up in the same
 * Shopify slot - checking them here means the merchant finds out in a quiet
 * moment rather than at 11pm with a deadline running.
 */
export async function POST(request: Request) {
  try {
    const { shopDomain } = await guardShopRoute(request);
    const merchant = await requireMerchant(shopDomain);

    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_SINGLE_EVIDENCE_BYTES * 2) {
      return NextResponse.json(
        { ok: false, message: "Shopify accepts 2 MB per evidence file. This one is over that." },
        { status: 413 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const kind = String(formData.get("kind") ?? "");
    const title = String(formData.get("title") ?? "").trim();

    if (!isLibraryDocumentKind(kind)) {
      return NextResponse.json({ ok: false, message: "Pick what kind of document this is." }, { status: 400 });
    }

    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, message: "Choose a file to upload." }, { status: 400 });
    }

    if (!(ALLOWED_EVIDENCE_MIME_TYPES as readonly string[]).includes(file.type)) {
      return NextResponse.json(
        {
          ok: false,
          message: `Shopify only accepts PDF, PNG and JPEG for dispute evidence${
            file.type ? ` - this file is ${file.type}` : ""
          }.`
        },
        { status: 415 }
      );
    }

    if (file.size > MAX_SINGLE_EVIDENCE_BYTES) {
      return NextResponse.json(
        {
          ok: false,
          message: `Shopify accepts 2 MB per evidence file. This one is ${Math.round(file.size / 1024)} KB.`
        },
        { status: 413 }
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const storageRef = await persistLibraryFile(merchant.id, file.name, bytes, file.type);

    const document: LibraryDocument = {
      id: randomUUID(),
      kind,
      title: title || getKindDefinition(kind).label,
      storageRef,
      mimeType: file.type,
      sizeBytes: file.size,
      uploadedAt: new Date().toISOString()
    };

    const settings = await getMerchantSettings(shopDomain);
    await saveMerchantSettings(shopDomain, {
      standingDocuments: withDocument(settings.standingDocuments, document)
    });

    return NextResponse.json({ ok: true, message: "Saved to your library.", document });
  } catch (error) {
    if (error instanceof StorageError) {
      return NextResponse.json({ ok: false, message: error.message }, { status: 503 });
    }

    return toErrorResponse(error, "Could not save that document.");
  }
}
