import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const publicRoot = path.join(process.cwd(), "public");
const storageMode = process.env.FILE_STORAGE_MODE ?? "local";
const storagePublicBaseUrl = process.env.FILE_STORAGE_PUBLIC_BASE_URL?.replace(/\/$/, "") ?? "";
const s3Bucket = process.env.S3_BUCKET;
const s3Region = process.env.S3_REGION;

const s3Client =
  storageMode === "s3" && s3Bucket && s3Region
    ? new S3Client({
        region: s3Region
      })
    : null;

function publicUrl(relativePath: string) {
  return storagePublicBaseUrl ? `${storagePublicBaseUrl}/${relativePath}` : `/${relativePath}`;
}

async function persistObjectToS3(key: string, body: Uint8Array | string, contentType: string) {
  if (!s3Client || !s3Bucket) {
    throw new StorageError(
      "File storage is set to S3 but S3_BUCKET or S3_REGION is missing. Both are required, plus FILE_STORAGE_MODE=s3.",
      "not-configured"
    );
  }

  try {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: s3Bucket,
        Key: key,
        Body: body,
        ContentType: contentType
      })
    );
  } catch (error) {
    console.error("[storage] S3 put failed", error);
    throw describeStorageFailure(error);
  }

  // Return a durable reference, NOT a signed URL.
  //
  // The previous version returned a signed URL with a 12 hour expiry and that
  // value was written straight into EvidenceItem.fileUrl. Every evidence link
  // in the database would have died overnight, silently, and the merchant would
  // have found out while assembling a response against a deadline.
  //
  // `s3://key` is stored instead and resolved to a fresh signed URL at read
  // time. Using a scheme prefix rather than a new column means no migration and
  // no ambiguity: a value either starts with s3:// or it is a local path.
  return storagePublicBaseUrl ? publicUrl(key) : `${S3_REF_PREFIX}${key}`;
}


/**
 * A storage failure the merchant can act on.
 *
 * The upload route used to return a bare "Upload failed." and log the real
 * cause where only the operator could see it. For a self-hosted app whose
 * operator IS the person staring at the failed upload, that is the wrong trade:
 * every likely cause here is a configuration mistake with a specific fix, and
 * naming it turns a support ticket into a two-minute change.
 *
 * Nothing sensitive is exposed - AWS error names are not secrets, and the
 * bucket name is already in the merchant's own console.
 */
export class StorageError extends Error {
  readonly cause: string;

  constructor(message: string, cause: string) {
    super(message);
    this.name = "StorageError";
    this.cause = cause;
  }
}

/** Turns an AWS SDK error into something worth reading. */
export function describeStorageFailure(error: unknown): StorageError {
  const name = (error as { name?: string })?.name ?? "";
  const raw = error instanceof Error ? error.message : String(error);

  if (/AccessDenied|Forbidden|not authorized/i.test(name + raw)) {
    return new StorageError(
      `The app is not allowed to write to the ${s3Bucket ?? "storage"} bucket. Attach the S3 policy to the App Runner INSTANCE role - not the access role, which is a different setting.`,
      "access-denied"
    );
  }

  if (/NoSuchBucket/i.test(name + raw)) {
    return new StorageError(
      `No bucket named "${s3Bucket}" exists. Check S3_BUCKET for a typo.`,
      "no-bucket"
    );
  }

  if (/PermanentRedirect|region/i.test(name + raw)) {
    return new StorageError(
      `The bucket is not in ${s3Region}. Set S3_REGION to the region the bucket was actually created in.`,
      "wrong-region"
    );
  }

  if (/Credentials|CredentialsProviderError|security token/i.test(name + raw)) {
    return new StorageError(
      "The app has no AWS credentials. On App Runner that means no instance role is attached.",
      "no-credentials"
    );
  }

  return new StorageError(`Storage rejected the upload: ${raw.slice(0, 200)}`, "unknown");
}

export const S3_REF_PREFIX = "s3://";

export function isS3Reference(value: string | null | undefined): value is string {
  return typeof value === "string" && value.startsWith(S3_REF_PREFIX);
}

/**
 * Turns a stored reference into something a browser can fetch.
 *
 * Local paths pass straight through. S3 references become a signed URL valid
 * for fifteen minutes - long enough to click, short enough that a link copied
 * into a chat message stops working before it becomes a leak.
 */
export async function resolveFileUrl(reference: string | null | undefined): Promise<string | null> {
  if (!reference) {
    return null;
  }

  if (!isS3Reference(reference)) {
    return reference;
  }

  if (!s3Client || !s3Bucket) {
    return null;
  }

  return await getSignedUrl(
    s3Client,
    new GetObjectCommand({ Bucket: s3Bucket, Key: reference.slice(S3_REF_PREFIX.length) }),
    { expiresIn: 60 * 15 }
  );
}

/**
 * Deletes a stored object.
 *
 * This did not exist, and its absence was load-bearing: both the privacy
 * webhooks and the retention sweep could only clear the database POINTER to a
 * file, leaving the bytes in the bucket forever. "Deleted" then meant "you can
 * no longer find it", which is not what an erasure request asks for.
 *
 * Returns what actually happened rather than throwing, because a sweep over
 * many files must not abort on the one object that has already gone. A missing
 * object counts as success - the desired end state is that it is not there.
 *
 * Local-mode paths are reported as skipped rather than unlinked. Local storage
 * only exists on a developer machine (App Runner wipes the disk on every
 * deploy), and a delete helper that can remove arbitrary paths under `public/`
 * is a bigger risk than the stale dev file it would clean up.
 */
export async function deleteStoredFile(
  reference: string | null | undefined
): Promise<{ deleted: boolean; reason: "deleted" | "not-found" | "not-configured" | "not-remote" | "failed" }> {
  if (!reference) {
    return { deleted: false, reason: "not-found" };
  }

  if (!isS3Reference(reference)) {
    return { deleted: false, reason: "not-remote" };
  }

  if (!s3Client || !s3Bucket) {
    return { deleted: false, reason: "not-configured" };
  }

  try {
    await s3Client.send(
      new DeleteObjectCommand({ Bucket: s3Bucket, Key: reference.slice(S3_REF_PREFIX.length) })
    );
    return { deleted: true, reason: "deleted" };
  } catch (error) {
    // S3 returns success for a key that was never there, so reaching here
    // means a real failure - permissions, most likely. Say so and carry on.
    console.error("[storage] delete failed", error);
    return { deleted: false, reason: "failed" };
  }
}

export async function persistUploadedFile(
  disputeId: string,
  fileName: string,
  bytes: Uint8Array
) {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const relativeDir = path.join("uploads", disputeId);
  const stampedName = `${Date.now()}-${safeName}`;
  const relativePath = path.join(relativeDir, stampedName).replaceAll("\\", "/");

  if (storageMode === "s3") {
    return await persistObjectToS3(relativePath, bytes, "application/octet-stream");
  }

  const absoluteDir = path.join(publicRoot, relativeDir);

  await mkdir(absoluteDir, { recursive: true });

  const absolutePath = path.join(publicRoot, relativePath);

  await writeFile(absolutePath, bytes);

  return publicUrl(relativePath);
}

/**
 * A shop-level document, not tied to any dispute.
 *
 * Keyed under the merchant id rather than a dispute id, because the whole point
 * is that it outlives every individual case. Retention treats it differently
 * too: a refund policy holds no customer data, so it is not swept when a
 * dispute closes.
 */
export async function persistLibraryFile(
  merchantId: string,
  fileName: string,
  bytes: Uint8Array,
  contentType: string
) {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const relativeDir = path.join("library", merchantId);
  const stampedName = `${Date.now()}-${safeName}`;
  const relativePath = path.join(relativeDir, stampedName).replaceAll("\\", "/");

  if (storageMode === "s3") {
    return await persistObjectToS3(relativePath, bytes, contentType || "application/octet-stream");
  }

  const absoluteDir = path.join(publicRoot, relativeDir);

  await mkdir(absoluteDir, { recursive: true });
  await writeFile(path.join(publicRoot, relativePath), bytes);

  return publicUrl(relativePath);
}

export async function persistPacketDraft(disputeId: string, content: string) {
  const relativeDir = path.join("packets", disputeId);
  const stampedName = `${Date.now()}-evidence-packet.txt`;
  const relativePath = path.join(relativeDir, stampedName).replaceAll("\\", "/");

  if (storageMode === "s3") {
    return await persistObjectToS3(relativePath, content, "text/plain; charset=utf-8");
  }

  const absoluteDir = path.join(publicRoot, relativeDir);

  await mkdir(absoluteDir, { recursive: true });

  const absolutePath = path.join(publicRoot, relativePath);

  await writeFile(absolutePath, content, "utf8");

  return publicUrl(relativePath);
}
