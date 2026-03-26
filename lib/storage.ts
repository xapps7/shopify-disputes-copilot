import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

const publicRoot = path.join(process.cwd(), "public");

export async function persistUploadedFile(
  disputeId: string,
  fileName: string,
  bytes: Uint8Array
) {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const relativeDir = path.join("uploads", disputeId);
  const absoluteDir = path.join(publicRoot, relativeDir);

  await mkdir(absoluteDir, { recursive: true });

  const stampedName = `${Date.now()}-${safeName}`;
  const relativePath = path.join(relativeDir, stampedName);
  const absolutePath = path.join(publicRoot, relativePath);

  await writeFile(absolutePath, bytes);

  return `/${relativePath}`;
}

export async function persistPacketDraft(disputeId: string, content: string) {
  const relativeDir = path.join("packets", disputeId);
  const absoluteDir = path.join(publicRoot, relativeDir);

  await mkdir(absoluteDir, { recursive: true });

  const stampedName = `${Date.now()}-evidence-packet.txt`;
  const relativePath = path.join(relativeDir, stampedName);
  const absolutePath = path.join(publicRoot, relativePath);

  await writeFile(absolutePath, content, "utf8");

  return `/${relativePath}`;
}
