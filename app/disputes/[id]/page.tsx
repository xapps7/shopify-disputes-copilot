import { notFound } from "next/navigation";

import { getDisputeDetail } from "@/lib/disputes/repository";
import { requireMerchant } from "@/lib/disputes/tenant";
import { getEmbeddedPageShop } from "@/lib/shopify/page-context";
import { DisputePageShell } from "@/components/dispute-page-shell";
import { generateDisputeResponseDraft } from "@/lib/ai/dispute-drafts";
import { generatePackageAssessment } from "@/lib/ai/package-assessment";
import type { DisputeDetailView } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type DisputePageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * `getDisputeDetail` throws for an unknown id. Without this the app rendered
 * Next's raw error screen for a mistyped or stale dispute link; now it renders
 * the dispute not-found state.
 */
async function loadDispute(
  id: string,
  searchParams?: Record<string, string | string[] | undefined>
): Promise<DisputeDetailView | null> {
  // Scoped to the authenticated merchant: a dispute belonging to another shop
  // must be indistinguishable from one that does not exist.
  const shopDomain = await getEmbeddedPageShop(searchParams, `/disputes/${id}`);
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

export default async function DisputeDetailPage({ params, searchParams }: DisputePageProps) {
  const { id } = await params;
  const dispute = await loadDispute(id, searchParams ? await searchParams : undefined);

  if (!dispute) {
    notFound();
  }

  const responseDraft = generateDisputeResponseDraft(dispute);
  const packageAssessment = generatePackageAssessment(dispute);
  const readyEvidence = dispute.evidenceChecklist.filter((item) => item.state === "ready").length;
  const readinessScore =
    dispute.evidenceChecklist.length > 0
      ? Math.round((readyEvidence / dispute.evidenceChecklist.length) * 100)
      : 0;

  return (
    <DisputePageShell
      dispute={dispute}
      readinessScore={readinessScore}
      readyEvidence={readyEvidence}
      responseDraft={responseDraft}
      packageAssessment={packageAssessment}
    />
  );
}
