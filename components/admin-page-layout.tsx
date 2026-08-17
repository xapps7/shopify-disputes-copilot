"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
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
  /**
   * Names the parent of a sub-page. Without it a page reached from elsewhere
   * looks top-level, and the merchant has to guess which tab owns it.
   */
  backAction?: { content: string; url: string };
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
  backAction,
  banner,
  mode = "resource",
  gap = "500",
  children
}: AdminPageLayoutProps) {
  const searchParams = useSearchParams();

  const withEmbeddedParams = useMemo(() => {
    const query = searchParams.toString();

    return (url?: string) => {
      if (!url || !query || url.startsWith("http://") || url.startsWith("https://")) {
        return url;
      }

      return `${url}${url.includes("?") ? "&" : "?"}${query}`;
    };
  }, [searchParams]);

  const resolvedPrimaryAction = primaryAction
    ? {
        ...primaryAction,
        url: withEmbeddedParams(primaryAction.url)
      }
    : undefined;

  const resolvedSecondaryActions = secondaryActions?.map((action) => ({
    ...action,
    url: withEmbeddedParams(action.url)
  }));

  return (
    <Page
      title={title}
      subtitle={subtitle}
      backAction={
        backAction ? { ...backAction, url: withEmbeddedParams(backAction.url) as string } : undefined
      }
      primaryAction={resolvedPrimaryAction}
      secondaryActions={resolvedSecondaryActions}
    >
      <BlockStack gap={gap}>
        {banner}
        {children}
      </BlockStack>
    </Page>
  );
}
