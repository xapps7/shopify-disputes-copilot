"use client";

import { BlockStack, Page } from "@shopify/polaris";

type PageAction = {
  content: string;
  url?: string;
  onAction?: () => void | Promise<void>;
  loading?: boolean;
  disabled?: boolean;
  external?: boolean;
};

type AdminPageLayoutProps = {
  title: string;
  subtitle?: string;
  primaryAction?: PageAction;
  secondaryActions?: PageAction[];
  banner?: React.ReactNode;
  mode?: "resource" | "form";
  gap?: "200" | "300" | "400" | "500" | "600";
  children: React.ReactNode;
};

export function AdminPageLayout({
  title,
  subtitle,
  primaryAction,
  secondaryActions,
  banner,
  mode = "resource",
  gap = "500",
  children
}: AdminPageLayoutProps) {
  return (
    <Page
      fullWidth={mode === "resource"}
      title={title}
      subtitle={subtitle}
      primaryAction={primaryAction}
      secondaryActions={secondaryActions}
    >
      <BlockStack gap={gap}>
        {banner}
        {children}
      </BlockStack>
    </Page>
  );
}
