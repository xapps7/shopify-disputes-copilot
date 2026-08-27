import { db } from "@/lib/db";
import {
  emptyStandingStatements,
  parseLibraryDocuments,
  type LibraryDocument,
  type StandingStatements
} from "@/lib/documents/library";

export type MerchantSettings = StandingStatements & {
  /** Documents that are the same on every dispute. See lib/documents/library.ts. */
  standingDocuments: LibraryDocument[];
} & {
  returnPolicyUrl: string;
  refundPolicyUrl: string;
  /** Subscriptions and services. Kept separate from the refund policy:
   *  a store can publish one without the other, and claiming cancellation
   *  terms were disclosed because a refund policy exists is an inference,
   *  not evidence. */
  cancellationPolicyUrl: string;
  supportEmail: string;
  supportPhone: string;
  statementDescriptor: string;
  packetFooter: string;
  alertEmail: string;
  alertWebhookUrl: string;
  evidenceRetentionDays: string;
  notifyDueSoon: boolean;
  notifyMissingEvidence: boolean;
  notifyDecided: boolean;
  allowManualSubmissionRecording: boolean;
};

export const defaultMerchantSettings: MerchantSettings = {
  ...emptyStandingStatements,
  standingDocuments: [],
  returnPolicyUrl: "",
  refundPolicyUrl: "",
  cancellationPolicyUrl: "",
  supportEmail: "",
  supportPhone: "",
  statementDescriptor: "",
  packetFooter: "",
  alertEmail: "",
  alertWebhookUrl: "",
  evidenceRetentionDays: "365",
  notifyDueSoon: true,
  notifyMissingEvidence: true,
  notifyDecided: true,
  allowManualSubmissionRecording: true
};

export async function getMerchantSettings(shopDomain: string | null): Promise<MerchantSettings> {
  if (!shopDomain) {
    return defaultMerchantSettings;
  }

  const merchant = await db.merchant.findUnique({
    where: { shopDomain }
  });

  if (!merchant?.settingsJson) {
    return defaultMerchantSettings;
  }

  try {
    const parsed = JSON.parse(merchant.settingsJson) as Partial<MerchantSettings>;

    return {
      ...defaultMerchantSettings,
      ...parsed,
      // Never trust the shape of this array: it is JSON in a text column, and a
      // half-written entry must not be able to break the settings page.
      standingDocuments: parseLibraryDocuments(parsed.standingDocuments)
    };
  } catch {
    return defaultMerchantSettings;
  }
}

/**
 * Writes a PARTIAL update, merged onto what is already stored.
 *
 * This used to replace the whole object. That was safe while one form owned
 * every key, and became a data-loss bug the moment the document library started
 * living here too: saving the settings form would post its own fields and
 * silently drop the merchant's uploaded documents. Merging costs one extra read
 * and removes a whole class of that mistake.
 */
export async function saveMerchantSettings(shopDomain: string, settings: Partial<MerchantSettings>) {
  const existing = await getMerchantSettings(shopDomain);
  const next: MerchantSettings = { ...existing, ...settings };

  const merchant = await db.merchant.upsert({
    where: { shopDomain },
    update: {
      settingsJson: JSON.stringify(next)
    },
    create: {
      shopDomain,
      settingsJson: JSON.stringify(next)
    }
  });

  return merchant;
}
