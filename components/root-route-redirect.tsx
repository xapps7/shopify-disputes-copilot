"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

export function RootRouteRedirect() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (pathname !== "/") {
      return;
    }

    const redirectTo = searchParams.get("redirectTo");
    const shop = searchParams.get("shop");
    const host = searchParams.get("host");
    const hmac = searchParams.get("hmac");
    const timestamp = searchParams.get("timestamp");

    if (redirectTo && redirectTo.startsWith("/")) {
      window.location.replace(redirectTo);
      return;
    }

    if (!shop) {
      return;
    }

    const next = new URL("/dashboard", window.location.origin);
    next.searchParams.set("shop", shop);
    if (host) next.searchParams.set("host", host);
    if (hmac) next.searchParams.set("hmac", hmac);
    if (timestamp) next.searchParams.set("timestamp", timestamp);

    window.location.replace(next.toString());
  }, [pathname, searchParams]);

  return null;
}
