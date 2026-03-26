import Link from "next/link";

export default function HomePage() {
  return (
    <div className="stack">
      <section className="panel">
        <h2>Current implementation</h2>
        <p>
          This starter ships the core backend and UI skeleton for a Shopify embedded dispute app:
          webhook endpoints, dispute persistence, dashboard views, and the first dispute detail
          workspace.
        </p>
        <p>
          The next build steps are Shopify OAuth, webhook registration, storage-backed file uploads,
          and async evidence-packet generation.
        </p>
      </section>

      <section className="two-col">
        <div className="panel">
          <h3>Included now</h3>
          <ul className="list">
            <li>Next.js TypeScript app scaffold</li>
            <li>Prisma schema for dispute operations data</li>
            <li>Webhook routes for disputes and privacy compliance</li>
            <li>Dashboard and dispute detail routes</li>
            <li>Shopify GraphQL client helper stubs</li>
          </ul>
        </div>

        <div className="panel">
          <h3>Go next</h3>
          <p>Open the dashboard route to inspect the first embedded experience.</p>
          <Link className="pill-link" href="/dashboard">
            Open dashboard
          </Link>
        </div>
      </section>
    </div>
  );
}
