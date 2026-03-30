import type { DashboardDispute } from "@/lib/types";

type DisputePrioritiesProps = {
  disputes: DashboardDispute[];
};

function dueLabel(value: string | null) {
  if (!value) {
    return "No due date";
  }

  const due = new Date(value);
  const delta = Math.ceil((due.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

  if (delta < 0) {
    return "Past due";
  }

  if (delta === 0) {
    return "Due today";
  }

  if (delta === 1) {
    return "Due tomorrow";
  }

  return `Due in ${delta} days`;
}

export function DisputePriorities({ disputes }: DisputePrioritiesProps) {
  const topItems = [...disputes]
    .sort((a, b) => {
      if (a.completenessScore !== b.completenessScore) {
        return a.completenessScore - b.completenessScore;
      }

      if (!a.evidenceDueBy) return 1;
      if (!b.evidenceDueBy) return -1;
      return new Date(a.evidenceDueBy).getTime() - new Date(b.evidenceDueBy).getTime();
    })
    .slice(0, 3);

  return (
    <div className="priority-stack">
      {topItems.map((dispute) => (
        <div className="priority-card" key={dispute.id}>
          <div>
            <p className="priority-label">{dispute.reason ?? "Unknown reason"}</p>
            <h3>{dispute.shopifyDisputeId.split("/").pop()}</h3>
            <p className="priority-caption">
              {dispute.currencyCode ?? "USD"} {dispute.amount} at risk
            </p>
          </div>
          <div className="priority-meta">
            <span>{dueLabel(dispute.evidenceDueBy)}</span>
            <strong>{dispute.completenessScore}% ready</strong>
          </div>
        </div>
      ))}
    </div>
  );
}
