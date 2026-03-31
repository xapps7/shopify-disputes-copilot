"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname, useRouter } from "next/navigation";
import { BlockStack, Box, Tabs, Text } from "@shopify/polaris";

type AppShellProps = {
  children: React.ReactNode;
  release: string;
  commit: string;
};

const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/", label: "Overview" },
  { href: "/settings", label: "Settings" }
] as const satisfies ReadonlyArray<{ href: Route; label: string }>;

export function AppShell({ children, release, commit }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const selected = navItems.findIndex((item) =>
    item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`)
  );

  return (
    <div className="app-shell">
      <div className="app-shell__frame">
        <div className="app-shell__header">
          <BlockStack gap="150">
            <BlockStack gap="050">
              <Text as="p" variant="bodySm" tone="subdued">
                Shopify Payments disputes
              </Text>
              <Text as="h1" variant="headingLg">
                Disputes Co-Pilot
              </Text>
            </BlockStack>
            <Tabs
              fitted
              onSelect={(index) => router.push(navItems[index]?.href ?? "/dashboard")}
              selected={selected < 0 ? 0 : selected}
              tabs={navItems.map((item) => ({
                id: item.href,
                content: item.label
              }))}
            />
            <Text as="p" tone="subdued" variant="bodySm">
              {`${release} · ${commit}`}
            </Text>
          </BlockStack>
        </div>

        <Box paddingBlockStart="400">{children}</Box>
      </div>
    </div>
  );
}
