"use client";

import { usePathname, useRouter } from "next/navigation";
import { BlockStack, Box, Tabs, Text } from "@shopify/polaris";

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
  const router = useRouter();
  const selectedTabIndex = navItems.findIndex((item) =>
    item.href === "/"
      ? pathname === "/"
      : item.href === "/disputes" && pathname.startsWith("/packets/")
        ? true
        : pathname === item.href || pathname.startsWith(`${item.href}/`)
  );

  return (
    <div className="app-shell">
      <Box paddingBlockStart="400" paddingBlockEnd="800">
        <div className="app-shell__frame">
          <BlockStack gap="400">
            <div className="app-shell__masthead">
              <BlockStack gap="300">
                <BlockStack gap="100">
                  <Text as="h1" variant="headingLg">
                    Disputes Co-Pilot
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Review cases, assemble evidence, and prepare dispute responses for Shopify Payments.
                  </Text>
                </BlockStack>
                <Tabs
                  tabs={navItems.map((item) => ({
                    id: item.href,
                    content: item.label,
                    accessibilityLabel: item.label
                  }))}
                  selected={selectedTabIndex >= 0 ? selectedTabIndex : 0}
                  onSelect={(selectedTab) => {
                    router.push(navItems[selectedTab]?.href ?? "/");
                  }}
                  fitted={false}
                />
              </BlockStack>
            </div>
            {children}
            <Text as="p" tone="subdued" variant="bodySm">
              {`${release} · ${commit}`}
            </Text>
          </BlockStack>
        </div>
      </Box>
    </div>
  );
}
