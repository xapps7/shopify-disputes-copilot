import { NextResponse } from "next/server";

import { isDiagnosticsAuthorized } from "@/lib/diagnostics-auth";
import { describeStorageFailure, persistUploadedFile, resolveFileUrl, StorageError } from "@/lib/storage";

/**
 * Writes one tiny file and reads it back, so a storage misconfiguration can be
 * diagnosed without uploading real evidence and guessing at "Upload failed."
 *
 * Same idea as the test email button: every likely fault here is a
 * configuration mistake with a specific fix, and the fastest way to find it is
 * to try the thing and report exactly what came back.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  if (!isDiagnosticsAuthorized(request)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const mode = process.env.FILE_STORAGE_MODE ?? "local";

  const config = {
    FILE_STORAGE_MODE: mode,
    S3_BUCKET: process.env.S3_BUCKET ?? null,
    S3_REGION: process.env.S3_REGION ?? null,
    // Set means public URLs; empty means signed, which is what a private bucket
    // wants. Worth showing because setting it by mistake silently makes files
    // public again.
    FILE_STORAGE_PUBLIC_BASE_URL: process.env.FILE_STORAGE_PUBLIC_BASE_URL || null
  };

  if (mode !== "s3") {
    return NextResponse.json({
      ok: false,
      config,
      message:
        "FILE_STORAGE_MODE is not set to s3, so uploads are still going to the container disk - which is wiped on every deploy and served without authentication."
    });
  }

  try {
    const bytes = new TextEncoder().encode(`storage check ${new Date().toISOString()}`);
    const reference = await persistUploadedFile("diagnostics", "storage-check.txt", bytes);
    const readBack = await resolveFileUrl(reference);

    return NextResponse.json({
      ok: true,
      config,
      wrote: reference,
      // Presence proves the read path too - a bucket that accepts writes but
      // refuses GetObject would otherwise only fail later, on a download.
      canGenerateReadUrl: Boolean(readBack),
      message: "Wrote and read back a test file. Storage is working."
    });
  } catch (error) {
    const described = error instanceof StorageError ? error : describeStorageFailure(error);

    return NextResponse.json(
      { ok: false, config, cause: described.cause, message: described.message },
      { status: 503 }
    );
  }
}
