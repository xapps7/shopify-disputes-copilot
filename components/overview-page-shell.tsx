"use client";

import Link from "next/link";
import { Card, Page, Text } from "@shopify/polaris";

export function OverviewPageShell() {
  return (
    <Page title="Overview" subtitle="Run your dispute desk where the order data already lives.">
      <div className="stack">
        <Card>
          <div className="hero-band hero-band-home">
            <div>
              <p className="hero-kicker">Built for operators, not spreadsheets</p>
              <h2>Centralize every active dispute into one deliberate operating workflow.</h2>
              <p className="hero-copy">
                Use the dashboard as the control room: sync disputes, prioritize due dates, draft seller
                responses, and keep evidence quality ahead of the deadline.
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
          </div>
        </Card>

        <section className="two-col">
          <div className="panel">
            <h3>Current product surface</h3>
            <ul className="list">
              <li>Embedded Shopify admin experience</li>
              <li>Manual dispute sync from Shopify GraphQL</li>
              <li>Evidence uploads and packet draft generation</li>
              <li>AI-assisted merchant reply drafting</li>
              <li>Protected-data webhook registration fallback</li>
            </ul>
          </div>

          <div className="panel">
            <h3>Immediate next move</h3>
            <Text as="p" variant="bodyMd">
              Review the queue in the dashboard, then open a dispute workspace to tighten the packet
              before submission.
            </Text>
            <div className="hero-actions">
              <Link className="pill-link" href="/dashboard">
                Open dashboard
              </Link>
            </div>
          </div>
        </section>
      </div>
    </Page>
  );
}
