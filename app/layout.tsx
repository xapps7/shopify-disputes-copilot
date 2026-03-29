import "./globals.css";

import type { Metadata } from "next";
import Link from "next/link";

import { EmbeddedAppRedirect } from "@/components/embedded-app-redirect";
import { RootRouteRedirect } from "@/components/root-route-redirect";
import { getCurrentHost, getCurrentShopDomain } from "@/lib/shopify/auth";

export const metadata: Metadata = {
  title: "Disputes Co-Pilot",
  description: "Shopify embedded app starter for dispute operations."
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const shopDomain = await getCurrentShopDomain();
  const host = await getCurrentHost();
  const apiKey = process.env.SHOPIFY_API_KEY ?? "";

  return (
    <html lang="en">
      <body>
        <EmbeddedAppRedirect apiKey={apiKey} host={host} shopDomain={shopDomain} />
        <RootRouteRedirect />
        <div className="shell">
          <div className="container">
            <header className="hero">
              <span className="eyebrow">Shopify Payments disputes cockpit</span>
              <h1>Disputes and Chargeback Ops Co-Pilot</h1>
              <p>
                Embedded operations software for triage, evidence assembly, packet generation, and
                prevention guidance inside Shopify Admin.
              </p>
            </header>

            <nav className="nav">
              <Link href="/dashboard">Dashboard</Link>
              <Link href="/">Overview</Link>
              <Link href="/settings">Settings</Link>
            </nav>

            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
