"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { buildEmbeddedAdminUrl } from "@/lib/shopify/embedded";

type EmbeddedAppRedirectProps = {
  apiKey: string;
  shopDomain: string | null;
  host: string | null;
};

export function EmbeddedAppRedirect({ apiKey, shopDomain, host }: EmbeddedAppRedirectProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const runtimeShop = searchParams.get("shop") ?? shopDomain;
    const runtimeHost = searchParams.get("host") ?? host;

    if (!apiKey || !runtimeShop) {
      return;
    }

    if (window.top !== window.self) {
      return;
    }

    const targetPath = pathname === "/" ? "/dashboard" : pathname;
    const targetUrl = buildEmbeddedAdminUrl(apiKey, runtimeShop, targetPath, runtimeHost);
    window.location.replace(targetUrl);
  }, [apiKey, host, pathname, searchParams, shopDomain]);

  return null;
}
