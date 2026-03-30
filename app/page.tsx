import Link from "next/link";
import { redirect } from "next/navigation";

import DashboardPage from "@/app/dashboard/page";

type HomePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function getSingleValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = (await searchParams) ?? {};
  const shop = getSingleValue(params.shop);
  const host = getSingleValue(params.host);

  if (shop || host) {
    return <DashboardPage />;
  }

  return (
    <div className="stack">
      <section className="hero-band hero-band-home">
        <div>
          <p className="hero-kicker">Built for operators, not spreadsheets</p>
          <h2>Run your dispute desk where the order data already lives.</h2>
          <p className="hero-copy">
            Centralize every active dispute, build evidence packs from live order context, and move
            merchants from frantic deadline chasing to deliberate operating discipline.
          </p>
        </div>
        <div className="hero-actions">
          <Link className="pill-link" href="/dashboard">
            Open command center
          </Link>
          <Link className="ghost-link" href="/settings">
            Configure merchant profile
          </Link>
        </div>
      </section>

      <section className="two-col">
        <div className="panel">
          <h3>Current product surface</h3>
          <ul className="list">
            <li>Embedded Shopify admin experience</li>
            <li>OAuth install and merchant persistence</li>
            <li>Manual dispute sync from Shopify GraphQL</li>
            <li>Evidence uploads and packet draft generation</li>
            <li>Protected-data webhook registration fallback</li>
          </ul>
        </div>

        <div className="panel">
          <h3>Immediate next move</h3>
          <p>
            Use the dashboard as the control room: sync disputes, prioritize due dates, and drill
            into a case workspace to attach missing evidence.
          </p>
          <Link className="pill-link" href="/dashboard">
            Open dashboard
          </Link>
        </div>
      </section>
    </div>
  );
}
