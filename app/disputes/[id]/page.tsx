import { getDisputeDetail } from "@/lib/disputes/repository";
import { EvidenceUploadForm } from "@/components/evidence-upload-form";
import { GeneratePacketButton } from "@/components/generate-packet-button";

type DisputePageProps = {
  params: Promise<{ id: string }>;
};

export default async function DisputeDetailPage({ params }: DisputePageProps) {
  const { id } = await params;
  const dispute = await getDisputeDetail(id);

  return (
    <div className="two-col dispute-layout">
      <section className="panel">
        <div className="case-header">
          <div>
            <p className="hero-kicker">Case workspace</p>
            <h2>Dispute {dispute.shopifyDisputeId.split("/").pop()}</h2>
          </div>
          <div className="case-header-meta">
            <span className="pill">{dispute.status}</span>
            <strong>
              {dispute.currencyCode ?? "USD"} {dispute.amount}
            </strong>
          </div>
        </div>
        <p>{dispute.reasonDetails ?? "No reason details available yet."}</p>

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
                <span>{item.label}</span>
                <strong>{item.state === "ready" ? "Ready" : "Missing"}</strong>
              </div>
            ))}
          </div>
        </div>

        <h3>Evidence library</h3>
        <div className="stack">
          {dispute.evidenceItems.map((item) => (
            <div key={item.id} className="evidence-card">
              <span className="pill">{item.category}</span>
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
          <EvidenceUploadForm disputeId={dispute.id} />
        </div>

        <div className="panel">
          <h3>Packet draft</h3>
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
          <ul className="list">
            {dispute.timeline.map((event) => (
              <li key={event.id}>
                {event.eventType} · {new Date(event.eventTimestamp).toLocaleString()} · {event.source}
              </li>
            ))}
          </ul>
        </div>

        <div className="panel">
          <h3>Next implementation</h3>
          <ul className="list">
            <li>Render richer packet preview in-app</li>
            <li>Generate PDF rather than text draft</li>
            <li>Enable evidence submission after API validation</li>
            <li>Pull refunds and customer communication connectors</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
