import { DashboardPageShell } from "@/components/dashboard-page-shell";
import { generateDashboardInsights } from "@/lib/ai/dashboard-insights";
import { listDashboardDisputes } from "@/lib/disputes/repository";
import { getCurrentShopDomain } from "@/lib/shopify/auth";

export default async function DashboardPage() {
  const shopDomain = await getCurrentShopDomain();
  const disputes = await listDashboardDisputes(shopDomain);

  const openDisputes = disputes.filter((dispute) =>
    ["NEEDS_RESPONSE", "UNDER_REVIEW", "WARNING_NEEDS_RESPONSE"].includes(dispute.status)
  );
  const totalAmount = disputes.reduce((sum, dispute) => sum + Number(dispute.amount), 0);
  const avgReadiness =
    disputes.length > 0
      ? Math.round(disputes.reduce((sum, dispute) => sum + dispute.completenessScore, 0) / disputes.length)
      : 0;
  const urgentDisputes = disputes.filter((dispute) => {
    if (!dispute.evidenceDueBy) {
      return false;
    }

    const delta = Math.ceil((new Date(dispute.evidenceDueBy).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return delta <= 1;
  });
  const lowReadiness = disputes.filter((dispute) => dispute.completenessScore < 70);
  const insights = generateDashboardInsights(disputes);

  return (
    <DashboardPageShell
      avgReadiness={avgReadiness}
      disputes={disputes}
      insights={insights}
      lowReadinessCount={lowReadiness.length}
      openDisputes={openDisputes.length}
      totalAmount={totalAmount}
      urgentCount={urgentDisputes.length}
    />
  );
}
