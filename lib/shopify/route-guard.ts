import { NextResponse } from "next/server";

import { NotFoundError, requireDispute, requireMerchant } from "@/lib/disputes/tenant";
import { UnauthorizedError, requireShopDomain } from "@/lib/shopify/request-context";

/**
 * One entry point for authenticating a request and resolving the dispute it is
 * allowed to touch. Every `/api/disputes/[id]/*` handler goes through this so
 * tenant scoping cannot be forgotten on the next route someone adds.
 */
export async function guardDisputeRoute(request: Request, disputeId: string) {
  const shopDomain = await requireShopDomain(request);
  const merchant = await requireMerchant(shopDomain);
  const dispute = await requireDispute(merchant.id, disputeId);
  return { shopDomain, merchant, dispute };
}

export async function guardShopRoute(request: Request) {
  const shopDomain = await requireShopDomain(request);
  return { shopDomain };
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
