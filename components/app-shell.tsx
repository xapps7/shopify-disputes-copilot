"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { BlockStack, Box, Card, InlineStack, Text } from "@shopify/polaris";

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

  return (
    <div className="app-shell">
      <div className="app-shell__frame">
        <Card>
          <BlockStack gap="300">
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued">
                Shopify Payments dispute operations
              </Text>
              <Text as="h1" variant="headingLg">
                Disputes Co-Pilot
              </Text>
            </BlockStack>
            <InlineStack gap="200">
              {navItems.map((item) => {
                const active =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname === item.href || pathname.startsWith(`${item.href}/`);

                return (
                  <Link
                    className={`app-shell__nav-link ${active ? "app-shell__nav-link--active" : ""}`}
                    href={item.href}
                    key={item.href}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </InlineStack>
            <Text as="p" tone="subdued" variant="bodySm">
              {`${release} · ${commit}`}
            </Text>
          </BlockStack>
        </Card>

        <Box paddingBlockStart="400">{children}</Box>
      </div>
    </div>
  );
}
