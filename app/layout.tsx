import "./globals.css";

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Disputes Co-Pilot",
  description: "Shopify embedded app starter for dispute operations."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <div className="container">
            <header className="hero">
              <span className="eyebrow">Built for Shopify embedded app starter</span>
              <h1>Disputes and Chargeback Ops Co-Pilot</h1>
              <p>
                Shopify Payments dispute workspace for intake, evidence assembly, packet generation,
                and prevention recommendations.
              </p>
            </header>

            <nav className="nav">
              <Link href="/">Home</Link>
              <Link href="/dashboard">Dashboard</Link>
              <Link href="/settings">Settings</Link>
            </nav>

            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
