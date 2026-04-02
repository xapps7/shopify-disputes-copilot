import { db } from "@/lib/db";

export type MerchantSettings = {
  returnPolicyUrl: string;
  refundPolicyUrl: string;
  supportEmail: string;
  supportPhone: string;
  statementDescriptor: string;
  packetFooter: string;
  alertEmail: string;
  evidenceRetentionDays: string;
  notifyDueSoon: boolean;
  notifyMissingEvidence: boolean;
  allowManualSubmissionRecording: boolean;
};

export const defaultMerchantSettings: MerchantSettings = {
  returnPolicyUrl: "",
  refundPolicyUrl: "",
  supportEmail: "",
  supportPhone: "",
  statementDescriptor: "",
  packetFooter: "",
  alertEmail: "",
  evidenceRetentionDays: "365",
  notifyDueSoon: true,
  notifyMissingEvidence: true,
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
    return {
      ...defaultMerchantSettings,
      ...(JSON.parse(merchant.settingsJson) as Partial<MerchantSettings>)
    };
  } catch {
    return defaultMerchantSettings;
  }
}

export async function saveMerchantSettings(shopDomain: string, settings: MerchantSettings) {
  const merchant = await db.merchant.upsert({
    where: { shopDomain },
    update: {
      settingsJson: JSON.stringify(settings)
    },
    create: {
      shopDomain,
      settingsJson: JSON.stringify(settings)
    }
  });

  return merchant;
}
