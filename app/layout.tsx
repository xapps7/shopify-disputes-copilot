import "@shopify/polaris/build/esm/styles.css";
import "./globals.css";

import type { Metadata } from "next";
import Link from "next/link";

import { EmbeddedAppRedirect } from "@/components/embedded-app-redirect";
import { PolarisProvider } from "@/components/polaris-provider";
import { getCurrentHost, getCurrentShopDomain } from "@/lib/shopify/auth";
import { APP_COMMIT, APP_RELEASE } from "@/lib/version";

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
      <head>
        {apiKey ? <meta name="shopify-api-key" content={apiKey} /> : null}
        <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
      </head>
      <body>
        <PolarisProvider>
          <EmbeddedAppRedirect apiKey={apiKey} host={host} shopDomain={shopDomain} />
          <div className="shell">
            <div className="container">
              <header className="hero">
                <span className="eyebrow">Shopify Payments disputes cockpit</span>
                <h1>Disputes and Chargeback Ops Co-Pilot</h1>
                <p>
                  Embedded operations software for triage, evidence assembly, packet generation, and
                  prevention guidance inside Shopify Admin.
                </p>
                <p className="release-badge">
                  Release {APP_RELEASE} · {APP_COMMIT}
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
        </PolarisProvider>
      </body>
    </html>
  );
}
