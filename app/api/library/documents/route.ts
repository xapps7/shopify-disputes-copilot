import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { capabilityRefusalResponse, requireCapability } from "@/lib/billing/gate";
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
import {
  MAX_TITLE_LENGTH,
  MISSING_CONTENT_LENGTH_MESSAGE,
  checkDeclaredBodySize,
  checkTextLength
} from "@/lib/validation/route-inputs";

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

    // The library is paid: saving a policy document once and having it offered
    // on every future dispute is work the app does instead of the merchant.
    // Refused here, before the body is read, so a rejected upload never buffers
    // two megabytes into the memory every shop on this instance shares.
    const gate = await requireCapability(merchant.id, "DOCUMENT_LIBRARY");
    if (!gate.allowed) {
      return capabilityRefusalResponse(gate);
    }

    // Refuse a body that will not say how big it is. Without `content-length`
    // - which is exactly what `Transfer-Encoding: chunked` gives you - the old
    // check read the missing header as zero and let `formData()` buffer the
    // whole upload into the memory of the one instance every merchant shares.
    const bodySize = checkDeclaredBodySize(
      request.headers.get("content-length"),
      MAX_SINGLE_EVIDENCE_BYTES * 2
    );

    if (!bodySize.ok) {
      // 411 for a body that never declared its size, 413 for one that declared
      // too much. Two different mistakes deserve two different answers.
      return bodySize.reason === "missing"
        ? NextResponse.json({ ok: false, message: MISSING_CONTENT_LENGTH_MESSAGE }, { status: 411 })
        : NextResponse.json(
            { ok: false, message: "Shopify accepts 2 MB per evidence file. This one is over that." },
            { status: 413 }
          );
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const kind = String(formData.get("kind") ?? "");

    const titleCheck = checkTextLength(formData.get("title"), MAX_TITLE_LENGTH);
    if (!titleCheck.ok) {
      return NextResponse.json(
        { ok: false, message: `A title is limited to ${titleCheck.maxLength} characters.` },
        { status: 400 }
      );
    }
    const title = titleCheck.value;

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
