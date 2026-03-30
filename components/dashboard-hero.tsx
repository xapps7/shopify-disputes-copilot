type DashboardHeroProps = {
  openDisputes: number;
  totalAmount: number;
  avgReadiness: number;
};

export function DashboardHero({ openDisputes, totalAmount, avgReadiness }: DashboardHeroProps) {
  return (
    <section className="hero-band">
      <div>
        <p className="hero-kicker">Dispute command center</p>
        <h2>One operating surface for every Shopify Payments dispute.</h2>
        <p className="hero-copy">
          Triage due dates, assemble evidence, and turn scattered order records into a clean
          representment workflow before the deadline closes.
        </p>
        <div className="hero-inline-metrics">
          <div>
            <span>Open exposure</span>
            <strong>{openDisputes} active cases</strong>
          </div>
          <div>
            <span>Evidence posture</span>
            <strong>{avgReadiness}% average readiness</strong>
          </div>
        </div>
      </div>

      <div className="hero-stats">
        <div className="hero-stat-card">
          <span>Open queue</span>
          <strong>{openDisputes}</strong>
          <p>cases still active</p>
        </div>
        <div className="hero-stat-card">
          <span>Exposure</span>
          <strong>${totalAmount.toFixed(0)}</strong>
          <p>disputed gross value</p>
        </div>
        <div className="hero-stat-card">
          <span>Readiness</span>
          <strong>{avgReadiness}%</strong>
          <p>evidence completeness</p>
        </div>
      </div>
    </section>
  );
}
