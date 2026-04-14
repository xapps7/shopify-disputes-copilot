"use client";

import { usePathname, useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";
import { Tabs } from "@shopify/polaris";

type AppShellProps = {
  children: React.ReactNode;
  release: string;
  commit: string;
};

const navItems = [
  { href: "/", label: "Overview" },
  { href: "/disputes", label: "Disputes" },
  { href: "/evidence", label: "Evidence Library" },
  { href: "/recommendations", label: "Recommendations" },
  { href: "/settings", label: "Settings" }
] as const satisfies ReadonlyArray<{ href: string; label: string }>;

export function AppShell({ children, release, commit }: AppShellProps) {
  void release;
  void commit;
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedTabIndex = navItems.findIndex((item) =>
    item.href === "/"
      ? pathname === "/"
      : item.href === "/disputes" && pathname.startsWith("/packets/")
        ? true
        : pathname === item.href || pathname.startsWith(`${item.href}/`)
  );

  return (
    <div className="app-shell">
      <div className="app-shell__masthead">
        <Tabs
          tabs={navItems.map((item) => ({
            id: item.href,
            content: item.label,
            accessibilityLabel: item.label
          }))}
          selected={selectedTabIndex >= 0 ? selectedTabIndex : 0}
          onSelect={(selectedTab) => {
            const target = navItems[selectedTab]?.href ?? "/";
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
