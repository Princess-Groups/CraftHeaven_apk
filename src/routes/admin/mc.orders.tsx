import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useMemo } from "react";
import { ClipboardCheck, Search, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/mc/orders")({
  head: () => ({ meta: [{ title: "Orders — Multi-Channel" }] }),
  component: MCOrders,
});

const STATUSES = ["NEW", "CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "DELIVERED", "CANCELLED", "RETURNED", "REFUNDED"] as const;
const STATUS_COLORS: Record<string, string> = {
  NEW: "bg-blue-50 text-blue-700",
  CONFIRMED: "bg-indigo-50 text-indigo-700",
  PROCESSING: "bg-amber-50 text-amber-700",
  PACKED: "bg-purple-50 text-purple-700",
  SHIPPED: "bg-cyan-50 text-cyan-700",
  DELIVERED: "bg-green-50 text-green-700",
  CANCELLED: "bg-rose-50 text-rose-700",
  RETURNED: "bg-orange-50 text-orange-700",
  REFUNDED: "bg-gray-50 text-gray-700",
};

type MCOrder = {
  id: string;
  channel_id: string;
  marketplace_order_id: string;
  customer_name: string | null;
  status: string;
  payment_status: string | null;
  payment_method: string | null;
  subtotal: number;
  discount: number;
  shipping_charges: number;
  tax: number;
  total: number;
  platform_fees: number;
  commission: number;
  created_at: string;
  mc_marketplace_channels: { name: string; channel: string } | null;
  mc_marketplace_order_items: { product_name: string; quantity: number; unit_price: number; total: number }[] | null;
};

function MCOrders() {
  const qc = useQueryClient();
  const [channelFilter, setChannelFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [searchQ, setSearchQ] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const { data: orders } = useQuery({
    queryKey: ["mc-orders", channelFilter, statusFilter],
    queryFn: async () => {
      let q = supabase
        .from("mc_marketplace_orders")
        .select("*, mc_marketplace_channels(name,channel), mc_marketplace_order_items(product_name,quantity,unit_price,total)")
        .order("created_at", { ascending: false });
      if (channelFilter !== "ALL") {
        const { data: ch } = await supabase.from("mc_marketplace_channels").select("id").eq("channel", channelFilter).single();
        if (ch) q = q.eq("channel_id", ch.id);
      }
      if (statusFilter !== "ALL") q = q.eq("status", statusFilter);
      return (await q).data ?? [];
    },
  });

  const filtered = useMemo(() => {
    if (!searchQ.trim()) return orders ?? [];
    const q = searchQ.toLowerCase();
    return (orders ?? []).filter(
      (o) => o.marketplace_order_id?.toLowerCase().includes(q) ||
        o.customer_name?.toLowerCase().includes(q) ||
        o.mc_marketplace_order_items?.some((i) => i.product_name?.toLowerCase().includes(q)),
    );
  }, [searchQ, orders]);

  const stats = useMemo(() => {
    const list = orders ?? [];
    return {
      total: list.length,
      pending: list.filter((o) => ["NEW", "CONFIRMED", "PROCESSING", "PACKED"].includes(o.status)).length,
      shipped: list.filter((o) => o.status === "SHIPPED").length,
      delivered: list.filter((o) => o.status === "DELIVERED").length,
      revenue: list.reduce((s, o) => s + (Number(o.total) || 0), 0),
    };
  }, [orders]);

  async function updateStatus(orderId: string, newStatus: string) {
    const { error } = await supabase.from("mc_marketplace_orders").update({ status: newStatus }).eq("id", orderId);
    if (error) return toast.error(error.message);
    toast.success(`Order status updated to ${newStatus}`);
    qc.invalidateQueries({ queryKey: ["mc-orders"] });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <ClipboardCheck className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold text-foreground flex-1">Multi-Channel Orders</h1>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Total Orders", value: stats.total },
          { label: "Pending", value: stats.pending, color: "text-amber-600" },
          { label: "Shipped", value: stats.shipped, color: "text-cyan-600" },
          { label: "Delivered", value: stats.delivered, color: "text-green-600" },
          { label: "Revenue", value: `₹${stats.revenue.toLocaleString("en-IN")}`, color: "text-primary" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-white p-3 shadow-sm text-center">
            <div className={`text-lg font-bold ${s.color || "text-foreground"}`}>{s.value}</div>
            <div className="text-[10px] font-semibold uppercase text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg border border-border bg-white p-0.5">
          {["ALL", "WEBSITE", "AMAZON", "FLIPKART", "MEESHO"].map((ch) => (
            <button key={ch} onClick={() => setChannelFilter(ch)} className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${channelFilter === ch ? "bg-primary text-white" : "text-muted-foreground hover:bg-secondary-soft"}`}>
              {ch === "ALL" ? "All Channels" : ch}
            </button>
          ))}
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-border bg-white px-3 py-1.5 text-xs">
          <option value="ALL">All Statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-1.5 shadow-sm ml-auto">
          <Search className="h-4 w-4 text-muted-foreground/70" />
          <input value={searchQ} onChange={(e) => setSearchQ(e.target.value)} placeholder="Search orders…" className="bg-transparent text-sm outline-none w-40" />
        </div>
        <span className="text-[10px] text-muted-foreground">{filtered.length} orders</span>
      </div>

      {/* Orders Table */}
      <div className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-muted">
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-left border-b border-border w-8"></th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-left border-b border-border">Order ID</th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-center border-b border-border">Channel</th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-left border-b border-border">Customer</th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-right border-b border-border">Total</th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-center border-b border-border">Payment</th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-center border-b border-border">Status</th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-center border-b border-border">Date</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((order) => {
              const chName = order.mc_marketplace_channels?.channel ?? "UNKNOWN";
              const expandedRow = expanded[order.id];
              return [
                <tr key={order.id} className="border-b border-border/50 hover:bg-secondary-soft/20 transition cursor-pointer" onClick={() => setExpanded({ ...expanded, [order.id]: !expandedRow })}>
                  <td className="px-2 py-2.5">
                    {expandedRow ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                  </td>
                  <td className="px-3 py-2.5 text-xs font-mono font-semibold">{order.marketplace_order_id?.slice(0, 12) ?? order.id.slice(0, 8)}</td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${chName === "WEBSITE" ? "bg-blue-50 text-blue-700" : chName === "AMAZON" ? "bg-amber-50 text-amber-700" : chName === "FLIPKART" ? "bg-indigo-50 text-indigo-700" : "bg-rose-50 text-rose-700"}`}>
                      {chName}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-xs font-semibold">{order.customer_name || "—"}</td>
                  <td className="px-3 py-2.5 text-xs text-right font-bold">₹{Number(order.total ?? 0).toLocaleString("en-IN")}</td>
                  <td className="px-3 py-2.5 text-center text-xs">{order.payment_method || "—"}</td>
                  <td className="px-3 py-2.5 text-center">
                    <select
                      value={order.status}
                      onChange={(e) => { e.stopPropagation(); updateStatus(order.id, e.target.value); }}
                      onClick={(e) => e.stopPropagation()}
                      className={`text-[10px] font-bold uppercase rounded-full px-2 py-0.5 border-0 cursor-pointer ${STATUS_COLORS[order.status] || "bg-gray-50 text-gray-600"}`}
                    >
                      {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2.5 text-center text-[10px] text-muted-foreground">{new Date(order.created_at).toLocaleDateString("en-IN")}</td>
                </tr>,
                expandedRow && (
                  <tr key={`${order.id}-detail`} className="bg-muted/30">
                    <td colSpan={8} className="px-6 py-3">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <div className="text-[10px] font-bold uppercase text-muted-foreground mb-1">Order Items</div>
                          {order.mc_marketplace_order_items?.map((item, i) => (
                            <div key={i} className="flex justify-between text-xs py-0.5">
                              <span>{item.product_name} × {item.quantity}</span>
                              <span className="font-semibold">₹{Number(item.total ?? 0).toLocaleString("en-IN")}</span>
                            </div>
                          ))}
                          {(!order.mc_marketplace_order_items || order.mc_marketplace_order_items.length === 0) && (
                            <p className="text-xs text-muted-foreground/70">No items</p>
                          )}
                        </div>
                        <div className="space-y-1 text-xs">
                          <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>₹{Number(order.subtotal ?? 0).toLocaleString("en-IN")}</span></div>
                          {Number(order.discount) > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span className="text-rose-600">-₹{Number(order.discount).toLocaleString("en-IN")}</span></div>}
                          {Number(order.tax) > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span>₹{Number(order.tax).toLocaleString("en-IN")}</span></div>}
                          {Number(order.shipping_charges) > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Shipping</span><span>₹{Number(order.shipping_charges).toLocaleString("en-IN")}</span></div>}
                          {Number(order.platform_fees) > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Platform Fees</span><span>₹{Number(order.platform_fees).toLocaleString("en-IN")}</span></div>}
                          {Number(order.commission) > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Commission</span><span>₹{Number(order.commission).toLocaleString("en-IN")}</span></div>}
                          <div className="flex justify-between border-t border-border pt-1 font-bold"><span>Total</span><span>₹{Number(order.total ?? 0).toLocaleString("en-IN")}</span></div>
                        </div>
                      </div>
                    </td>
                  </tr>
                ),
              ].filter(Boolean);
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="px-6 py-12 text-center text-xs text-muted-foreground/70">No orders found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
