import Link from "next/link";

import type { DashboardDispute } from "@/lib/types";

type DisputesTableProps = {
  disputes: DashboardDispute[];
};

function formatDate(value: string | null) {
  if (!value) {
    return "No deadline";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value));
}

function dueBadge(value: string | null) {
  if (!value) {
    return { label: "No deadline", tone: "neutral" };
  }

  const delta = Math.ceil((new Date(value).getTime() - Date.now()) / (1000 * 60 * 60 * 24));

  if (delta < 0) {
    return { label: "Past due", tone: "critical" };
  }

  if (delta <= 1) {
    return { label: delta === 0 ? "Due today" : "Due tomorrow", tone: "warning" };
  }

  return { label: `Due in ${delta}d`, tone: "neutral" };
}

function statusTone(status: string) {
  if (status.includes("WARNING") || status === "NEEDS_RESPONSE") {
    return "warning";
  }

  if (status === "UNDER_REVIEW") {
    return "info";
  }

  if (status === "WON") {
    return "success";
  }

  return "neutral";
}

export function DisputesTable({ disputes }: DisputesTableProps) {
  return (
    <div className="table-shell">
      <table className="disputes-table">
        <thead>
          <tr>
            <th>Dispute</th>
            <th>Reason</th>
            <th>Status</th>
            <th>Amount</th>
            <th>Due</th>
            <th>Ready</th>
          </tr>
        </thead>
        <tbody>
          {disputes.map((dispute) => (
            <tr key={dispute.id}>
              <td>
                <div className="table-primary">
                  <Link className="table-link" href={`/disputes/${dispute.id}`}>
                    {dispute.shopifyDisputeId.split("/").pop()}
                  </Link>
                  <span className="table-subtle">
                    {dispute.shopifyOrderId?.split("/").pop()
                      ? `Order ${dispute.shopifyOrderId.split("/").pop()}`
                      : "Order unavailable"}
                  </span>
                </div>
              </td>
              <td>{(dispute.reason ?? "Unknown").replaceAll("_", " ")}</td>
              <td>
                <span className={`status-pill status-pill-${statusTone(dispute.status)}`}>
                  {dispute.status.replaceAll("_", " ")}
                </span>
              </td>
              <td>
                {dispute.currencyCode ?? "USD"} {dispute.amount}
              </td>
              <td>
                <div className="table-primary">
                  <span>{formatDate(dispute.evidenceDueBy)}</span>
                  <span className={`table-subtle table-subtle-${dueBadge(dispute.evidenceDueBy).tone}`}>
                    {dueBadge(dispute.evidenceDueBy).label}
                  </span>
                </div>
              </td>
              <td>
                <div className="readiness-cell">
                  <div className="readiness-track" aria-hidden="true">
                    <span style={{ width: `${dispute.completenessScore}%` }} />
                  </div>
                  <strong>{dispute.completenessScore}%</strong>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
