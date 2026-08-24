"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { BlockStack, Page, Text } from "@shopify/polaris";

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
  /**
   * A quiet caveat about the page's own data - a truncated list, a stale
   * figure. Deliberately NOT a banner: the one-banner rule exists because a
   * screen full of warnings gets none of them read, and "this list is a slice"
   * is a caveat rather than an emergency. It still has to be said out loud,
   * because a page that silently shows part of the data is lying.
   */
  subduedNote?: string;
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
  subduedNote,
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
        {subduedNote ? (
          <Text as="p" variant="bodySm" tone="subdued">
            {subduedNote}
          </Text>
        ) : null}
        {children}
      </BlockStack>
    </Page>
  );
}
