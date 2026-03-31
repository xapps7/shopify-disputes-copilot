import { DashboardHero } from "@/components/dashboard-hero";
import { DashboardInsights } from "@/components/dashboard-insights";
import { DisputesTable } from "@/components/disputes-table";
import { DisputePriorities } from "@/components/dispute-priorities";
import { MetricCard } from "@/components/metric-card";
import { generateDashboardInsights } from "@/lib/ai/dashboard-insights";
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
        <MetricCard
          label="Immediate attention"
          value={String(urgentDisputes.length)}
          hint="Due today or tomorrow."
        />
      </section>

      <section className="ops-strip">
        <div className="ops-strip-card">
          <span className="ops-strip-label">Urgent lane</span>
          <strong>{urgentDisputes.length} disputes need action inside 48 hours</strong>
          <p>Prioritize due dates first, then close evidence gaps on low-readiness cases.</p>
        </div>
        <div className="ops-strip-card">
          <span className="ops-strip-label">Readiness drag</span>
          <strong>{lowReadiness.length} disputes are below 70% evidence readiness</strong>
          <p>Those are the cases most likely to stall packet preparation and deadline response.</p>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>AI operating guidance</h2>
            <p>Generated guidance for queue pressure, evidence posture, and the next operator actions.</p>
          </div>
        </div>
        <DashboardInsights insights={insights} />
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
            <p>Surface the next three disputes that combine weak readiness with the shortest runway.</p>
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

          <div className="panel dark-panel">
            <h3>Roadmap focus</h3>
            <ul className="list">
              <li>Turn the evidence shelf into a stronger in-app packet review surface.</li>
              <li>Tag every dispute outcome with a prevention takeaway for future orders.</li>
              <li>Move manual intake toward scheduled dispute collection once approval is granted.</li>
            </ul>
          </div>
        </aside>
      </section>
    </div>
  );
}
