import { DashboardHero } from "@/components/dashboard-hero";
import { DisputesTable } from "@/components/disputes-table";
import { DisputePriorities } from "@/components/dispute-priorities";
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
      <DashboardHero
        avgReadiness={avgReadiness}
        openDisputes={openDisputes.length}
        totalAmount={totalAmount}
      />

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

      <section className="two-col dashboard-layout">
        <div className="panel">
          <div className="section-heading">
            <div>
              <h2>Disputes queue</h2>
              <p>
                Live operating queue sourced from Prisma when shop data exists, with seeded fallback
                records before the first sync.
              </p>
            </div>
            <SyncDisputesButton />
          </div>
          <DisputesTable disputes={disputes} />
        </div>

        <aside className="stack">
          <div className="panel accent-panel">
            <h3>Priority lane</h3>
            <p>Surface the next three disputes that are closest to deadline or least prepared.</p>
            <DisputePriorities disputes={disputes} />
          </div>

          <div className="panel">
            <h3>Operator standard</h3>
            <ul className="list">
              <li>Sync the queue at the start of every review cycle.</li>
              <li>Fill checklist gaps before drafting the packet.</li>
              <li>Capture refund attempts and customer communication explicitly.</li>
              <li>Do not promise outcomes; optimize completeness and timing.</li>
            </ul>
          </div>
        </aside>
      </section>
    </div>
  );
}
