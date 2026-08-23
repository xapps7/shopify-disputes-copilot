import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
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
    throw new Error("S3 storage is not configured.");
  }

  await s3Client.send(
    new PutObjectCommand({
      Bucket: s3Bucket,
      Key: key,
      Body: body,
      ContentType: contentType
    })
  );

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
