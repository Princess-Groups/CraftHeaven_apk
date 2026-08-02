import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";

export const Route = createFileRoute("/admin/reports")({
  head: () => ({ meta: [{ title: "Reports — ACH Admin" }] }),
  component: Reports,
});

function Reports() {
  const [period, setPeriod] = useState<"daily" | "monthly" | "yearly">("daily");

  const { data } = useQuery({
    queryKey: ["report", period],
    queryFn: async () => {
      const now = new Date();
      const from =
        period === "daily" ? new Date(now.getTime() - 30 * 864e5)
        : period === "monthly" ? new Date(now.getFullYear(), now.getMonth() - 11, 1)
        : new Date(now.getFullYear() - 4, 0, 1);
      const { data: orders } = await supabase.from("orders").select("total,channel,created_at,status").gte("created_at", from.toISOString());
      const { data: purchases } = await supabase.from("purchases").select("total,created_at").gte("created_at", from.toISOString());
      const os = orders ?? [];
      return {
        totalSales: os.reduce((s, o) => s + Number(o.total), 0),
        online: os.filter((o) => o.channel === "ONLINE").reduce((s, o) => s + Number(o.total), 0),
        offline: os.filter((o) => o.channel === "IN_STORE").reduce((s, o) => s + Number(o.total), 0),
        orderCount: os.length,
        cancelled: os.filter((o) => o.status === "CANCELLED").length,
        purchaseTotal: (purchases ?? []).reduce((s, p) => s + Number(p.total), 0),
      };
    },
  });

  function exportCsv() {
    if (!data) return;
    const rows = [
      ["Metric", "Value"],
      ["Period", period],
      ["Total Sales", data.totalSales],
      ["Online Sales", data.online],
      ["Offline Sales", data.offline],
      ["Orders", data.orderCount],
      ["Cancelled", data.cancelled],
      ["Purchases", data.purchaseTotal],
      ["Profit (est.)", data.totalSales - data.purchaseTotal],
    ];
    const csv = rows.map((r) => r.join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = `report-${period}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-bold flex-1">Reports</h1>
        <div className="flex rounded-lg border border-slate-200 bg-white p-1">
          {(["daily", "monthly", "yearly"] as const).map((p) => (
            <button key={p} onClick={() => setPeriod(p)} className={`px-4 py-1.5 text-xs font-semibold rounded ${period === p ? "bg-slate-900 text-white" : "text-slate-600"}`}>{p}</button>
          ))}
        </div>
        <button onClick={exportCsv} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold">Export CSV</button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          ["Total Sales", data?.totalSales],
          ["Online Sales", data?.online],
          ["Offline Sales", data?.offline],
          ["Purchases", data?.purchaseTotal],
          ["Profit (est.)", (data?.totalSales ?? 0) - (data?.purchaseTotal ?? 0)],
          ["Orders", data?.orderCount ?? 0],
          ["Cancelled", data?.cancelled ?? 0],
        ].map(([label, val]) => (
          <div key={label as string} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-[11px] uppercase text-slate-500">{label as string}</div>
            <div className="mt-1 text-xl font-bold">{typeof val === "number" && label !== "Orders" && label !== "Cancelled" ? `₹${Number(val).toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : val ?? 0}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
