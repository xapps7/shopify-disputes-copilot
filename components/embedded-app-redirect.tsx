"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

type EmbeddedAppRedirectProps = {
  apiKey: string;
  shopDomain: string | null;
};

function buildAdminAppUrl(apiKey: string, shopDomain: string, pathname: string, search: string) {
  const query = new URLSearchParams(search);
  query.set("shop", shopDomain);

  const normalizedPath = pathname === "/" ? "" : pathname;
  const suffix = query.toString() ? `?${query.toString()}` : "";

  return `https://${shopDomain}/admin/apps/${apiKey}${normalizedPath}${suffix}`;
}

export function EmbeddedAppRedirect({ apiKey, shopDomain }: EmbeddedAppRedirectProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!apiKey || !shopDomain) {
      return;
    }

    if (window.top !== window.self) {
      return;
    }

    const queryString = searchParams.toString();
    const targetUrl = buildAdminAppUrl(apiKey, shopDomain, pathname, queryString);
    window.location.replace(targetUrl);
  }, [apiKey, pathname, searchParams, shopDomain]);

  return null;
}
