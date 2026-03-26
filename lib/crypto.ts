import crypto from "node:crypto";

const IV_LENGTH = 12;

function getEncryptionKey() {
  const raw = process.env.ENCRYPTION_KEY ?? "";
  if (raw.length < 32) {
    throw new Error("ENCRYPTION_KEY must be at least 32 characters long.");
  }

  return crypto.createHash("sha256").update(raw).digest();
}

export function encryptString(value: string) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv.toString("base64"), authTag.toString("base64"), encrypted.toString("base64")].join(".");
}

export function decryptString(payload: string) {
  const [iv, authTag, encrypted] = payload.split(".");
  if (!iv || !authTag || !encrypted) {
    throw new Error("Malformed encrypted payload.");
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(authTag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64")),
    decipher.final()
  ]).toString("utf8");
}
