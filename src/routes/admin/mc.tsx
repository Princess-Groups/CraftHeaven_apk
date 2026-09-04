import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMemo } from "react";
import {
  PackageSearch,
  Boxes,
  ShoppingCart,
  TrendingUp,
  AlertTriangle,
  XCircle,
  Clock,
  CheckCircle,
  BarChart3,
} from "lucide-react";

export const Route = createFileRoute("/admin/mc")({
  head: () => ({ meta: [{ title: "Multi-Channel Overview — ACH Admin" }] }),
  component: MCOverview,
});

function MCOverview() {
  const { data: products } = useQuery({
    queryKey: ["mc-overview-products"],
    queryFn: async () =>
      (await supabase.from("mc_master_products").select("id,status,current_stock,available_stock,damaged_stock")).data ?? [],
  });

  const { data: inventory } = useQuery({
    queryKey: ["mc-overview-inventory"],
    queryFn: async () =>
      (await supabase.from("mc_inventory").select("physical_stock,available_stock,reserved_stock,sold_stock,damaged_stock")).data ?? [],
  });

  const { data: orders } = useQuery({
    queryKey: ["mc-overview-orders"],
    queryFn: async () =>
      (await supabase.from("mc_marketplace_orders").select("id,status,total,channel_id,created_at")).data ?? [],
  });

  const { data: channels } = useQuery({
    queryKey: ["mc-channels"],
    queryFn: async () =>
      (await supabase.from("mc_marketplace_channels").select("id,name,channel,connection_status,is_enabled")).data ?? [],
  });

  const { data: syncJobs } = useQuery({
    queryKey: ["mc-sync-jobs-recent"],
    queryFn: async () =>
      (await supabase.from("mc_sync_jobs").select("id,status,job_type,items_synced,items_failed,created_at").order("created_at", { ascending: false }).limit(10)).data ?? [],
  });

  const stats = useMemo(() => {
    const totalProducts = products?.length ?? 0;
    const activeProducts = products?.filter((p) => p.status === "ACTIVE").length ?? 0;
    const totalStock = inventory?.reduce((s, i) => s + (Number(i.physical_stock) || 0), 0) ?? 0;
    const availableStock = inventory?.reduce((s, i) => s + (Number(i.available_stock) || 0), 0) ?? 0;
    const reservedStock = inventory?.reduce((s, i) => s + (Number(i.reserved_stock) || 0), 0) ?? 0;
    const damagedStock = inventory?.reduce((s, i) => s + (Number(i.damaged_stock) || 0), 0) ?? 0;
    const lowStock = products?.filter((p) => (p.current_stock ?? 0) > 0 && (p.current_stock ?? 0) <= 5).length ?? 0;
    const outOfStock = products?.filter((p) => (p.current_stock ?? 0) <= 0).length ?? 0;
    const totalOrders = orders?.length ?? 0;
    const pendingOrders = orders?.filter((o) => ["NEW", "CONFIRMED", "PROCESSING", "PACKED"].includes(o.status)).length ?? 0;
    const totalSales = orders?.reduce((s, o) => s + (Number(o.total) || 0), 0) ?? 0;
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayOrders = orders?.filter((o) => o.created_at?.startsWith(todayStr)).length ?? 0;
    const todaySales = orders?.filter((o) => o.created_at?.startsWith(todayStr)).reduce((s, o) => s + (Number(o.total) || 0), 0) ?? 0;
    const failedSyncs = syncJobs?.filter((j) => j.status === "FAILED").length ?? 0;
    return {
      totalProducts, activeProducts, totalStock, availableStock, reservedStock,
      damagedStock, lowStock, outOfStock, totalOrders, pendingOrders, totalSales,
      todayOrders, todaySales, failedSyncs,
    };
  }, [products, inventory, orders, syncJobs]);

  const kpis = [
    { label: "Total Products", value: stats.totalProducts, icon: PackageSearch, color: "text-blue-600", bg: "bg-blue-50" },
    { label: "Total Stock", value: stats.totalStock, icon: Boxes, color: "text-emerald-600", bg: "bg-emerald-50" },
    { label: "Available Stock", value: stats.availableStock, icon: CheckCircle, color: "text-green-600", bg: "bg-green-50" },
    { label: "Reserved Stock", value: stats.reservedStock, icon: Clock, color: "text-amber-600", bg: "bg-amber-50" },
    { label: "Low Stock", value: stats.lowStock, icon: AlertTriangle, color: "text-orange-600", bg: "bg-orange-50" },
    { label: "Out of Stock", value: stats.outOfStock, icon: XCircle, color: "text-rose-600", bg: "bg-rose-50" },
    { label: "Today's Orders", value: stats.todayOrders, icon: ShoppingCart, color: "text-indigo-600", bg: "bg-indigo-50" },
    { label: "Today's Sales", value: `₹${stats.todaySales.toLocaleString("en-IN")}`, icon: TrendingUp, color: "text-purple-600", bg: "bg-purple-50" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <BarChart3 className="h-6 w-6 text-primary" />
        <h1 className="text-xl font-bold text-foreground">Multi-Channel Overview</h1>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <div key={kpi.label} className="rounded-xl border border-border bg-white p-4 shadow-sm">
              <div className="flex items-center gap-3">
                <div className={`grid h-10 w-10 place-items-center rounded-lg ${kpi.bg}`}>
                  <Icon className={`h-5 w-5 ${kpi.color}`} />
                </div>
                <div>
                  <div className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wide">{kpi.label}</div>
                  <div className="text-lg font-bold text-foreground">{kpi.value}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Channel Status */}
        <div className="rounded-xl border border-border bg-white shadow-sm p-4">
          <h2 className="text-sm font-bold text-foreground mb-3">Channel Status</h2>
          <div className="space-y-2">
            {(channels ?? []).map((ch) => (
              <div key={ch.id} className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2">
                <div className="flex items-center gap-2">
                  <div className={`h-2 w-2 rounded-full ${ch.connection_status === "CONNECTED" ? "bg-green-500" : ch.is_enabled ? "bg-amber-500" : "bg-gray-300"}`} />
                  <span className="text-sm font-medium">{ch.name}</span>
                </div>
                <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full ${
                  ch.connection_status === "CONNECTED" ? "bg-green-50 text-green-700" :
                  ch.connection_status === "ERROR" ? "bg-rose-50 text-rose-700" :
                  "bg-gray-50 text-gray-500"
                }`}>
                  {ch.connection_status}
                </span>
              </div>
            ))}
            {(!channels || channels.length === 0) && (
              <p className="text-xs text-muted-foreground/70 text-center py-4">No channels configured</p>
            )}
          </div>
        </div>

        {/* Recent Sync Activity */}
        <div className="rounded-xl border border-border bg-white shadow-sm p-4">
          <h2 className="text-sm font-bold text-foreground mb-3">Recent Sync Activity</h2>
          <div className="space-y-2">
            {(syncJobs ?? []).slice(0, 8).map((job) => (
              <div key={job.id} className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${
                    job.status === "COMPLETED" ? "bg-green-500" :
                    job.status === "FAILED" ? "bg-rose-500" :
                    job.status === "RUNNING" ? "bg-blue-500 animate-pulse" :
                    "bg-gray-300"
                  }`} />
                  <span className="font-medium">{job.job_type}</span>
                </div>
                <div className="flex items-center gap-3 text-muted-foreground">
                  <span>{job.items_synced}/{job.items_total}</span>
                  <span className={`font-semibold ${
                    job.status === "COMPLETED" ? "text-green-600" :
                    job.status === "FAILED" ? "text-rose-600" : "text-muted-foreground"
                  }`}>{job.status}</span>
                </div>
              </div>
            ))}
            {(!syncJobs || syncJobs.length === 0) && (
              <p className="text-xs text-muted-foreground/70 text-center py-4">No sync activity yet</p>
            )}
          </div>
        </div>
      </div>

      {/* Quick Summary */}
      <div className="rounded-xl border border-border bg-white shadow-sm p-4">
        <h2 className="text-sm font-bold text-foreground mb-3">Quick Summary</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
          <div>
            <div className="text-2xl font-bold text-foreground">{stats.totalOrders}</div>
            <div className="text-[10px] font-semibold uppercase text-muted-foreground">Total Orders</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-amber-600">{stats.pendingOrders}</div>
            <div className="text-[10px] font-semibold uppercase text-muted-foreground">Pending Orders</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-emerald-600">₹{stats.totalSales.toLocaleString("en-IN")}</div>
            <div className="text-[10px] font-semibold uppercase text-muted-foreground">Total Sales</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-rose-600">{stats.failedSyncs}</div>
            <div className="text-[10px] font-semibold uppercase text-muted-foreground">Failed Syncs</div>
          </div>
        </div>
      </div>
    </div>
  );
}
