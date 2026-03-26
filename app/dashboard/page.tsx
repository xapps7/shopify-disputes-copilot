import { DisputesTable } from "@/components/disputes-table";
import { MetricCard } from "@/components/metric-card";
import { SyncDisputesButton } from "@/components/sync-disputes-button";
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

  return (
    <div className="stack">
      <section className="grid metrics">
        <MetricCard
          label="Open disputes"
          value={String(openDisputes.length)}
          hint="Needs response, review, or warning state."
        />
        <MetricCard
          label="Total disputed"
          value={`$${totalAmount.toFixed(2)}`}
          hint="Across the latest synced disputes."
        />
        <MetricCard
          label="Evidence readiness"
          value={`${avgReadiness}%`}
          hint="Based on attached evidence categories."
        />
      </section>

      <section className="panel">
        <h2>Disputes queue</h2>
        <p>
          This queue is currently sourced from Prisma when shop data exists, and falls back to seed
          records when the app is not yet installed on a shop.
        </p>
        <SyncDisputesButton />
        <DisputesTable disputes={disputes} />
      </section>
    </div>
  );
}
