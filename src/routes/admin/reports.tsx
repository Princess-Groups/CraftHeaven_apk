import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  CartesianGrid,
  LineChart,
  Line,
} from "recharts";
import {
  TrendingUp,
  ShoppingBag,
  Package,
  IndianRupee,
  BarChart3,
  PieChart as PieChartIcon,
  Download,
} from "lucide-react";

export const Route = createFileRoute("/admin/reports")({
  head: () => ({ meta: [{ title: "Reports & Analytics — ACH Admin" }] }),
  component: ReportsAnalytics,
});

type Tab =
  | "overview"
  | "sales"
  | "purchase"
  | "profit"
  | "stock"
  | "orders"
  | "payment"
  | "products"
  | "categories";

const COLORS = ["#285A48", "#214C3D", "#9DB8A0", "#DCE8DA", "#E8EFE5", "#2D7A5F", "#4A9E7A"];

function ReportsAnalytics() {
  const [tab, setTab] = useState<Tab>("overview");
  const [period, setPeriod] = useState<"today" | "week" | "month" | "custom">("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  // Date range
  const { fromIso, toIso, label } = useMemo(() => {
    const now = new Date();
    let from: Date;
    let to = new Date();
    if (period === "today") {
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (period === "week") {
      from = new Date(now.getTime() - 7 * 864e5);
    } else if (period === "month") {
      from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    } else {
      from = customFrom ? new Date(customFrom + "T00:00:00") : new Date(0);
      if (customTo) to = new Date(customTo + "T23:59:59.999");
    }
    return {
      fromIso: from.toISOString(),
      toIso: to.toISOString(),
      label: period === "today" ? "Today" : period === "week" ? "This Week" : period === "month" ? "This Month" : "Custom",
    };
  }, [period, customFrom, customTo]);

  // Fetch orders
  const { data: orders } = useQuery({
    queryKey: ["report-orders", fromIso, toIso],
    queryFn: async () => {
      const { data } = await supabase
        .from("orders")
        .select("id,total,channel,status,payment_method,created_at,shipping_charges,gst_total,discount,order_items(product_name,quantity,line_total,unit_price)")
        .gte("created_at", fromIso)
        .lte("created_at", toIso)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  // Fetch purchases
  const { data: purchases } = useQuery({
    queryKey: ["report-purchases", fromIso, toIso],
    queryFn: async () => {
      const { data } = await supabase
        .from("purchases")
        .select("id,total,created_at,purchase_date")
        .gte("created_at", fromIso)
        .lte("created_at", toIso);
      return data ?? [];
    },
  });

  // Fetch products for stock
  const { data: products } = useQuery({
    queryKey: ["report-products"],
    queryFn: async () =>
      (await supabase.from("products").select("id,name,stock,reorder_level,unit,price,purchase_price,category_id,is_available")).data ?? [],
  });

  // Fetch categories
  const { data: categories } = useQuery({
    queryKey: ["report-categories"],
    queryFn: async () => (await supabase.from("categories").select("id,name")).data ?? [],
  });

  // Computed stats
  const stats = useMemo(() => {
    const now = new Date();
    const o = orders ?? [];
    const p = purchases ?? [];
    const prods = (products ?? []) as any[];
    const totalSales = o.reduce((s, x) => s + Number(x.total), 0);
    const onlineSales = o.filter((x) => x.channel === "ONLINE").reduce((s, x) => s + Number(x.total), 0);
    const offlineSales = o.filter((x) => x.channel === "IN_STORE").reduce((s, x) => s + Number(x.total), 0);
    const totalPurchases = p.reduce((s, x) => s + Number(x.total), 0);
    const profit = totalSales - totalPurchases;
    const orderCount = o.length;
    const delivered = o.filter((x) => x.status === "DELIVERED").length;
    const cancelled = o.filter((x) => x.status === "CANCELLED").length;
    const pending = o.filter((x) => ["NEW", "PROCESSING", "PACKED", "OUT_FOR_DELIVERY"].includes(x.status)).length;

    // Stock stats
    const totalProducts = prods.length;
    const inStock = prods.filter((x) => x.stock > 0).length;
    const lowStock = prods.filter((x) => x.stock > 0 && x.stock <= (x.reorder_level ?? 5)).length;
    const outOfStock = prods.filter((x) => x.stock <= 0).length;

    // Payment method breakdown
    const paymentMethods: Record<string, number> = {};
    o.forEach((x) => {
      const m = x.payment_method ?? "Unknown";
      paymentMethods[m] = (paymentMethods[m] || 0) + Number(x.total);
    });

    // Product performance
    const productPerf = new Map<string, { name: string; qty: number; revenue: number }>();
    o.forEach((x) => {
      (x.order_items ?? []).forEach((it: any) => {
        const prev = productPerf.get(it.product_name) ?? { name: it.product_name, qty: 0, revenue: 0 };
        prev.qty += it.quantity;
        prev.revenue += Number(it.line_total);
        productPerf.set(it.product_name, prev);
      });
    });
    const topProducts = [...productPerf.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 10);

    // Category performance
    const catMap = new Map((categories ?? []).map((c: any) => [c.id, c.name]));
    const catPerf = new Map<string, { name: string; qty: number; revenue: number }>();
    o.forEach((x) => {
      (x.order_items ?? []).forEach((it: any) => {
        // Find product category
        const prod = prods.find((p: any) => p.name === it.product_name);
        const catName = prod?.category_id ? (catMap.get(prod.category_id) ?? "Uncategorized") : "Uncategorized";
        const prev = catPerf.get(catName) ?? { name: catName, qty: 0, revenue: 0 };
        prev.qty += it.quantity;
        prev.revenue += Number(it.line_total);
        catPerf.set(catName, prev);
      });
    });
    const categoryPerf = [...catPerf.values()].sort((a, b) => b.revenue - a.revenue);

    // Daily sales for chart
    const dailySales: Record<string, number> = {};
    const days = period === "today" ? 1 : period === "week" ? 7 : 30;
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 864e5);
      dailySales[d.toISOString().slice(0, 10)] = 0;
    }
    o.forEach((x) => {
      const k = x.created_at.slice(0, 10);
      if (k in dailySales) dailySales[k] += Number(x.total);
    });
    const dailyData = Object.entries(dailySales).map(([date, total]) => ({ date: date.slice(5), total }));

    // Monthly sales for chart
    const monthlySales: Record<string, number> = {};
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      monthlySales[d.toISOString().slice(0, 7)] = 0;
    }
    o.forEach((x) => {
      const k = x.created_at.slice(0, 7);
      if (k in monthlySales) monthlySales[k] += Number(x.total);
    });
    const monthlyData = Object.entries(monthlySales).map(([m, total]) => ({ month: m.slice(5), total }));

    return {
      totalSales, onlineSales, offlineSales, totalPurchases, profit,
      orderCount, delivered, cancelled, pending,
      totalProducts, inStock, lowStock, outOfStock,
      paymentMethods, topProducts, categoryPerf,
      dailyData, monthlyData,
    };
  }, [orders, purchases, products, categories]);

  function exportSummary() {
    const rows = [
      ["Metric", "Value"],
      ["Period", label],
      ["Total Sales", stats.totalSales],
      ["Online Sales", stats.onlineSales],
      ["Offline Sales", stats.offlineSales],
      ["Total Purchases", stats.totalPurchases],
      ["Profit (est.)", stats.profit],
      ["Total Orders", stats.orderCount],
      ["Delivered", stats.delivered],
      ["Cancelled", stats.cancelled],
      ["Total Products", stats.totalProducts],
      ["In Stock", stats.inStock],
      ["Low Stock", stats.lowStock],
      ["Out of Stock", stats.outOfStock],
    ];
    const csv = rows.map((r) => r.join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `reports-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function fmt(n: number) {
    return "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
  }

  const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: "overview", label: "Overview", icon: BarChart3 },
    { key: "sales", label: "Sales Report", icon: TrendingUp },
    { key: "purchase", label: "Purchase Report", icon: ShoppingBag },
    { key: "profit", label: "Profit Report", icon: IndianRupee },
    { key: "stock", label: "Stock Report", icon: Package },
    { key: "orders", label: "Order Report", icon: PieChartIcon },
    { key: "payment", label: "Payment Methods", icon: IndianRupee },
    { key: "products", label: "Product Performance", icon: TrendingUp },
    { key: "categories", label: "Category Performance", icon: BarChart3 },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-foreground flex-1">Reports & Analytics</h1>
        <button
          onClick={exportSummary}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-secondary-soft"
        >
          <Download className="h-3.5 w-3.5" /> Export CSV
        </button>
      </div>

      {/* Date filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-border bg-white p-1 text-xs font-semibold">
          {([
            ["today", "Today"],
            ["week", "This Week"],
            ["month", "This Month"],
            ["custom", "Custom"],
          ] as [typeof period, string][]).map(([k, lab]) => (
            <button
              key={k}
              onClick={() => setPeriod(k)}
              className={`px-4 py-1.5 rounded ${period === k ? "bg-primary text-white" : "text-muted-foreground"}`}
            >
              {lab}
            </button>
          ))}
        </div>
        {period === "custom" && (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-white p-2">
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="rounded border border-border px-2 py-1 text-xs" />
            <span className="text-xs text-muted-foreground">to</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="rounded border border-border px-2 py-1 text-xs" />
          </div>
        )}
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>

      {/* Tab navigation */}
      <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-white p-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                tab === t.key ? "bg-secondary text-white" : "text-muted-foreground hover:bg-secondary-soft"
              }`}
            >
              <Icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard label="Total Sales" value={fmt(stats.totalSales)} />
            <KpiCard label="Total Purchases" value={fmt(stats.totalPurchases)} />
            <KpiCard label="Profit (est.)" value={fmt(stats.profit)} tone={stats.profit >= 0 ? "emerald" : "rose"} />
            <KpiCard label="Total Orders" value={String(stats.orderCount)} />
            <KpiCard label="Delivered" value={String(stats.delivered)} tone="emerald" />
            <KpiCard label="Cancelled" value={String(stats.cancelled)} tone="rose" />
            <KpiCard label="Total Products" value={String(stats.totalProducts)} />
            <KpiCard label="Low Stock" value={String(stats.lowStock)} tone="amber" />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
              <div className="mb-3 text-sm font-semibold">Sales Trend</div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={stats.dailyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#EEF2E9" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v: number) => fmt(v)} />
                    <Line type="monotone" dataKey="total" stroke="#285A48" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
              <div className="mb-3 text-sm font-semibold">Revenue by Channel</div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={[
                        { name: "Online", value: stats.onlineSales },
                        { name: "In-Store", value: stats.offlineSales },
                      ]}
                      dataKey="value"
                      outerRadius={90}
                      label
                    >
                      <Cell fill="#285A48" />
                      <Cell fill="#9DB8A0" />
                    </Pie>
                    <Tooltip formatter={(v: number) => fmt(v)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "sales" && (
        <div className="rounded-xl border border-border bg-white shadow-sm">
          <div className="border-b border-border px-4 py-3">
            <div className="text-sm font-bold">Sales Report</div>
            <div className="text-[11px] text-muted-foreground">Completed / non-cancelled orders</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted text-[11px] uppercase text-muted-foreground">
                <tr>
                  <th className="p-3 text-left">S.No.</th>
                  <th className="p-3 text-left">Order</th>
                  <th className="p-3 text-left">Channel</th>
                  <th className="p-3 text-left">Products</th>
                  <th className="p-3 text-right">Amount</th>
                  <th className="p-3">Payment</th>
                  <th className="p-3 text-left">Date</th>
                </tr>
              </thead>
              <tbody>
                {(orders ?? []).filter((o: any) => o.status !== "CANCELLED").map((o: any, i: number) => (
                  <tr key={o.id} className="border-t border-border">
                    <td className="p-3 text-xs font-semibold text-muted-foreground">{i + 1}</td>
                    <td className="p-3 font-mono text-xs">#{o.id.slice(0, 8).toUpperCase()}</td>
                    <td className="p-3 text-xs">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${o.channel === "ONLINE" ? "bg-sky-100 text-sky-700" : "bg-amber-100 text-amber-700"}`}>
                        {o.channel}
                      </span>
                    </td>
                    <td className="p-3 text-xs">{(o.order_items ?? []).length} item(s)</td>
                    <td className="p-3 text-right font-semibold">₹{Number(o.total).toFixed(2)}</td>
                    <td className="p-3 text-xs text-center">{o.payment_method}</td>
                    <td className="p-3 text-xs text-muted-foreground">{new Date(o.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "purchase" && (
        <div className="rounded-xl border border-border bg-white shadow-sm">
          <div className="border-b border-border px-4 py-3">
            <div className="text-sm font-bold">Purchase Report</div>
            <div className="text-[11px] text-muted-foreground">All purchases in selected period</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted text-[11px] uppercase text-muted-foreground">
                <tr>
                  <th className="p-3 text-left">S.No.</th>
                  <th className="p-3 text-left">Purchase Date</th>
                  <th className="p-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {(purchases ?? []).map((p: any, i: number) => (
                  <tr key={p.id} className="border-t border-border">
                    <td className="p-3 text-xs font-semibold text-muted-foreground">{i + 1}</td>
                    <td className="p-3 text-xs text-muted-foreground">{new Date(p.purchase_date).toLocaleDateString()}</td>
                    <td className="p-3 text-right font-semibold">₹{Number(p.total).toFixed(2)}</td>
                  </tr>
                ))}
                {!(purchases ?? []).length && (
                  <tr><td colSpan={3} className="p-8 text-center text-xs text-muted-foreground/70">No purchases</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "profit" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard label="Total Sales" value={fmt(stats.totalSales)} />
            <KpiCard label="Total Purchases" value={fmt(stats.totalPurchases)} />
            <KpiCard label="Estimated Profit" value={fmt(stats.profit)} tone={stats.profit >= 0 ? "emerald" : "rose"} />
            <KpiCard label="Profit Margin" value={stats.totalSales > 0 ? `${((stats.profit / stats.totalSales) * 100).toFixed(1)}%` : "0%"} tone={stats.profit >= 0 ? "emerald" : "rose"} />
          </div>
        </div>
      )}

      {tab === "stock" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard label="Total Products" value={String(stats.totalProducts)} />
            <KpiCard label="In Stock" value={String(stats.inStock)} tone="emerald" />
            <KpiCard label="Low Stock" value={String(stats.lowStock)} tone="amber" />
            <KpiCard label="Out of Stock" value={String(stats.outOfStock)} tone="rose" />
          </div>
          <div className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted text-[11px] uppercase text-muted-foreground">
                <tr>
                  <th className="p-3 text-left">Product</th>
                  <th className="p-3 text-right">Stock</th>
                  <th className="p-3 text-right">Min Stock</th>
                  <th className="p-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {((products ?? []) as any[]).map((p) => (
                  <tr key={p.id} className="border-t border-border">
                    <td className="p-3 font-medium">{p.name}</td>
                    <td className="p-3 text-right font-semibold">{p.stock}</td>
                    <td className="p-3 text-right text-muted-foreground">{p.reorder_level ?? 5}</td>
                    <td className="p-3 text-center">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${p.stock <= 0 ? "bg-rose-100 text-rose-700" : p.stock <= (p.reorder_level ?? 5) ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
                        {p.stock <= 0 ? "Out" : p.stock <= (p.reorder_level ?? 5) ? "Low" : "OK"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "orders" && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <KpiCard label="Total Orders" value={String(stats.orderCount)} />
          <KpiCard label="Delivered" value={String(stats.delivered)} tone="emerald" />
          <KpiCard label="Pending" value={String(stats.pending)} tone="amber" />
          <KpiCard label="Cancelled" value={String(stats.cancelled)} tone="rose" />
          <KpiCard label="Online" value={String(stats.onlineSales > 0 ? Math.round((stats.onlineSales / stats.totalSales) * 100) : 0) + "%"} />
          <KpiCard label="In-Store" value={String(stats.offlineSales > 0 ? Math.round((stats.offlineSales / stats.totalSales) * 100) : 0) + "%"} />
        </div>
      )}

      {tab === "payment" && (
        <div className="space-y-3">
          <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
            <div className="mb-3 text-sm font-semibold">Revenue by Payment Method</div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={Object.entries(stats.paymentMethods).map(([name, value]) => ({ name, value }))}
                    dataKey="value"
                    outerRadius={100}
                    label
                  >
                    {Object.keys(stats.paymentMethods).map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => fmt(v)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted text-[11px] uppercase text-muted-foreground">
                <tr>
                  <th className="p-3 text-left">Payment Method</th>
                  <th className="p-3 text-right">Revenue</th>
                  <th className="p-3 text-right">% of Total</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(stats.paymentMethods).sort((a, b) => b[1] - a[1]).map(([method, rev]) => (
                  <tr key={method} className="border-t border-border">
                    <td className="p-3 font-semibold">{method}</td>
                    <td className="p-3 text-right">₹{rev.toFixed(2)}</td>
                    <td className="p-3 text-right text-muted-foreground">
                      {stats.totalSales > 0 ? ((rev / stats.totalSales) * 100).toFixed(1) : 0}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "products" && (
        <div className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
          <div className="border-b border-border px-4 py-3">
            <div className="text-sm font-bold">Top Products by Revenue</div>
          </div>
          <div className="h-96">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.topProducts} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#EEF2E9" />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: number) => fmt(v)} />
                <Bar dataKey="revenue" fill="#285A48" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {tab === "categories" && (
        <div className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
          <div className="border-b border-border px-4 py-3">
            <div className="text-sm font-bold">Category Performance</div>
          </div>
          <div className="h-96">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.categoryPerf}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EEF2E9" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: number) => fmt(v)} />
                <Bar dataKey="revenue" fill="#285A48" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

function KpiCard({ label, value, tone }: { label: string; value: string; tone?: string }) {
  const toneClasses: Record<string, string> = {
    emerald: "text-emerald-600",
    rose: "text-rose-600",
    amber: "text-amber-600",
    sky: "text-sky-600",
  };
  return (
    <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xl font-bold ${toneClasses[tone ?? ""] ?? "text-foreground"}`}>{value}</div>
    </div>
  );
}
