import { db } from "@/lib/db";

export type MerchantSettings = {
  returnPolicyUrl: string;
  refundPolicyUrl: string;
  supportEmail: string;
  supportPhone: string;
  statementDescriptor: string;
  packetFooter: string;
};

export const defaultMerchantSettings: MerchantSettings = {
  returnPolicyUrl: "",
  refundPolicyUrl: "",
  supportEmail: "",
  supportPhone: "",
  statementDescriptor: "",
  packetFooter: ""
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
