import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, CartesianGrid } from "recharts";
import { IndianRupee, ShoppingBag, Package, Users, AlertTriangle, XCircle, TrendingUp, TrendingDown, Clock, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/admin/")({
  head: () => ({ meta: [{ title: "Dashboard — ACH Admin" }] }),
  component: Dashboard,
});

type Order = { id: string; total: number; channel: "ONLINE" | "IN_STORE"; status: string; created_at: string; user_id: string | null };
type OrderItem = { product_id: string; product_name: string; quantity: number; line_total: number };

function Dashboard() {
  const { data } = useQuery({
    queryKey: ["admin-dashboard"],
    queryFn: async () => {
      const now = new Date();
      const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const start30 = new Date(now.getTime() - 30 * 864e5).toISOString();
      const start12mo = new Date(now.getFullYear(), now.getMonth() - 11, 1).toISOString();

      const [ordersR, itemsR, productsR, profilesR] = await Promise.all([
        supabase.from("orders").select("id,total,channel,status,created_at,user_id").gte("created_at", start12mo),
        supabase.from("order_items").select("product_id,product_name,quantity,line_total,order_id,orders!inner(created_at)").gte("orders.created_at", start30),
        supabase.from("products").select("id,name,stock,reorder_level,is_available"),
        supabase.from("profiles").select("id", { count: "exact", head: true }),
      ]);
      const orders = (ordersR.data ?? []) as Order[];
      const items = (itemsR.data ?? []) as unknown as OrderItem[];
      const products = productsR.data ?? [];

      const todayOrders = orders.filter((o) => o.created_at >= startToday);
      const todaySales = todayOrders.reduce((s, o) => s + Number(o.total), 0);
      const onlineToday = todayOrders.filter((o) => o.channel === "ONLINE").length;
      const offlineToday = todayOrders.filter((o) => o.channel === "IN_STORE").length;
      const totalRevenue = orders.reduce((s, o) => s + Number(o.total), 0);

      const lowStock = products.filter((p) => p.stock > 0 && p.stock <= (p.reorder_level ?? 5)).length;
      const outOfStock = products.filter((p) => p.stock <= 0).length;
      const pending = orders.filter((o) => ["NEW", "PROCESSING", "PACKED", "OUT_FOR_DELIVERY"].includes(o.status)).length;
      const completed = orders.filter((o) => o.status === "DELIVERED").length;

      // Daily sales last 30
      const days: Record<string, number> = {};
      for (let i = 29; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 864e5);
        days[d.toISOString().slice(0, 10)] = 0;
      }
      orders.filter((o) => o.created_at >= start30).forEach((o) => {
        const k = o.created_at.slice(0, 10);
        if (k in days) days[k] += Number(o.total);
      });
      const daily = Object.entries(days).map(([date, total]) => ({ date: date.slice(5), total }));

      // Monthly last 12
      const months: Record<string, number> = {};
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months[d.toISOString().slice(0, 7)] = 0;
      }
      orders.forEach((o) => {
        const k = o.created_at.slice(0, 7);
        if (k in months) months[k] += Number(o.total);
      });
      const monthly = Object.entries(months).map(([m, total]) => ({ month: m.slice(5), total }));

      // Top / least products
      const perProduct = new Map<string, { name: string; qty: number; revenue: number }>();
      items.forEach((it) => {
        const prev = perProduct.get(it.product_id) ?? { name: it.product_name, qty: 0, revenue: 0 };
        prev.qty += it.quantity; prev.revenue += Number(it.line_total);
        perProduct.set(it.product_id, prev);
      });
      const sorted = [...perProduct.values()].sort((a, b) => b.qty - a.qty);
      const topSelling = sorted.slice(0, 5);
      const leastSelling = sorted.slice(-5).reverse();

      return {
        todaySales, todayOrdersCount: todayOrders.length, onlineToday, offlineToday,
        totalRevenue, totalProducts: products.length, totalCustomers: profilesR.count ?? 0,
        lowStock, outOfStock, pending, completed,
        daily, monthly, topSelling, leastSelling,
      };
    },
  });

  const d = data;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-xs text-slate-500">Real-time overview of your store</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Today's Sales" value={inr(d?.todaySales ?? 0)} icon={IndianRupee} tone="emerald" />
        <Kpi label="Today's Orders" value={d?.todayOrdersCount ?? 0} icon={ShoppingBag} tone="peach" />
        <Kpi label="Online Orders" value={d?.onlineToday ?? 0} icon={TrendingUp} tone="sky" />
        <Kpi label="Offline Billing" value={d?.offlineToday ?? 0} icon={ShoppingBag} tone="amber" />
        <Kpi label="Total Revenue (12mo)" value={inr(d?.totalRevenue ?? 0)} icon={IndianRupee} tone="emerald" />
        <Kpi label="Total Products" value={d?.totalProducts ?? 0} icon={Package} tone="slate" />
        <Kpi label="Total Customers" value={d?.totalCustomers ?? 0} icon={Users} tone="peach" />
        <Kpi label="Low Stock" value={d?.lowStock ?? 0} icon={AlertTriangle} tone="amber" />
        <Kpi label="Out of Stock" value={d?.outOfStock ?? 0} icon={XCircle} tone="rose" />
        <Kpi label="Pending Orders" value={d?.pending ?? 0} icon={Clock} tone="sky" />
        <Kpi label="Completed Orders" value={d?.completed ?? 0} icon={CheckCircle2} tone="emerald" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Daily Sales — last 30 days">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={d?.daily ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: number) => inr(v)} />
                <Line type="monotone" dataKey="total" stroke="#8FAF9A" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Monthly Sales — last 12 months">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d?.monthly ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: number) => inr(v)} />
                <Bar dataKey="total" fill="#F6A99A" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Top Selling Products">
          <ProductList items={d?.topSelling ?? []} trend="up" />
        </Card>
        <Card title="Least Selling Products">
          <ProductList items={d?.leastSelling ?? []} trend="down" />
        </Card>
      </div>
    </div>
  );
}

function Kpi({ label, value, icon: Icon, tone }: { label: string; value: string | number; icon: React.ElementType; tone: string }) {
  const tones: Record<string, string> = {
    emerald: "bg-emerald-50 text-emerald-700",
    peach: "bg-orange-50 text-orange-700",
    sky: "bg-sky-50 text-sky-700",
    amber: "bg-amber-50 text-amber-700",
    rose: "bg-rose-50 text-rose-700",
    slate: "bg-slate-100 text-slate-700",
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between">
        <div className="text-[11px] uppercase tracking-wider text-slate-500">{label}</div>
        <div className={`grid h-8 w-8 place-items-center rounded-lg ${tones[tone]}`}><Icon className="h-4 w-4" /></div>
      </div>
      <div className="mt-2 text-xl font-bold text-slate-900">{value}</div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 text-sm font-semibold text-slate-900">{title}</div>
      {children}
    </div>
  );
}

function ProductList({ items, trend }: { items: { name: string; qty: number; revenue: number }[]; trend: "up" | "down" }) {
  const Icon = trend === "up" ? TrendingUp : TrendingDown;
  const tone = trend === "up" ? "text-emerald-600" : "text-rose-600";
  if (!items.length) return <div className="py-8 text-center text-xs text-slate-400">No sales data yet</div>;
  return (
    <ul className="divide-y divide-slate-100">
      {items.map((p, i) => (
        <li key={i} className="flex items-center gap-3 py-2.5">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-slate-50 text-xs font-bold text-slate-600">{i + 1}</div>
          <div className="flex-1 min-w-0">
            <div className="truncate text-sm font-medium text-slate-800">{p.name}</div>
            <div className="text-[11px] text-slate-500">{p.qty} sold · {inr(p.revenue)}</div>
          </div>
          <Icon className={`h-4 w-4 ${tone}`} />
        </li>
      ))}
    </ul>
  );
}

function inr(n: number) {
  return "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}
