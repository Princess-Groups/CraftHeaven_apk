import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMemo, useState } from "react";
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
  Legend,
} from "recharts";
import {
  IndianRupee,
  ShoppingCart,
  ClipboardList,
  Package,
  Tags,
  Warehouse,
  Users,
  AlertTriangle,
  XCircle,
  TrendingUp,
  TrendingDown,
  Plus,
  ArrowRight,
  ScanBarcode,
  Truck,
  UserPlus,
  FolderPlus,
  Eye,
  ShoppingBag,
  CreditCard,
  Box,
  BarChart3,
  Clock,
  CheckCircle2,
  PackageCheck,
  Target,
  Pencil,
  Save,
  X,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";

export const Route = createFileRoute("/admin/")({
  head: () => ({ meta: [{ title: "Dashboard — ACH Admin" }] }),
  component: Dashboard,
});

const COLORS = ["#285A48", "#214C3D", "#9DB8A0", "#DCE8DA", "#E8EFE5", "#2D7A5F", "#4A9E7A"];
const CHART_COLORS = { primary: "#285A48", secondary: "#9DB8A0", accent: "#2D7A5F", muted: "#DCE8DA" };

type SummaryCardProps = {
  title: string;
  value: string | number;
  icon: React.ElementType;
  color: string;
  bgColor: string;
  link?: string;
  subtitle?: string;
};

function SummaryCard({ title, value, icon: Icon, color, bgColor, link, subtitle }: SummaryCardProps) {
  const content = (
    <div className={`flex items-start gap-3 rounded-xl border border-border bg-white p-4 shadow-sm transition hover:shadow-md ${link ? "cursor-pointer" : ""}`}>
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${bgColor}`}>
        <Icon className={`h-5 w-5 ${color}`} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
        <div className="mt-0.5 text-xl font-bold text-foreground truncate">{value}</div>
        {subtitle && <div className="mt-0.5 text-[10px] text-muted-foreground">{subtitle}</div>}
      </div>
      {link && <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground/40" />}
    </div>
  );
  return link ? <Link to={link}>{content}</Link> : content;
}

function formatCurrency(n: number) {
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${n.toFixed(0)}`;
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function formatTime(d: string) {
  return new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

function Dashboard() {
  // ---- Fetch all data in parallel ----
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  // Products
  const { data: products } = useQuery({
    queryKey: ["dash-products"],
    queryFn: async () => (await supabase.from("products").select("id,stock,reorder_level,price,purchase_price,name,created_at,is_available").order("created_at", { ascending: false })).data ?? [],
  });

  // Orders
  const { data: orders } = useQuery({
    queryKey: ["dash-orders"],
    queryFn: async () => (await supabase.from("orders").select("id,total,status,created_at,payment_method,payment_status,channel").order("created_at", { ascending: false }).limit(500)).data ?? [],
  });

  // Purchases
  const { data: purchases } = useQuery({
    queryKey: ["dash-purchases"],
    queryFn: async () => (await supabase.from("purchases").select("id,total,subtotal,created_at,invoice_no,supplier_id").order("created_at", { ascending: false }).limit(500)).data ?? [],
  });

  // Categories
  const { data: categories } = useQuery({
    queryKey: ["dash-categories"],
    queryFn: async () => (await supabase.from("categories").select("id,name")).data ?? [],
  });

  // Suppliers
  const { data: suppliers } = useQuery({
    queryKey: ["dash-suppliers"],
    queryFn: async () => (await supabase.from("suppliers").select("id,name,created_at").order("created_at", { ascending: false }).limit(100)).data ?? [],
  });

  // Recent order items (for product-level sales data)
  const { data: recentOrderItems } = useQuery({
    queryKey: ["dash-order-items"],
    queryFn: async () => (await supabase.from("order_items").select("product_name,quantity,unit_price,line_total").limit(500)).data ?? [],
  });

  // ---- Monthly Sales Target (persisted in localStorage) ----
  const storageKey = "monthly_sales_target";
  const [monthlyTarget, setMonthlyTarget] = useState<number>(() => {
    try {
      return Number(localStorage.getItem(storageKey)) || 0;
    } catch { return 0; }
  });
  const [isEditingTarget, setIsEditingTarget] = useState(false);
  const [targetDraft, setTargetDraft] = useState(String(monthlyTarget));

  function saveTarget() {
    const val = Number(targetDraft);
    if (!isNaN(val) && val >= 0) {
      setMonthlyTarget(val);
      localStorage.setItem(storageKey, String(val));
    }
    setIsEditingTarget(false);
  }

  // ---- Computed summaries ----
  const summary = useMemo(() => {
    if (!products || !orders || !purchases) return null;

    const totalProducts = products.length;
    const totalStock = products.reduce((s, p) => s + (p.stock || 0), 0);
    const stockValue = products.reduce((s, p) => s + (p.stock || 0) * (p.purchase_price || 0), 0);
    const lowStock = products.filter(p => (p.stock || 0) > 0 && (p.stock || 0) <= (p.reorder_level || 5)).length;
    const outOfStock = products.filter(p => (p.stock || 0) <= 0).length;

    const totalOrders = orders.length;
    const totalSales = orders.reduce((s, o) => s + (o.total || 0), 0);
    const monthOrders = orders.filter(o => o.created_at >= monthStart);
    const monthSales = monthOrders.reduce((s, o) => s + (o.total || 0), 0);

    const totalPurchases = purchases.length;
    const totalPurchaseValue = purchases.reduce((s, p) => s + (p.total || p.subtotal || 0), 0);
    const monthPurchases = purchases.filter(p => p.created_at >= monthStart);
    const monthPurchaseValue = monthPurchases.reduce((s, p) => s + (p.total || p.subtotal || 0), 0);

    const totalCategories = categories?.length || 0;
    const totalSuppliers = suppliers?.length || 0;

    return {
      totalProducts, totalStock, stockValue, lowStock, outOfStock,
      totalOrders, totalSales, monthSales,
      totalPurchases, totalPurchaseValue, monthPurchaseValue,
      totalCategories, totalSuppliers,
    };
  }, [products, orders, purchases, categories, suppliers, monthStart]);

  // ---- Monthly Target metrics ----
  const targetMetrics = useMemo(() => {
    if (!summary || monthlyTarget <= 0) return null;
    const achieved = summary.monthSales;
    const remaining = Math.max(0, monthlyTarget - achieved);
    const completionPct = monthlyTarget > 0 ? Math.min((achieved / monthlyTarget) * 100, 100) : 0;
    const isCompleted = achieved >= monthlyTarget;
    const aboveTarget = achieved - monthlyTarget;
    // Default to first product price for unit estimation
    const defaultPrice = products?.[0]?.price || 0;
    const unitsRequired = defaultPrice > 0 ? Math.ceil(remaining / defaultPrice) : 0;
    return {
      achieved,
      remaining,
      completionPct,
      isCompleted,
      aboveTarget,
      defaultPrice,
      unitsRequired,
      rawPct: monthlyTarget > 0 ? (achieved / monthlyTarget) * 100 : 0,
    };
  }, [summary, monthlyTarget, products]);

  // ---- Chart data: Sales by day (last 7 days) ----
  const salesByDay = useMemo(() => {
    if (!orders) return [];
    const days: Record<string, number> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 864e5);
      days[d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })] = 0;
    }
    for (const o of orders) {
      const d = new Date(o.created_at);
      const key = d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
      if (key in days) days[key] += o.total || 0;
    }
    return Object.entries(days).map(([day, amount]) => ({ day, amount: Math.round(amount) }));
  }, [orders, now]);

  // ---- Chart data: Purchase by day (last 7 days) ----
  const purchaseByDay = useMemo(() => {
    if (!purchases) return [];
    const days: Record<string, number> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 864e5);
      days[d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })] = 0;
    }
    for (const p of purchases) {
      const d = new Date(p.created_at);
      const key = d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
      if (key in days) days[key] += p.total || p.subtotal || 0;
    }
    return Object.entries(days).map(([day, amount]) => ({ day, amount: Math.round(amount) }));
  }, [purchases, now]);

  // ---- Chart data: Sales vs Purchase comparison (last 6 months) ----
  const comparisonData = useMemo(() => {
    if (!orders || !purchases) return [];
    const months: { label: string; sales: number; purchases: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = d.toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
      const from = d.toISOString();
      const to = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59).toISOString();
      const sales = orders.filter(o => o.created_at >= from && o.created_at <= to).reduce((s, o) => s + (o.total || 0), 0);
      const purchasesVal = purchases.filter(p => p.created_at >= from && p.created_at <= to).reduce((s, p) => s + (p.total || p.subtotal || 0), 0);
      months.push({ label: key, sales: Math.round(sales), purchases: Math.round(purchasesVal) });
    }
    return months;
  }, [orders, purchases, now]);

  // ---- Chart data: Order status breakdown ----
  const orderStatusData = useMemo(() => {
    if (!orders) return [];
    const counts: Record<string, number> = {};
    for (const o of orders) {
      const s = String(o.status || "unknown");
      counts[s] = (counts[s] || 0) + 1;
    }
    return Object.entries(counts).map(([name, value]) => ({ name: name.charAt(0).toUpperCase() + name.slice(1), value }));
  }, [orders]);

  // ---- Chart data: Inventory stock status ----
  const stockStatusData = useMemo(() => {
    if (!products) return [];
    const inStock = products.filter(p => (p.stock || 0) > (p.reorder_level || 5)).length;
    const low = products.filter(p => (p.stock || 0) > 0 && (p.stock || 0) <= (p.reorder_level || 5)).length;
    const out = products.filter(p => (p.stock || 0) <= 0).length;
    return [
      { name: "In Stock", value: inStock },
      { name: "Low Stock", value: low },
      { name: "Out of Stock", value: out },
    ].filter(d => d.value > 0);
  }, [products]);

  // ---- Top selling products ----
  const topProducts = useMemo(() => {
    if (!recentOrderItems || !Array.isArray(recentOrderItems)) return [];
    const map = new Map<string, { name: string; qty: number; revenue: number }>();
    for (const item of recentOrderItems) {
      const name = item.product_name || "Unknown";
      const existing = map.get(name);
      if (existing) {
        existing.qty += item.quantity || 0;
        existing.revenue += item.line_total || 0;
      } else {
        map.set(name, { name, qty: item.quantity || 0, revenue: item.line_total || 0 });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  }, [recentOrderItems]);

  if (!summary) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-sm text-muted-foreground">Loading dashboard…</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-xl font-bold text-foreground">Dashboard</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Overview of your entire billing & inventory system</p>
      </div>

      {/* ===== Monthly Sales Target ===== */}
      <div className="rounded-xl border border-border bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-emerald-50">
              <Target className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-foreground">
                {new Date().toLocaleDateString("en-IN", { month: "long", year: "numeric" })} Sales Target
              </h2>
              <p className="text-[10px] text-muted-foreground">Track your monthly sales progress</p>
            </div>
          </div>

          {/* Inline edit for target */}
          {isEditingTarget ? (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 rounded-lg border border-border bg-white px-3 py-1.5">
                <span className="text-xs font-semibold text-muted-foreground">₹</span>
                <input
                  type="number"
                  value={targetDraft}
                  onChange={(e) => setTargetDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveTarget(); if (e.key === "Escape") setIsEditingTarget(false); }}
                  className="w-28 bg-transparent text-sm font-bold text-foreground outline-none"
                  autoFocus
                  min={0}
                />
              </div>
              <button onClick={saveTarget} className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100">
                <Save className="h-4 w-4" />
              </button>
              <button onClick={() => setIsEditingTarget(false)} className="grid h-8 w-8 place-items-center rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-100">
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => { setTargetDraft(String(monthlyTarget || "")); setIsEditingTarget(true); }}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-secondary-soft"
            >
              <Pencil className="h-3 w-3" />
              {monthlyTarget > 0 ? `₹${monthlyTarget.toLocaleString("en-IN")}` : "Set Target"}
            </button>
          )}
        </div>

        {monthlyTarget > 0 && targetMetrics ? (
          <div className="space-y-4">
            {/* Stats Row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-lg bg-muted/40 px-3 py-2.5">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Monthly Target</div>
                <div className="mt-0.5 text-lg font-bold text-foreground">₹{monthlyTarget.toLocaleString("en-IN")}</div>
              </div>
              <div className="rounded-lg bg-emerald-50 px-3 py-2.5">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Sales Achieved</div>
                <div className="mt-0.5 text-lg font-bold text-emerald-700">₹{targetMetrics.achieved.toLocaleString("en-IN")}</div>
              </div>
              <div className="rounded-lg bg-amber-50 px-3 py-2.5">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                  {targetMetrics.isCompleted ? "Above Target" : "Remaining"}
                </div>
                <div className="mt-0.5 text-lg font-bold text-amber-700">
                  {targetMetrics.isCompleted
                    ? `₹${targetMetrics.aboveTarget.toLocaleString("en-IN")}`
                    : `₹${targetMetrics.remaining.toLocaleString("en-IN")}`
                  }
                </div>
              </div>
              <div className="rounded-lg bg-blue-50 px-3 py-2.5">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-blue-700">Completion</div>
                <div className="mt-0.5 text-lg font-bold text-blue-700">{targetMetrics.rawPct.toFixed(2)}%</div>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold text-muted-foreground">Progress</span>
                <span className="text-[10px] font-bold text-foreground">{targetMetrics.completionPct.toFixed(1)}%</span>
              </div>
              <Progress value={targetMetrics.completionPct} className="h-3" />
            </div>

            {/* Status Message */}
            <div className={`rounded-lg px-3 py-2 text-xs font-semibold ${
              targetMetrics.isCompleted ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
            }`}>
              {targetMetrics.isCompleted ? (
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4" />
                  Monthly Sales Target Completed{targetMetrics.aboveTarget > 0 ? ` — ₹${targetMetrics.aboveTarget.toLocaleString("en-IN")} Above Target` : ""}
                </span>
              ) : (
                <span>₹{targetMetrics.remaining.toLocaleString("en-IN")} remaining to complete the monthly target.</span>
              )}
            </div>

            {/* Products/Units Required */}
            {targetMetrics.defaultPrice > 0 && !targetMetrics.isCompleted && (
              <div className="rounded-lg bg-primary/5 border border-primary/10 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-primary" />
                  <div className="text-xs">
                    <span className="font-bold text-primary">Sell {targetMetrics.unitsRequired} more unit{targetMetrics.unitsRequired !== 1 ? "s" : ""}</span>
                    <span className="text-muted-foreground"> (₹{targetMetrics.defaultPrice.toLocaleString("en-IN")} each) to complete this month's sales target.</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : monthlyTarget <= 0 ? (
          <div className="flex items-center justify-center rounded-lg border border-dashed border-border py-6 text-xs text-muted-foreground">
            Set a monthly sales target to start tracking your progress.
          </div>
        ) : null}
      </div>

      {/* ===== Summary Cards ===== */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
        <SummaryCard
          title="Total Sales"
          value={formatCurrency(summary.totalSales)}
          icon={IndianRupee}
          color="text-emerald-700"
          bgColor="bg-emerald-50"
          link="/admin/reports"
          subtitle={`₹${summary.monthSales.toLocaleString("en-IN")} this month`}
        />
        <SummaryCard
          title="Total Purchases"
          value={formatCurrency(summary.totalPurchaseValue)}
          icon={Truck}
          color="text-blue-700"
          bgColor="bg-blue-50"
          link="/admin/purchases"
          subtitle={`₹${summary.monthPurchaseValue.toLocaleString("en-IN")} this month`}
        />
        <SummaryCard
          title="Total Orders"
          value={summary.totalOrders.toLocaleString("en-IN")}
          icon={ClipboardList}
          color="text-violet-700"
          bgColor="bg-violet-50"
          link="/admin/orders"
          subtitle={`${summary.totalOrders} total`}
        />
        <SummaryCard
          title="Products"
          value={summary.totalProducts.toLocaleString("en-IN")}
          icon={Package}
          color="text-primary"
          bgColor="bg-primary/10"
          link="/admin/inventory"
          subtitle={`${summary.totalStock.toLocaleString("en-IN")} units in stock`}
        />
        <SummaryCard
          title="Categories"
          value={summary.totalCategories.toLocaleString("en-IN")}
          icon={Tags}
          color="text-amber-700"
          bgColor="bg-amber-50"
          link="/admin/categories"
        />
        <SummaryCard
          title="Suppliers"
          value={summary.totalSuppliers.toLocaleString("en-IN")}
          icon={Users}
          color="text-cyan-700"
          bgColor="bg-cyan-50"
          link="/admin/suppliers"
        />
      </div>

      {/* ===== Alert Cards ===== */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <SummaryCard
          title="Low Stock Alert"
          value={summary.lowStock.toLocaleString("en-IN")}
          icon={AlertTriangle}
          color="text-amber-600"
          bgColor="bg-amber-50"
          link="/admin/inventory"
          subtitle="Products below reorder level"
        />
        <SummaryCard
          title="Out of Stock"
          value={summary.outOfStock.toLocaleString("en-IN")}
          icon={XCircle}
          color="text-rose-600"
          bgColor="bg-rose-50"
          link="/admin/inventory"
          subtitle="Products with zero stock"
        />
        <SummaryCard
          title="Stock Value"
          value={formatCurrency(summary.stockValue)}
          icon={Warehouse}
          color="text-indigo-700"
          bgColor="bg-indigo-50"
          link="/admin/inventory"
          subtitle={`${summary.totalStock.toLocaleString("en-IN")} total units`}
        />
      </div>

      {/* ===== Charts Row ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Sales Overview (7-day bar chart) */}
        <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-emerald-600" />
            <h3 className="text-sm font-bold text-foreground">Sales Overview</h3>
            <span className="ml-auto text-[10px] font-medium text-muted-foreground">Last 7 days</span>
          </div>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={salesByDay} barSize={28}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#888" }} />
                <YAxis tick={{ fontSize: 10, fill: "#888" }} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}K` : v} />
                <Tooltip formatter={(v: number) => [`₹${v.toLocaleString("en-IN")}`, "Sales"]} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                <Bar dataKey="amount" fill={CHART_COLORS.primary} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Purchase Overview (7-day bar chart) */}
        <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <Truck className="h-4 w-4 text-blue-600" />
            <h3 className="text-sm font-bold text-foreground">Purchase Overview</h3>
            <span className="ml-auto text-[10px] font-medium text-muted-foreground">Last 7 days</span>
          </div>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={purchaseByDay} barSize={28}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#888" }} />
                <YAxis tick={{ fontSize: 10, fill: "#888" }} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}K` : v} />
                <Tooltip formatter={(v: number) => [`₹${v.toLocaleString("en-IN")}`, "Purchases"]} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                <Bar dataKey="amount" fill={CHART_COLORS.accent} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ===== Comparison & Status Charts ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Sales vs Purchase (line chart) */}
        <div className="lg:col-span-2 rounded-xl border border-border bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-foreground" />
            <h3 className="text-sm font-bold text-foreground">Sales vs Purchase</h3>
            <span className="ml-auto text-[10px] font-medium text-muted-foreground">Last 6 months</span>
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={comparisonData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#888" }} />
                <YAxis tick={{ fontSize: 10, fill: "#888" }} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}K` : v} />
                <Tooltip formatter={(v: number) => [`₹${v.toLocaleString("en-IN")}`, ""]} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Line type="monotone" dataKey="sales" stroke={CHART_COLORS.primary} strokeWidth={2} dot={{ r: 3 }} name="Sales" />
                <Line type="monotone" dataKey="purchases" stroke={CHART_COLORS.accent} strokeWidth={2} dot={{ r: 3 }} name="Purchases" strokeDasharray="5 5" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Order Status Pie */}
        <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-violet-600" />
            <h3 className="text-sm font-bold text-foreground">Order Status</h3>
          </div>
          <div className="h-56 flex items-center justify-center">
            {orderStatusData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={orderStatusData}
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={70}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {orderStatusData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-xs text-muted-foreground">No orders yet</div>
            )}
          </div>
        </div>
      </div>

      {/* ===== Inventory Stock Status ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <Package className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-bold text-foreground">Stock Status</h3>
          </div>
          <div className="h-48 flex items-center justify-center">
            {stockStatusData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={stockStatusData}
                    cx="50%"
                    cy="50%"
                    innerRadius={35}
                    outerRadius={65}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    <Cell fill="#285A48" />
                    <Cell fill="#F59E0B" />
                    <Cell fill="#EF4444" />
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-xs text-muted-foreground">No products yet</div>
            )}
          </div>
        </div>

        {/* Top Selling Products */}
        <div className="lg:col-span-2 rounded-xl border border-border bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-emerald-600" />
            <h3 className="text-sm font-bold text-foreground">Top Selling Products</h3>
          </div>
          {topProducts.length > 0 ? (
            <div className="space-y-2">
              {topProducts.map((p, i) => (
                <div key={p.name} className="flex items-center gap-3 rounded-lg bg-muted/30 px-3 py-2">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                    {i + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-foreground truncate">{p.name}</div>
                    <div className="text-[10px] text-muted-foreground">{p.qty} units sold</div>
                  </div>
                  <div className="text-xs font-bold text-emerald-700">₹{p.revenue.toLocaleString("en-IN")}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex h-48 items-center justify-center text-xs text-muted-foreground">No sales data yet</div>
          )}
        </div>
      </div>

      {/* ===== Quick Actions ===== */}
      <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <Box className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">Quick Actions</h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {[
            { to: "/admin/billing", label: "Create Bill", icon: ScanBarcode, color: "bg-emerald-50 text-emerald-700 hover:bg-emerald-100" },
            { to: "/admin/purchases", label: "Add Purchase", icon: ShoppingCart, color: "bg-blue-50 text-blue-700 hover:bg-blue-100" },
            { to: "/admin/inventory", label: "Add Product", icon: Package, color: "bg-primary/10 text-primary hover:bg-primary/20" },
            { to: "/admin/categories", label: "Add Category", icon: FolderPlus, color: "bg-amber-50 text-amber-700 hover:bg-amber-100" },
            { to: "/admin/suppliers", label: "Add Supplier", icon: UserPlus, color: "bg-cyan-50 text-cyan-700 hover:bg-cyan-100" },
            { to: "/admin/orders", label: "View Orders", icon: ClipboardList, color: "bg-violet-50 text-violet-700 hover:bg-violet-100" },
          ].map(action => (
            <Link
              key={action.to}
              to={action.to}
              className={`flex flex-col items-center gap-1.5 rounded-lg px-3 py-3 text-center transition ${action.color}`}
            >
              <action.icon className="h-5 w-5" />
              <span className="text-[11px] font-semibold">{action.label}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* ===== Recent Activity Row ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Recent Orders */}
        <div className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-violet-600" />
              <h3 className="text-sm font-bold text-foreground">Recent Orders</h3>
            </div>
            <Link to="/admin/orders" className="text-[10px] font-semibold text-primary hover:underline">View All</Link>
          </div>
          <div className="divide-y divide-border/50 max-h-72 overflow-y-auto">
            {orders.length > 0 ? orders.slice(0, 8).map(o => (
              <div key={o.id} className="px-4 py-2.5 hover:bg-muted/30 transition">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-foreground truncate max-w-[60%]">#{o.id.slice(0, 8)}</div>
                  <div className="text-xs font-bold text-emerald-700">₹{(o.total || 0).toLocaleString("en-IN")}</div>
                </div>
                <div className="flex items-center justify-between mt-0.5">
                  <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                    o.status === "delivered" ? "bg-emerald-50 text-emerald-700" :
                    o.status === "cancelled" ? "bg-rose-50 text-rose-700" :
                    o.status === "shipped" ? "bg-blue-50 text-blue-700" :
                    "bg-amber-50 text-amber-700"
                  }`}>{String(o.status || "new")}</span>
                  <span className="text-[10px] text-muted-foreground">{formatDate(o.created_at)}</span>
                </div>
              </div>
            )) : (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">No orders yet</div>
            )}
          </div>
        </div>

        {/* Recent Purchases */}
        <div className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Truck className="h-4 w-4 text-blue-600" />
              <h3 className="text-sm font-bold text-foreground">Recent Purchases</h3>
            </div>
            <Link to="/admin/purchases" className="text-[10px] font-semibold text-primary hover:underline">View All</Link>
          </div>
          <div className="divide-y divide-border/50 max-h-72 overflow-y-auto">
            {purchases.length > 0 ? purchases.slice(0, 8).map(p => (
              <div key={p.id} className="px-4 py-2.5 hover:bg-muted/30 transition">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-foreground truncate max-w-[60%]">
                    {p.invoice_no || `#${p.id.slice(0, 8)}`}
                  </div>
                  <div className="text-xs font-bold text-blue-700">₹{(p.total || p.subtotal || 0).toLocaleString("en-IN")}</div>
                </div>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="inline-flex items-center rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700 uppercase">
                    completed
                  </span>
                  <span className="text-[10px] text-muted-foreground">{formatDate(p.created_at)}</span>
                </div>
              </div>
            )) : (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">No purchases yet</div>
            )}
          </div>
        </div>

        {/* Recent Products */}
        <div className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-bold text-foreground">Recent Products</h3>
            </div>
            <Link to="/admin/inventory" className="text-[10px] font-semibold text-primary hover:underline">View All</Link>
          </div>
          <div className="divide-y divide-border/50 max-h-72 overflow-y-auto">
            {products.length > 0 ? products.slice(0, 8).map(p => (
              <div key={p.id} className="px-4 py-2.5 hover:bg-muted/30 transition">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-foreground truncate max-w-[60%]">{p.name}</div>
                  <div className="text-xs font-bold text-foreground">₹{(p.price || 0).toLocaleString("en-IN")}</div>
                </div>
                <div className="flex items-center justify-between mt-0.5">
                  <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
                    (p.stock || 0) <= 0 ? "bg-rose-50 text-rose-700" :
                    (p.stock || 0) <= (p.reorder_level || 5) ? "bg-amber-50 text-amber-700" :
                    "bg-emerald-50 text-emerald-700"
                  }`}>
                    Stock: {p.stock || 0}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{formatDate(p.created_at)}</span>
                </div>
              </div>
            )) : (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">No products yet</div>
            )}
          </div>
        </div>
      </div>

      {/* ===== Recent Suppliers ===== */}
      {suppliers.length > 0 && (
        <div className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-cyan-600" />
              <h3 className="text-sm font-bold text-foreground">Recent Suppliers</h3>
            </div>
            <Link to="/admin/suppliers" className="text-[10px] font-semibold text-primary hover:underline">View All</Link>
          </div>
          <div className="divide-y divide-border/50">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-0">
              {suppliers.slice(0, 10).map(s => (
                <div key={s.id} className="px-4 py-3 hover:bg-muted/30 transition border-b border-border/50 lg:border-b-0 lg:border-r lg:last:border-r-0">
                  <div className="text-xs font-semibold text-foreground truncate">{s.name}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{formatDate(s.created_at)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
