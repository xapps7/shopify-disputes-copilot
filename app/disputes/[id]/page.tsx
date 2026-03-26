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
    <div className="two-col">
      <section className="panel">
        <h2>Dispute {dispute.shopifyDisputeId.split("/").pop()}</h2>
        <p>
          {dispute.currencyCode ?? "USD"} {dispute.amount} · {dispute.status} · {dispute.reason ?? "Unknown"}
        </p>
        <p>{dispute.reasonDetails ?? "No reason details available yet."}</p>

        {dispute.orderSummary ? (
          <>
            <h3>Order context</h3>
            <ul className="list">
              <li>Order: {dispute.orderSummary.orderName ?? "Unknown"}</li>
              <li>Customer: {dispute.orderSummary.customerName ?? "Unknown"}</li>
              <li>Email: {dispute.orderSummary.customerEmail ?? "Unknown"}</li>
              <li>Fulfillment: {dispute.orderSummary.fulfillmentStatus ?? "Unknown"}</li>
            </ul>
          </>
        ) : null}

        <h3>Evidence checklist</h3>
        <ul className="list">
          {dispute.evidenceChecklist.map((item) => (
            <li key={item.label}>
              {item.label} · {item.state === "ready" ? "ready" : "missing"}
            </li>
          ))}
        </ul>

        <h3>Evidence items</h3>
        <div className="stack">
          {dispute.evidenceItems.map((item) => (
            <div key={item.id} className="panel">
              <span className="pill">{item.category}</span>
              <h4>{item.title}</h4>
              <p>{item.description ?? "No description provided."}</p>
              <p>Source: {item.sourceType}</p>
              {item.fileUrl ? (
                <p>
                  File: <a className="table-link" href={item.fileUrl} target="_blank">Open</a>
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
