"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BlockStack, Box, InlineStack, Text } from "@shopify/polaris";

type AppShellProps = {
  children: React.ReactNode;
  release: string;
  commit: string;
};

const navItems = [
  { href: "/", label: "Overview" },
  { href: "/disputes", label: "Disputes" },
  { href: "/evidence", label: "Evidence Library" },
  { href: "/analytics", label: "Analytics" },
  { href: "/recommendations", label: "Recommendations" },
  { href: "/settings", label: "Settings" }
] as const satisfies ReadonlyArray<{ href: string; label: string }>;

export function AppShell({ children, release, commit }: AppShellProps) {
  const pathname = usePathname();

  return (
    <div className="app-shell">
      <div className="app-shell__frame">
        <div className="app-shell__header">
          <BlockStack gap="100">
            <InlineStack align="space-between" blockAlign="end">
              <BlockStack gap="050">
                <Text as="h1" variant="headingLg">
                  Disputes Co-Pilot
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Shopify Payments disputes
                </Text>
              </BlockStack>
              <Text as="p" tone="subdued" variant="bodySm">
                {`${release} · ${commit}`}
              </Text>
            </InlineStack>
            <InlineStack gap="400">
              {navItems.map((item) => {
                const active =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname === item.href || pathname.startsWith(`${item.href}/`);

                return (
                  <Link
                    className={`app-shell__tab ${active ? "app-shell__tab--active" : ""}`}
                    href={item.href as never}
                    key={item.href}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </InlineStack>
          </BlockStack>
        </div>

        <Box paddingBlockStart="400">{children}</Box>
      </div>
    </div>
  );
}
