"use client";

import { usePathname, useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";
import { Tabs } from "@shopify/polaris";

type AppShellProps = {
  children: React.ReactNode;
  release: string;
  commit: string;
};

/**
 * Four destinations, named for what the merchant is trying to do.
 *
 * The old nav listed the data model - Overview, Disputes, Evidence library,
 * Recommendations, Settings - which spread one job across several tabs and gave
 * the most consequential question in the product no home at all.
 *
 * There are two separate scoreboards in chargebacks, and they do not move
 * together: money recovered (fighting a case) and account survival (the Visa
 * VAMP and Mastercard ECM ratios that decide whether the shop keeps card
 * processing). Winning a chargeback recovers the money and does nothing to the
 * ratio. "Account health" is the second scoreboard, and it absorbs
 * Recommendations, because prevention is ratio work - as a tab of its own
 * nobody visited it.
 *
 * Evidence library is off the primary nav - it is a filing cabinet, not a
 * destination - but it belongs to Disputes, not Settings. Every row in it is
 * attached to a dispute. It sat under Settings for a while, which meant the nav
 * told a merchant browsing their own evidence that they were configuring the
 * app.
 *
 * `matches` keeps a route that has no tab of its own highlighting the tab that
 * owns it, so the nav never claims the merchant is somewhere they are not, and
 * `selected` is never out of range (Polaris indexes `tabs[selected]` when the
 * strip overflows).
 */
const NAV_ITEMS = [
  { href: "/", label: "Today", matches: (pathname: string) => pathname === "/" },
  {
    href: "/disputes",
    label: "Disputes",
    matches: (pathname: string) =>
      pathname === "/disputes" ||
      pathname.startsWith("/disputes/") ||
      pathname.startsWith("/packets/") ||
      // The evidence library is a cross-dispute view of dispute files.
      pathname === "/evidence" ||
      pathname.startsWith("/evidence/")
  },
  {
    href: "/account-health",
    label: "Account health",
    matches: (pathname: string) =>
      pathname === "/account-health" ||
      pathname.startsWith("/account-health/") ||
      // Recommendations now live inside Account health; the old route still
      // resolves, and it highlights the tab that owns it.
      pathname === "/recommendations" ||
      pathname.startsWith("/recommendations/")
  },
  {
    href: "/settings",
    label: "Settings",
    matches: (pathname: string) =>
      pathname === "/settings" || pathname.startsWith("/settings/")
  }
  // `as const` keeps each href a literal, which is what Next's typed routes
  // check `router.push` against - a widened `string` fails that check.
] as const satisfies ReadonlyArray<{ href: string; label: string; matches: (pathname: string) => boolean }>;

export function AppShell({ children, release, commit }: AppShellProps) {
  void release;
  void commit;
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedTabIndex = NAV_ITEMS.findIndex((item) => item.matches(pathname));

  return (
    <div className="app-shell">
      {/*
        Shopify's admin sidebar menu.
        
        Without this the app has no links in the admin's left sidebar at all -
        a merchant could only move between screens once already inside the
        iframe, and the app looked like a single page from the outside. It is
        also reviewer-visible, and Shopify's own app design guidance treats the
        sidebar as the primary navigation for an embedded app.
        
        `ui-nav-menu` is an App Bridge web component, not React, so it is
        written as plain markup and takes no props from us. App Bridge reads the
        anchors on mount. The FIRST anchor must be href="/" and is used as the
        home link rather than rendered as an item - that is App Bridge's
        contract, not a quirk of ours, and putting anything else first drops a
        destination.
        
        The Polaris Tabs strip below stays. It carries the embedded query string
        through client navigation, which the sidebar links cannot do, and it is
        what keeps the app usable if App Bridge has not loaded.
      */}
      <ui-nav-menu>
        <a href="/" rel="home">
          Today
        </a>
        <a href="/disputes">Disputes</a>
        <a href="/account-health">Account health</a>
        <a href="/evidence">Evidence library</a>
        <a href="/settings">Settings</a>
      </ui-nav-menu>
      <div className="app-shell__masthead">
        <Tabs
          tabs={NAV_ITEMS.map((item) => ({
            id: item.href,
            content: item.label,
            accessibilityLabel: item.label
          }))}
          selected={selectedTabIndex >= 0 ? selectedTabIndex : 0}
          onSelect={(selectedTab) => {
            const target = NAV_ITEMS[selectedTab]?.href ?? "/";
            const params = new URLSearchParams(searchParams.toString());
            const query = params.toString();
            router.push(query ? `${target}?${query}` : target);
          }}
          fitted={false}
        />
      </div>
      <div className="app-shell__content">{children}</div>
    </div>
  );
}
