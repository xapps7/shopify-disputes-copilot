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
    if (!redirectTo || !redirectTo.startsWith("/")) {
      return;
    }

    window.location.replace(redirectTo);
  }, [pathname, searchParams]);

  return null;
}
