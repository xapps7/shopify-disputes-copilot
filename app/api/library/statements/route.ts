import { NextResponse } from "next/server";
import { z } from "zod";

import { saveMerchantSettings } from "@/lib/settings";
import { guardShopRoute, toErrorResponse } from "@/lib/shopify/route-guard";

/**
 * The two evidence answers that are identical on every dispute.
 *
 * Shopify shows this text to the bank verbatim, so length is not the enemy -
 * vagueness is. The cap is generous and exists only to stop a paste accident
 * filling the settings column.
 */
const statementsSchema = z.object({
  refundPolicyStatement: z.string().max(4000),
  cancellationPolicyStatement: z.string().max(4000)
});

export async function POST(request: Request) {
  try {
    const { shopDomain } = await guardShopRoute(request);
    const payload = statementsSchema.parse(await request.json());

    await saveMerchantSettings(shopDomain, payload);

    return NextResponse.json({ ok: true, message: "Saved. New disputes will start with this text." });
  } catch (error) {
    return toErrorResponse(error, "Could not save that text.");
  }
}
