"use client";

import { useSearchParams } from "next/navigation";

/**
 * Reads the shop domain the embedded app was opened with.
 *
 * This deliberately uses the exact pattern the sync buttons already use
 * (`searchParams.get("shop")`) and does not touch any server-side session or
 * auth helper — it only needs enough to build a Shopify Admin deep link. When
 * the param is absent, callers must degrade to text guidance rather than
 * rendering a broken link.
 */
export function useShopDomain(): string | null {
  const searchParams = useSearchParams();

  return searchParams.get("shop");
}
