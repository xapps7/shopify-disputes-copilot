import { NextResponse } from "next/server";

import { NotFoundError, requireDispute, requireMerchant } from "@/lib/disputes/tenant";
import { ensureMerchantAccessToken } from "@/lib/shopify/access-token";
import {
  UnauthorizedError,
  getAuthenticatedContext,
  requireShopDomain
} from "@/lib/shopify/request-context";

/**
 * One entry point for authenticating a request and resolving the dispute it is
 * allowed to touch. Every `/api/disputes/[id]/*` handler goes through this so
 * tenant scoping cannot be forgotten on the next route someone adds.
 */
export async function guardDisputeRoute(request: Request, disputeId: string) {
  const { shopDomain } = await guardShopRoute(request);
  const merchant = await requireMerchant(shopDomain);
  const dispute = await requireDispute(merchant.id, disputeId);
  return { shopDomain, merchant, dispute };
}

/**
 * Authenticates the request and makes sure a usable access token exists for the
 * shop, minting one by token exchange when the stored token is missing or has
 * expired. Legacy OAuth-issued tokens are left alone while they still work.
 */
export async function guardShopRoute(request: Request) {
  const context = await getAuthenticatedContext(request);

  if (!context) {
    throw new UnauthorizedError("No verified Shopify session for this request.");
  }

  await ensureMerchantAccessToken({
    shopDomain: context.shopDomain,
    sessionToken: context.sessionToken
  });

  return { shopDomain: context.shopDomain, sessionToken: context.sessionToken };
}

/**
 * Maps errors to responses without leaking internals. Handlers previously
 * echoed `error.message` to unauthenticated callers.
 */
export function toErrorResponse(error: unknown, fallbackMessage: string) {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
  }

  if (error instanceof NotFoundError) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 404 });
  }

  console.error(fallbackMessage, error);
  return NextResponse.json({ ok: false, message: fallbackMessage }, { status: 500 });
}
