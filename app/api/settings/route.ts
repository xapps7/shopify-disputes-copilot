import { NextResponse } from "next/server";

import { getAuthenticatedShopDomain } from "@/lib/shopify/request-context";
import { saveMerchantSettings } from "@/lib/settings";
import {
  MALFORMED_JSON_MESSAGE,
  describeSchemaFailure,
  readJsonObject,
  settingsSchema
} from "@/lib/validation/route-inputs";

/**
 * Saves the shop-level settings.
 *
 * The schema lives in `lib/validation/route-inputs.ts` because these values are
 * not decoration: `alertEmail` is the recipient of every alert and of the
 * test-email button, and the policy URLs are printed into evidence a bank
 * reads. They used to be bare `z.string()`, so "not-an-email" and "our returns
 * page" were both accepted and both caused their damage somewhere else.
 */
export async function POST(request: Request) {
  try {
    const shopDomain = await getAuthenticatedShopDomain(request);

    if (!shopDomain) {
      return NextResponse.json({ message: "No active shop session found." }, { status: 400 });
    }

    const parsedBody = await readJsonObject(request);
    if (!parsedBody.ok) {
      return NextResponse.json({ message: MALFORMED_JSON_MESSAGE }, { status: 400 });
    }

    const result = settingsSchema.safeParse(parsedBody.body);

    // A rejected value is the merchant's to fix, so it is a 400 and it names
    // the field. This fell into the generic catch and returned 500, which says
    // "our fault, try again" about a form that will fail identically forever.
    if (!result.success) {
      return NextResponse.json({ message: describeSchemaFailure(result.error) }, { status: 400 });
    }

    await saveMerchantSettings(shopDomain, result.data);

    return NextResponse.json({ message: "Settings saved." });
  } catch (error) {
    console.error("Settings save failed", error);
    return NextResponse.json(
      // Never echo the raw error: the zod issue dump leaks internals to an
      // unauthenticated caller.
      { message: "Failed to save settings." },
      { status: 500 }
    );
  }
}
