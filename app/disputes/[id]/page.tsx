import { getDisputeDetail } from "@/lib/disputes/repository";
import { DisputePageShell } from "@/components/dispute-page-shell";
import { generateDisputeResponseDraft } from "@/lib/ai/dispute-drafts";

type DisputePageProps = {
  params: Promise<{ id: string }>;
};

export default async function DisputeDetailPage({ params }: DisputePageProps) {
  const { id } = await params;
  const dispute = await getDisputeDetail(id);
  const responseDraft = generateDisputeResponseDraft(dispute);
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
    />
  );
}
