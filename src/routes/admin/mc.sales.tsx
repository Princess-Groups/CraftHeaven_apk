import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useMemo } from "react";
import { TrendingUp, Search, Download } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/mc/sales")({
  head: () => ({ meta: [{ title: "Sales Management — Multi-Channel" }] }),
  component: MCSales,
});

function MCSales() {
  const [channelFilter, setChannelFilter] = useState("ALL");
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [searchQ, setSearchQ] = useState("");

  const { data: sales } = useQuery({
    queryKey: ["mc-sales", channelFilter, dateFrom, dateTo],
    queryFn: async () => {
      let q = supabase
        .from("mc_sales_transactions")
        .select("*")
        .gte("created_at", `${dateFrom}T00:00:00`)
        .lte("created_at", `${dateTo}T23:59:59`)
        .order("created_at", { ascending: false });
      if (channelFilter !== "ALL") q = q.eq("channel", channelFilter);
      return (await q).data ?? [];
    },
  });

  const filtered = useMemo(() => {
    if (!searchQ.trim()) return sales ?? [];
    const q = searchQ.toLowerCase();
    return (sales ?? []).filter(
      (s) => s.customer_name?.toLowerCase().includes(q) || s.channel?.toLowerCase().includes(q),
    );
  }, [searchQ, sales]);

  const stats = useMemo(() => {
    const list = sales ?? [];
    const totalRevenue = list.reduce((s, t) => s + (Number(t.total) || 0), 0);
    const totalTax = list.reduce((s, t) => s + (Number(t.tax) || 0), 0);
    const totalFees = list.reduce((s, t) => s + (Number(t.platform_fees) || 0), 0);
    const totalDiscount = list.reduce((s, t) => s + (Number(t.discount) || 0), 0);
    const byChannel: Record<string, { count: number; revenue: number }> = {};
    for (const t of list) {
      const ch = t.channel ?? "UNKNOWN";
      if (!byChannel[ch]) byChannel[ch] = { count: 0, revenue: 0 };
      byChannel[ch].count++;
      byChannel[ch].revenue += Number(t.total) || 0;
    }
    return { totalRevenue, totalTax, totalFees, totalDiscount, byChannel, count: list.length };
  }, [sales]);

  function exportCSV() {
    const headers = ["Date", "Channel", "Customer", "Subtotal", "Discount", "Tax", "Shipping", "Platform Fees", "Total", "Payment Status", "Order Status"];
    const rows = filtered.map((s) => [
      new Date(s.created_at).toLocaleDateString("en-IN"),
      s.channel, s.customer_name || "", s.subtotal, s.discount, s.tax, s.shipping, s.platform_fees, s.total, s.payment_status, s.order_status,
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `mc-sales-${dateFrom}-to-${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Sales exported");
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <TrendingUp className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold text-foreground flex-1">Sales Management</h1>
        <button onClick={exportCSV} className="flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-secondary-soft">
          <Download className="h-3.5 w-3.5" /> Export CSV
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Total Sales", value: `₹${stats.totalRevenue.toLocaleString("en-IN")}`, color: "text-emerald-600" },
          { label: "Transactions", value: stats.count },
          { label: "Total Tax", value: `₹${stats.totalTax.toLocaleString("en-IN")}` },
          { label: "Platform Fees", value: `₹${stats.totalFees.toLocaleString("en-IN")}` },
          { label: "Discounts", value: `₹${stats.totalDiscount.toLocaleString("en-IN")}`, color: "text-rose-600" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-white p-3 shadow-sm text-center">
            <div className={`text-lg font-bold ${s.color || "text-foreground"}`}>{s.value}</div>
            <div className="text-[10px] font-semibold uppercase text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Channel Breakdown */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Object.entries(stats.byChannel).map(([ch, data]) => (
          <div key={ch} className="rounded-xl border border-border bg-white p-3 shadow-sm">
            <div className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded inline-block mb-1 ${
              ch === "WEBSITE" ? "bg-blue-50 text-blue-700" :
              ch === "AMAZON" ? "bg-amber-50 text-amber-700" :
              ch === "FLIPKART" ? "bg-indigo-50 text-indigo-700" :
              "bg-rose-50 text-rose-700"
            }`}>{ch}</div>
            <div className="text-sm font-bold">{data.count} orders</div>
            <div className="text-xs text-muted-foreground">₹{data.revenue.toLocaleString("en-IN")}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg border border-border bg-white p-0.5">
          {["ALL", "WEBSITE", "AMAZON", "FLIPKART", "MEESHO"].map((ch) => (
            <button key={ch} onClick={() => setChannelFilter(ch)} className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${channelFilter === ch ? "bg-primary text-white" : "text-muted-foreground hover:bg-secondary-soft"}`}>
              {ch === "ALL" ? "All" : ch}
            </button>
          ))}
        </div>
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded-lg border border-border bg-white px-2 py-1.5 text-xs" />
        <span className="text-xs text-muted-foreground">to</span>
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded-lg border border-border bg-white px-2 py-1.5 text-xs" />
        <div className="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-1.5 shadow-sm ml-auto">
          <Search className="h-4 w-4 text-muted-foreground/70" />
          <input value={searchQ} onChange={(e) => setSearchQ(e.target.value)} placeholder="Search…" className="bg-transparent text-sm outline-none w-32" />
        </div>
      </div>

      {/* Sales Table */}
      <div className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-muted">
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-left border-b border-border">#</th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-left border-b border-border">Date</th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-center border-b border-border">Channel</th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-left border-b border-border">Customer</th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-right border-b border-border">Subtotal</th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-right border-b border-border">Tax</th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-right border-b border-border">Fees</th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-right border-b border-border">Total</th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-center border-b border-border">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s, i) => (
              <tr key={s.id} className="border-b border-border/50 last:border-0 hover:bg-secondary-soft/20">
                <td className="px-3 py-2 text-xs text-muted-foreground">{i + 1}</td>
                <td className="px-3 py-2 text-xs">{new Date(s.created_at).toLocaleDateString("en-IN")}</td>
                <td className="px-3 py-2 text-center">
                  <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                    s.channel === "WEBSITE" ? "bg-blue-50 text-blue-700" :
                    s.channel === "AMAZON" ? "bg-amber-50 text-amber-700" :
                    s.channel === "FLIPKART" ? "bg-indigo-50 text-indigo-700" :
                    "bg-rose-50 text-rose-700"
                  }`}>{s.channel}</span>
                </td>
                <td className="px-3 py-2 text-xs font-semibold">{s.customer_name || "—"}</td>
                <td className="px-3 py-2 text-xs text-right">₹{Number(s.subtotal ?? 0).toLocaleString("en-IN")}</td>
                <td className="px-3 py-2 text-xs text-right">₹{Number(s.tax ?? 0).toLocaleString("en-IN")}</td>
                <td className="px-3 py-2 text-xs text-right">₹{Number(s.platform_fees ?? 0).toLocaleString("en-IN")}</td>
                <td className="px-3 py-2 text-xs text-right font-bold">₹{Number(s.total ?? 0).toLocaleString("en-IN")}</td>
                <td className="px-3 py-2 text-center">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                    s.payment_status === "PAID" ? "bg-green-50 text-green-700" :
                    s.payment_status === "PENDING" ? "bg-amber-50 text-amber-700" :
                    "bg-gray-50 text-gray-600"
                  }`}>{s.payment_status || "—"}</span>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="px-6 py-12 text-center text-xs text-muted-foreground/70">No sales transactions found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
