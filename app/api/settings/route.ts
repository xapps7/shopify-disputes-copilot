import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentShopDomain } from "@/lib/shopify/auth";
import { saveMerchantSettings } from "@/lib/settings";

const settingsSchema = z.object({
  returnPolicyUrl: z.string(),
  refundPolicyUrl: z.string(),
  supportEmail: z.string(),
  supportPhone: z.string(),
  statementDescriptor: z.string(),
  packetFooter: z.string(),
  alertEmail: z.string(),
  evidenceRetentionDays: z.string(),
  notifyDueSoon: z.boolean(),
  notifyMissingEvidence: z.boolean(),
  allowManualSubmissionRecording: z.boolean()
});

export async function POST(request: Request) {
  try {
    const shopDomain = await getCurrentShopDomain();

    if (!shopDomain) {
      return NextResponse.json({ message: "No active shop session found." }, { status: 400 });
    }

    const payload = settingsSchema.parse(await request.json());
    await saveMerchantSettings(shopDomain, payload);

    return NextResponse.json({ message: "Settings saved." });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Failed to save settings." },
      { status: 500 }
    );
  }
}
