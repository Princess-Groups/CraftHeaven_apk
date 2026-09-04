import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useMemo } from "react";
import { BarChart3, Download } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, PieChart, Pie, Cell, CartesianGrid, LineChart, Line } from "recharts";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/mc/reports")({
  head: () => ({ meta: [{ title: "Reports & Analytics — Multi-Channel" }] }),
  component: MCReports,
});

const TABS = ["overview", "sales", "inventory", "profit", "orders"] as const;
const COLORS = ["#6366f1", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#06b6d4"];

function MCReports() {
  const [tab, setTab] = useState<string>("overview");
  const [period, setPeriod] = useState("month");

  const dateRange = useMemo(() => {
    const now = new Date();
    const from = new Date();
    if (period === "today") from.setHours(0, 0, 0, 0);
    else if (period === "week") from.setDate(now.getDate() - 7);
    else if (period === "month") from.setMonth(now.getMonth() - 1);
    else from.setFullYear(now.getFullYear() - 1);
    return { from: from.toISOString(), to: now.toISOString() };
  }, [period]);

  const { data: orders } = useQuery({
    queryKey: ["mc-report-orders", dateRange],
    queryFn: async () =>
      (await supabase.from("mc_marketplace_orders").select("*, mc_marketplace_channels(channel)")
        .gte("created_at", dateRange.from).lte("created_at", dateRange.to)).data ?? [],
  });

  const { data: inventory } = useQuery({
    queryKey: ["mc-report-inv"],
    queryFn: async () =>
      (await supabase.from("mc_inventory").select("*, mc_master_products(name)").order("physical_stock")).data ?? [],
  });

  const { data: sales } = useQuery({
    queryKey: ["mc-report-sales", dateRange],
    queryFn: async () =>
      (await supabase.from("mc_sales_transactions").select("*")
        .gte("created_at", dateRange.from).lte("created_at", dateRange.to)).data ?? [],
  });

  const { data: costs } = useQuery({
    queryKey: ["mc-report-costs"],
    queryFn: async () =>
      (await supabase.from("mc_product_costs").select("*, mc_master_products(name)")).data ?? [],
  });

  const stats = useMemo(() => {
    const o = orders ?? [];
    const s = sales ?? [];
    const inv = inventory ?? [];
    return {
      totalOrders: o.length,
      totalRevenue: o.reduce((sum, x) => sum + (Number(x.total) || 0), 0),
      totalPlatformFees: o.reduce((sum, x) => sum + (Number(x.platform_fees) || 0), 0),
      delivered: o.filter((x) => x.status === "DELIVERED").length,
      cancelled: o.filter((x) => x.status === "CANCELLED").length,
      pending: o.filter((x) => ["NEW", "CONFIRMED", "PROCESSING"].includes(x.status)).length,
      totalStock: inv.reduce((sum, x) => sum + (Number(x.physical_stock) || 0), 0),
      lowStock: inv.filter((x) => (x.physical_stock ?? 0) > 0 && (x.physical_stock ?? 0) <= 5).length,
      outOfStock: inv.filter((x) => (x.physical_stock ?? 0) <= 0).length,
      totalCost: costs?.reduce((sum, x) => sum + (Number(x.landed_cost) || 0), 0) ?? 0,
    };
  }, [orders, sales, inventory, costs]);

  const channelSalesData = useMemo(() => {
    const map: Record<string, number> = {};
    for (const o of orders ?? []) {
      const ch = o.mc_marketplace_channels?.channel ?? "UNKNOWN";
      map[ch] = (map[ch] || 0) + (Number(o.total) || 0);
    }
    return Object.entries(map).map(([name, value]) => ({ name, value: Math.round(value) }));
  }, [orders]);

  const topProducts = useMemo(() => {
    const map: Record<string, { name: string; revenue: number; qty: number }> = {};
    for (const o of orders ?? []) {
      for (const item of (o as any).mc_marketplace_order_items ?? []) {
        const key = item.product_name;
        if (!map[key]) map[key] = { name: key, revenue: 0, qty: 0 };
        map[key].revenue += Number(item.total) || 0;
        map[key].qty += Number(item.quantity) || 0;
      }
    }
    return Object.values(map).sort((a, b) => b.revenue - a.revenue).slice(0, 8);
  }, [orders]);

  const lowStockProducts = useMemo(() => {
    return (inventory ?? []).filter((i) => (i.physical_stock ?? 0) <= (i.reorder_level ?? 5)).slice(0, 10);
  }, [inventory]);

  function exportReport() {
    const data = { stats, channelSalesData, topProducts, lowStockProducts, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mc-report-${period}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Report exported");
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <BarChart3 className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold text-foreground flex-1">Reports & Analytics</h1>
        <div className="flex gap-1 rounded-lg border border-border bg-white p-0.5">
          {["today", "week", "month", "year"].map((p) => (
            <button key={p} onClick={() => setPeriod(p)} className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${period === p ? "bg-primary text-white" : "text-muted-foreground hover:bg-secondary-soft"}`}>
              {p === "today" ? "Today" : p === "week" ? "This Week" : p === "month" ? "This Month" : "This Year"}
            </button>
          ))}
        </div>
        <button onClick={exportReport} className="flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-secondary-soft">
          <Download className="h-3.5 w-3.5" /> Export
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 rounded-lg border border-border bg-white p-0.5 overflow-x-auto">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition whitespace-nowrap ${tab === t ? "bg-primary text-white" : "text-muted-foreground hover:bg-secondary-soft"}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Total Orders", value: stats.totalOrders },
              { label: "Revenue", value: `₹${stats.totalRevenue.toLocaleString("en-IN")}`, color: "text-emerald-600" },
              { label: "Delivered", value: stats.delivered, color: "text-green-600" },
              { label: "Pending", value: stats.pending, color: "text-amber-600" },
            ].map((k) => (
              <div key={k.label} className="rounded-xl border border-border bg-white p-3 shadow-sm text-center">
                <div className={`text-lg font-bold ${k.color || "text-foreground"}`}>{k.value}</div>
                <div className="text-[10px] font-semibold uppercase text-muted-foreground">{k.label}</div>
              </div>
            ))}
          </div>
          {channelSalesData.length > 0 && (
            <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
              <h3 className="text-xs font-bold text-foreground mb-3">Sales by Channel</h3>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={channelSalesData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={3} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                    {channelSalesData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => `₹${v.toLocaleString("en-IN")}`} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {tab === "sales" && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-border bg-white p-3 shadow-sm text-center">
              <div className="text-lg font-bold text-emerald-600">₹{stats.totalRevenue.toLocaleString("en-IN")}</div>
              <div className="text-[10px] font-semibold uppercase text-muted-foreground">Total Revenue</div>
            </div>
            <div className="rounded-xl border border-border bg-white p-3 shadow-sm text-center">
              <div className="text-lg font-bold text-rose-600">₹{stats.totalPlatformFees.toLocaleString("en-IN")}</div>
              <div className="text-[10px] font-semibold uppercase text-muted-foreground">Platform Fees</div>
            </div>
            <div className="rounded-xl border border-border bg-white p-3 shadow-sm text-center">
              <div className="text-lg font-bold">{stats.totalOrders}</div>
              <div className="text-[10px] font-semibold uppercase text-muted-foreground">Total Transactions</div>
            </div>
          </div>
          {topProducts.length > 0 && (
            <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
              <h3 className="text-xs font-bold text-foreground mb-3">Top Products by Revenue</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={topProducts} layout="vertical" margin={{ left: 80 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis type="number" tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                  <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => `₹${v.toLocaleString("en-IN")}`} />
                  <Bar dataKey="revenue" fill="#6366f1" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {tab === "inventory" && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-border bg-white p-3 shadow-sm text-center">
              <div className="text-lg font-bold">{stats.totalStock}</div>
              <div className="text-[10px] font-semibold uppercase text-muted-foreground">Total Stock</div>
            </div>
            <div className="rounded-xl border border-border bg-white p-3 shadow-sm text-center">
              <div className="text-lg font-bold text-amber-600">{stats.lowStock}</div>
              <div className="text-[10px] font-semibold uppercase text-muted-foreground">Low Stock</div>
            </div>
            <div className="rounded-xl border border-border bg-white p-3 shadow-sm text-center">
              <div className="text-lg font-bold text-rose-600">{stats.outOfStock}</div>
              <div className="text-[10px] font-semibold uppercase text-muted-foreground">Out of Stock</div>
            </div>
          </div>
          {lowStockProducts.length > 0 && (
            <div className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-border"><h3 className="text-xs font-bold text-foreground">Low / Out of Stock Products</h3></div>
              <table className="w-full text-sm">
                <thead><tr className="bg-muted">
                  <th className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground text-left border-b border-border">Product</th>
                  <th className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground text-center border-b border-border">Stock</th>
                  <th className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground text-center border-b border-border">Reorder</th>
                  <th className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground text-center border-b border-border">Status</th>
                </tr></thead>
                <tbody>
                  {lowStockProducts.map((i) => (
                    <tr key={i.id} className="border-b border-border/50 last:border-0">
                      <td className="px-3 py-2 text-xs font-semibold">{i.mc_master_products?.name ?? "—"}</td>
                      <td className="px-3 py-2 text-center text-xs font-bold">{i.physical_stock ?? 0}</td>
                      <td className="px-3 py-2 text-center text-xs">{i.reorder_level ?? 5}</td>
                      <td className="px-3 py-2 text-center">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${(i.physical_stock ?? 0) <= 0 ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}>
                          {(i.physical_stock ?? 0) <= 0 ? "OUT OF STOCK" : "LOW STOCK"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "profit" && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Total Revenue", value: `₹${stats.totalRevenue.toLocaleString("en-IN")}` },
            { label: "Platform Fees", value: `₹${stats.totalPlatformFees.toLocaleString("en-IN")}`, color: "text-rose-600" },
            { label: "Product Costs", value: `₹${stats.totalCost.toLocaleString("en-IN")}` },
            { label: "Est. Gross Profit", value: `₹${(stats.totalRevenue - stats.totalPlatformFees - stats.totalCost).toLocaleString("en-IN")}`, color: "text-emerald-600" },
          ].map((k) => (
            <div key={k.label} className="rounded-xl border border-border bg-white p-4 shadow-sm text-center">
              <div className={`text-lg font-bold ${k.color || "text-foreground"}`}>{k.value}</div>
              <div className="text-[10px] font-semibold uppercase text-muted-foreground mt-1">{k.label}</div>
            </div>
          ))}
        </div>
      )}

      {tab === "orders" && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: "Total Orders", value: stats.totalOrders },
            { label: "Delivered", value: stats.delivered, color: "text-green-600" },
            { label: "Pending", value: stats.pending, color: "text-amber-600" },
            { label: "Cancelled", value: stats.cancelled, color: "text-rose-600" },
            { label: "Completion Rate", value: stats.totalOrders > 0 ? `${((stats.delivered / stats.totalOrders) * 100).toFixed(0)}%` : "0%", color: "text-primary" },
          ].map((k) => (
            <div key={k.label} className="rounded-xl border border-border bg-white p-4 shadow-sm text-center">
              <div className={`text-2xl font-bold ${k.color || "text-foreground"}`}>{k.value}</div>
              <div className="text-[10px] font-semibold uppercase text-muted-foreground mt-1">{k.label}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
