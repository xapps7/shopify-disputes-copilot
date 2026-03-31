import { getDisputeDetail } from "@/lib/disputes/repository";
import { EvidenceUploadForm } from "@/components/evidence-upload-form";
import { GeneratePacketButton } from "@/components/generate-packet-button";
import { DisputeResponseDraft } from "@/components/dispute-response-draft";
import { generateDisputeResponseDraft } from "@/lib/ai/dispute-drafts";

type DisputePageProps = {
  params: Promise<{ id: string }>;
};

export default async function DisputeDetailPage({ params }: DisputePageProps) {
  const { id } = await params;
  const dispute = await getDisputeDetail(id);
  const responseDraft = generateDisputeResponseDraft(dispute);
  const readyEvidence = dispute.evidenceChecklist.filter((item) => item.state === "ready").length;
  const readinessScore =
    dispute.evidenceChecklist.length > 0
      ? Math.round((readyEvidence / dispute.evidenceChecklist.length) * 100)
      : 0;

  return (
    <div className="two-col dispute-layout">
      <section className="panel">
        <div className="case-header">
          <div>
            <p className="hero-kicker">Case workspace</p>
            <h2>Dispute {dispute.shopifyDisputeId.split("/").pop()}</h2>
            <p className="case-summary">
              {dispute.reason?.replaceAll("_", " ") ?? "Unknown reason"} · due{" "}
              {dispute.evidenceDueBy
                ? new Intl.DateTimeFormat("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric"
                  }).format(new Date(dispute.evidenceDueBy))
                : "not set"}
            </p>
          </div>
          <div className="case-header-meta">
            <span className="status-pill status-pill-warning">{dispute.status.replaceAll("_", " ")}</span>
            <strong>
              {dispute.currencyCode ?? "USD"} {dispute.amount}
            </strong>
          </div>
        </div>
        <p>{dispute.reasonDetails ?? "No reason details available yet."}</p>

        <div className="case-score-band">
          <div className="case-score-card">
            <span>Checklist coverage</span>
            <strong>{readinessScore}%</strong>
            <p>
              {readyEvidence} of {dispute.evidenceChecklist.length} expected evidence categories are
              ready.
            </p>
          </div>
          <div className="case-score-card">
            <span>Packet status</span>
            <strong>{dispute.latestPacket?.status ?? "Not drafted"}</strong>
            <p>
              {dispute.latestPacket
                ? `Version ${dispute.latestPacket.version} is available for review.`
                : "Generate a draft once the evidence shelf is complete."}
            </p>
          </div>
        </div>

        {dispute.orderSummary ? (
          <div className="detail-block">
            <h3>Order context</h3>
            <div className="detail-grid">
              <div className="detail-tile">
                <span>Order</span>
                <strong>{dispute.orderSummary.orderName ?? "Unknown"}</strong>
              </div>
              <div className="detail-tile">
                <span>Customer</span>
                <strong>{dispute.orderSummary.customerName ?? "Unknown"}</strong>
              </div>
              <div className="detail-tile">
                <span>Email</span>
                <strong>{dispute.orderSummary.customerEmail ?? "Unknown"}</strong>
              </div>
              <div className="detail-tile">
                <span>Fulfillment</span>
                <strong>{dispute.orderSummary.fulfillmentStatus ?? "Unknown"}</strong>
              </div>
            </div>
          </div>
        ) : null}

        <div className="detail-block">
          <h3>Evidence checklist</h3>
          <div className="checklist-grid">
            {dispute.evidenceChecklist.map((item) => (
              <div className={`checklist-item checklist-item-${item.state}`} key={item.label}>
                <div>
                  <span>{item.label}</span>
                  <p className="checklist-caption">
                    {item.state === "ready"
                      ? "Captured in the evidence shelf and available for packet assembly."
                      : "Still missing from the current record set."}
                  </p>
                </div>
                <strong>{item.state === "ready" ? "Ready" : "Missing"}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="detail-block">
          <DisputeResponseDraft disputeId={dispute.id} initialDraft={responseDraft} />
        </div>

        <h3>Evidence library</h3>
        <div className="stack">
          {dispute.evidenceItems.map((item) => (
            <div key={item.id} className="evidence-card">
              <span className="pill">{item.category.replaceAll("_", " ")}</span>
              <h4>{item.title}</h4>
              <p>{item.description ?? "No description provided."}</p>
              <p className="evidence-meta">Source: {item.sourceType}</p>
              {item.fileUrl ? (
                <p>
                  File:{" "}
                  <a className="table-link" href={item.fileUrl} rel="noreferrer" target="_blank">
                    Open
                  </a>
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <aside className="stack">
        <div className="panel">
          <h3>Add merchant evidence</h3>
          <p className="supporting-copy">
            Attach files or merchant notes that close missing checklist categories.
          </p>
          <EvidenceUploadForm disputeId={dispute.id} />
        </div>

        <div className="panel">
          <h3>Packet draft</h3>
          <p className="supporting-copy">
            Build the current case packet from the evidence shelf and merchant profile settings.
          </p>
          <GeneratePacketButton disputeId={dispute.id} />
          {dispute.latestPacket ? (
            <ul className="list">
              <li>Version: {dispute.latestPacket.version}</li>
              <li>Status: {dispute.latestPacket.status}</li>
              <li>
                File:{" "}
                {dispute.latestPacket.pdfUrl ? (
                  <a className="table-link" href={dispute.latestPacket.pdfUrl} target="_blank">
                    Open draft
                  </a>
                ) : (
                  "Not generated"
                )}
              </li>
            </ul>
          ) : (
            <p>No packet generated yet.</p>
          )}
        </div>

        <div className="panel">
          <h3>Timeline</h3>
          <ul className="timeline-list">
            {dispute.timeline.map((event) => (
              <li key={event.id}>
                <strong>{event.eventType.replaceAll("_", " ")}</strong>
                <span>{new Date(event.eventTimestamp).toLocaleString()}</span>
                <span>{event.source}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="panel">
          <h3>Next implementation</h3>
          <ul className="list">
            <li>Connect live model inference instead of rules-only drafting</li>
            <li>Render richer packet preview in-app</li>
            <li>Enable evidence submission after API validation</li>
            <li>Pull refunds and customer communication connectors</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
