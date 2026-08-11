import crypto from "node:crypto";

import { db } from "@/lib/db";
import { scrubCustomerPii } from "@/lib/compliance/scrub";

export type ComplianceTopic = "customers/data_request" | "customers/redact" | "shop/redact";

export function hashEmail(email: string | null | undefined): string | null {
  if (!email) {
    return null;
  }

  return crypto.createHash("sha256").update(email.trim().toLowerCase(), "utf8").digest("hex");
}

type PersistArgs = {
  shopDomain: string;
  shopifyShopId?: string | null;
  topic: ComplianceTopic;
  webhookId?: string | null;
  customerId?: string | null;
  customerEmail?: string | null;
  /** Raw webhook payload, already parsed. */
  payload: unknown;
  /** Data we assembled/erased. Only retained verbatim for data_request. */
  assembled?: unknown;
  status: "RESOLVED" | "PENDING" | "NO_DATA";
  resolvedAt?: Date | null;
};

/**
 * Write the audit row for a compliance webhook.
 *
 * For the two REDACTION topics the stored payload is itself scrubbed - retaining a
 * verbatim copy of "please erase this customer" (which contains their email and
 * phone) would defeat the request we just honoured. The email is kept only as a
 * one-way hash so a later "did you process my request?" audit can still be answered.
 *
 * For data_request the assembled bundle IS the personal data, retained on purpose:
 * the merchant has 30 days to collect it.
 */
export async function persistComplianceRequest(args: PersistArgs) {
  const retainVerbatim = args.topic === "customers/data_request";
  const payloadForStorage = retainVerbatim ? args.payload : scrubCustomerPii(args.payload);

  return db.complianceRequest.create({
    data: {
      shopDomain: args.shopDomain,
      shopifyShopId: args.shopifyShopId ?? null,
      topic: args.topic,
      webhookId: args.webhookId ?? null,
      customerId: args.customerId ?? null,
      customerEmailHash: hashEmail(args.customerEmail),
      payloadJson: JSON.stringify(payloadForStorage),
      assembledJson: args.assembled === undefined ? null : JSON.stringify(args.assembled),
      status: args.status,
      resolvedAt: args.resolvedAt ?? null
    }
  });
}
