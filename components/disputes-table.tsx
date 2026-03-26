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
                <Link className="table-link" href={`/disputes/${dispute.id}`}>
                  {dispute.shopifyDisputeId.split("/").pop()}
                </Link>
              </td>
              <td>{dispute.reason ?? "Unknown"}</td>
              <td>{dispute.status}</td>
              <td>
                {dispute.currencyCode ?? "USD"} {dispute.amount}
              </td>
              <td>{formatDate(dispute.evidenceDueBy)}</td>
              <td>{dispute.completenessScore}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
