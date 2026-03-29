"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

type EmbeddedAppRedirectProps = {
  apiKey: string;
  shopDomain: string | null;
  host: string | null;
};

function buildAdminAppUrl(apiKey: string, shopDomain: string, host: string | null, pathname: string, search: string) {
  const query = new URLSearchParams(search);
  query.set("shop", shopDomain);
  if (host) {
    query.set("host", host);
  }

  const normalizedPath = pathname === "/" ? "" : pathname;
  const suffix = query.toString() ? `?${query.toString()}` : "";

  return `https://${shopDomain}/admin/apps/${apiKey}${normalizedPath}${suffix}`;
}

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

    const queryString = searchParams.toString();
    const targetUrl = buildAdminAppUrl(apiKey, runtimeShop, runtimeHost, pathname, queryString);
    window.location.replace(targetUrl);
  }, [apiKey, host, pathname, searchParams, shopDomain]);

  return null;
}
