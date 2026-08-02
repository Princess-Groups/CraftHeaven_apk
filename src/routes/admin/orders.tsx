import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/orders")({
  head: () => ({ meta: [{ title: "Orders — ACH Admin" }] }),
  component: Orders,
});

const STATUSES = ["NEW", "PROCESSING", "PACKED", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"] as const;

function Orders() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"ONLINE" | "IN_STORE">("ONLINE");
  const [statusFilter, setStatusFilter] = useState<string>("");

  const { data: orders } = useQuery({
    queryKey: ["admin-orders", tab, statusFilter],
    queryFn: async () => {
      let q = supabase.from("orders").select("*").eq("channel", tab).order("created_at", { ascending: false }).limit(200);
      if (statusFilter) q = q.eq("status", statusFilter as never);
      const { data } = await q;
      return data ?? [];
    },
  });

  async function updateStatus(id: string, status: string) {
    // Route through a typed RPC — a direct .update() sends the enum value as text
    // and fails ("is of type order_status but expression is of type text").
    const { error } = await supabase.rpc("update_order_status", {
      _order_id: id,
      _status: status as never,
    });
    if (error) return toast.error(error.message);
    toast.success("Status updated");
    qc.invalidateQueries({ queryKey: ["admin-orders"] });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-slate-900 flex-1">Orders</h1>
        <div className="flex rounded-lg border border-slate-200 bg-white p-1">
          {(["ONLINE", "IN_STORE"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-1.5 text-xs font-semibold rounded ${tab === t ? "bg-secondary text-white" : "text-slate-600"}`}>
              {t === "ONLINE" ? "Online Orders" : "Offline Bills"}
            </button>
          ))}
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
        </select>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase text-slate-500">
            <tr><th className="p-3 text-left">Order</th><th className="p-3 text-left">Date</th><th className="p-3 text-right">Total</th><th className="p-3">Payment</th><th className="p-3">Status</th></tr>
          </thead>
          <tbody>
            {(orders ?? []).map((o) => (
              <tr key={o.id} className="border-t border-slate-100">
                <td className="p-3 font-mono text-xs">#{o.id.slice(0, 8).toUpperCase()}</td>
                <td className="p-3 text-xs text-slate-600">{new Date(o.created_at).toLocaleString()}</td>
                <td className="p-3 text-right font-semibold">₹{Number(o.total).toFixed(2)}</td>
                <td className="p-3 text-center text-xs"><span className="rounded bg-slate-100 px-2 py-0.5">{o.payment_method}</span></td>
                <td className="p-3">
                  <select value={o.status} onChange={(e) => updateStatus(o.id, e.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs">
                    {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
                  </select>
                </td>
              </tr>
            ))}
            {!orders?.length && <tr><td colSpan={5} className="p-8 text-center text-xs text-slate-400">No orders</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
