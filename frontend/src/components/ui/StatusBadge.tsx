export function despatchStatusLabel(status: string | undefined): string {
  if (!status) return "Unknown";
  const s = status.toUpperCase();
  if (s === "DRAFT") return "Pending";
  if (s === "DESPATCHED") return "Sent";
  if (s === "RECEIVED") return "Received";
  if (s.includes("CANCEL")) return "Cancelled";
  return status;
}

export function StatusBadge({ status }: { status: string | undefined }) {
  if (!status) return <span className="badge badge-dim">Unknown</span>;
  const s = status.toUpperCase();
  if (s === "DESPATCHED") return <span className="badge badge-blue">Sent</span>;
  if (s === "RECEIVED") return <span className="badge badge-green">Received</span>;
  if (s.includes("CANCEL")) return <span className="badge badge-red">Cancelled</span>;
  if (s === "DRAFT") return <span className="badge badge-orange">Pending</span>;
  return <span className="badge badge-orange">{status}</span>;
}
