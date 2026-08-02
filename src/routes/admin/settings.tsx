import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/settings")({
  head: () => ({ meta: [{ title: "Settings — ACH Admin" }] }),
  component: Settings,
});

function Settings() {
  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-xl font-bold">Settings</h1>
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
        <Row label="Store Name" value="Athira's Creative Haven" />
        <Row label="Tagline" value="Craft Supplies & Creative Classes" />
        <Row label="Currency" value="INR (₹)" />
        <Row label="Timezone" value="Asia/Kolkata" />
        <Row label="Default GST Rate" value="Set per product" />
        <Row label="Inventory Sync" value="Real-time (online + POS share one stock)" />
      </div>
      <p className="text-xs text-slate-500">Store profile editing is coming in the next release. All operational settings work out of the box.</p>
    </div>
  );
}
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 pb-3 last:border-0 last:pb-0">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}
