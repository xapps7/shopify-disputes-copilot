import { notFound } from "next/navigation";

import { PacketPreviewPageShell } from "@/components/packet-preview-page-shell";
import { getDisputeDetail } from "@/lib/disputes/repository";
import { requireMerchant } from "@/lib/disputes/tenant";
import { getEmbeddedPageShop } from "@/lib/shopify/page-context";
import type { DisputeDetailView } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PacketPreviewPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

async function loadDispute(
  id: string,
  searchParams?: Record<string, string | string[] | undefined>
): Promise<DisputeDetailView | null> {
  // Scoped to the authenticated merchant: a dispute belonging to another shop
  // must be indistinguishable from one that does not exist.
  const shopDomain = await getEmbeddedPageShop(searchParams, `/packets/${id}`);
  if (!shopDomain) {
    return null;
  }

  try {
    const merchant = await requireMerchant(shopDomain);
    return await getDisputeDetail(id, merchant.id);
  } catch (error) {
    if (error instanceof Error && /not found|not installed/i.test(error.message)) {
      return null;
    }

    throw error;
  }
}

export default async function PacketPreviewPage({ params, searchParams }: PacketPreviewPageProps) {
  const { id } = await params;
  const dispute = await loadDispute(id, searchParams ? await searchParams : undefined);

  if (!dispute) {
    notFound();
  }

  return <PacketPreviewPageShell dispute={dispute} />;
}
