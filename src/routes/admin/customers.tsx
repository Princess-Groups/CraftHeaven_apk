import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { ChevronDown, ChevronRight, Package, Calendar, ShoppingBag } from "lucide-react";

export const Route = createFileRoute("/admin/customers")({
  head: () => ({ meta: [{ title: "Customers — ACH Admin" }] }),
  component: Customers,
});

type Customer = {
  id: string;
  full_name: string | null;
  phone: string | null;
  created_at: string;
  orderCount: number;
  totalItems: number;
  totalValue: number;
  lastOrderDate: string | null;
  mostOrdered: { name: string; times: number } | null;
  lastProduct: string | null;
  orders: CustomerOrder[];
  frequency: { name: string; sku: string; times: number; totalQty: number }[];
};

type CustomerOrder = {
  id: string;
  status: string;
  payment_method: string;
  created_at: string;
  total: number;
  items: { product_name: string; sku: string; quantity: number; unit_price: number }[];
};

function Customers() {
  const { data } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const [profilesR, ordersR, itemsR] = await Promise.all([
        supabase
          .from("profiles")
          .select("id,full_name,phone,created_at")
          .order("created_at", { ascending: false }),
        supabase
          .from("orders")
          .select("id,user_id,status,payment_method,total,created_at")
          .not("user_id", "is", null)
          .order("created_at", { ascending: false })
          .limit(500),
        supabase
          .from("order_items")
          .select("order_id,product_name,quantity,unit_price,products(sku)")
          .limit(1000),
      ]);
      const profiles = profilesR.data ?? [];
      const orders = ordersR.data ?? [];
      const items = itemsR.data ?? [];

      // group items by order
      const itemsByOrder = new Map<string, typeof items>();
      items.forEach((it) => {
        const arr = itemsByOrder.get(it.order_id) ?? [];
        arr.push(it);
        itemsByOrder.set(it.order_id, arr);
      });

      return profiles.map((p): Customer => {
        const myOrders = orders
          .filter((o) => o.user_id === p.id)
          .map((o): CustomerOrder => ({
            id: o.id,
            status: o.status,
            payment_method: o.payment_method,
            created_at: o.created_at,
            total: Number(o.total),
            items: (itemsByOrder.get(o.id) ?? []).map((it) => ({
              product_name: it.product_name,
              // products may be null (deleted product) — fall back to product_name
              sku: (it.products as { sku: string | null } | null)?.sku ?? "",
              quantity: it.quantity,
              unit_price: Number(it.unit_price),
            })),
          }));

        const completed = myOrders.filter((o) => o.status !== "CANCELLED");
        const totalItems = completed.reduce(
          (s, o) => s + o.items.reduce((a, i) => a + i.quantity, 0),
          0,
        );
        const totalValue = completed.reduce((s, o) => s + o.total, 0);
        const lastOrderDate = completed.length ? completed[0].created_at : null;

        // Product frequency — only across completed orders
        const freq = new Map<
          string,
          { name: string; sku: string; times: number; totalQty: number }
        >();
        completed.forEach((o) =>
          o.items.forEach((it) => {
            const prev = freq.get(it.product_name) ?? {
              name: it.product_name,
              sku: it.sku,
              times: 0,
              totalQty: 0,
            };
            prev.times++;
            prev.totalQty += it.quantity;
            freq.set(it.product_name, prev);
          }),
        );
        const frequency = [...freq.values()].sort((a, b) => b.times - a.times);
        const mostOrdered = frequency.length
          ? { name: frequency[0].name, times: frequency[0].times }
          : null;

        // Last ordered product = product in the most recent completed order
        const latest = completed[0];
        const lastProduct = latest && latest.items.length ? latest.items[0].product_name : null;

        return {
          id: p.id,
          full_name: p.full_name,
          phone: p.phone,
          created_at: p.created_at,
          orderCount: completed.length,
          totalItems,
          totalValue,
          lastOrderDate,
          mostOrdered,
          lastProduct,
          orders: myOrders,
          frequency,
        };
      });
    },
  });

  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Customers</h1>
      <div className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-muted text-[11px] uppercase text-muted-foreground">
            <tr>
              <th className="p-3 text-left">S.No.</th>
              <th className="p-3 text-left">Customer</th>
              <th className="p-3">Mobile</th>
              <th className="p-3 text-right">Orders</th>
              <th className="p-3 text-right">Items Purchased</th>
              <th className="p-3">Last Order</th>
              <th className="p-3 text-right">Lifetime Value</th>
              <th className="p-3 text-right">Purchase History</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((c, i) => (
              <CustomerRow
                key={c.id}
                c={c}
                sno={i + 1}
                open={openId === c.id}
                onToggle={() => setOpenId(openId === c.id ? null : c.id)}
              />
            ))}
            {!data?.length && (
              <tr>
                <td colSpan={9} className="p-6 text-center text-xs text-muted-foreground/70">
                  No customers
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CustomerRow({
  c,
  sno,
  open,
  onToggle,
}: {
  c: Customer;
  sno: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className={`border-t border-border cursor-pointer hover:bg-secondary-soft/60 ${open ? "bg-secondary-soft/60" : ""}`}
        onClick={onToggle}
      >
        <td className="p-3 text-xs font-semibold text-muted-foreground w-10">{sno}</td>
        <td className="p-3 font-medium">{c.full_name || "—"}</td>
        <td className="p-3 text-xs text-center">{c.phone || "—"}</td>
        <td className="p-3 text-right font-semibold">{c.orderCount}</td>
        <td className="p-3 text-right font-semibold">{c.totalItems}</td>
        <td className="p-3 text-xs text-center">
          {c.lastOrderDate ? new Date(c.lastOrderDate).toLocaleDateString() : "—"}
        </td>
        <td className="p-3 text-right font-semibold">₹{c.totalValue.toFixed(0)}</td>
        <td className="p-3 text-right text-xs">
          {c.mostOrdered ? `${c.mostOrdered.name} ×${c.mostOrdered.times}` : "—"}
        </td>
        <td className="p-3 text-right">
          {open ? (
            <ChevronDown className="ml-auto h-4 w-4 text-muted-foreground/70" />
          ) : (
            <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground/70" />
          )}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={9} className="bg-secondary-soft/40 p-4">
            <CustomerDetail c={c} />
          </td>
        </tr>
      )}
    </>
  );
}

function CustomerDetail({ c }: { c: Customer }) {
  const totalQty = c.orders
    .filter((o) => o.status !== "CANCELLED")
    .reduce((s, o) => s + o.items.reduce((a, i) => a + i.quantity, 0), 0);
  const totalValue = c.orders
    .filter((o) => o.status !== "CANCELLED")
    .reduce((s, o) => s + o.total, 0);
  const mostPurchased = [...c.frequency].sort((a, b) => b.totalQty - a.totalQty)[0];

  return (
    <div className="space-y-4">
      {/* ===== Customer Order Summary ===== */}
      <div>
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <ShoppingBag className="h-3.5 w-3.5" /> Customer Order Summary
        </h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          <SummaryTile label="Total Orders" value={String(c.orderCount)} />
          <SummaryTile label="Products Purchased" value={String(c.frequency.length)} />
          <SummaryTile label="Total Quantity" value={String(totalQty)} />
          <SummaryTile label="Purchase Value" value={`₹${totalValue.toFixed(0)}`} />
          <SummaryTile label="Most Ordered" value={mostPurchased ? mostPurchased.name : "—"} />
          <SummaryTile label="Last Ordered Product" value={c.lastProduct ?? "—"} />
          <SummaryTile
            label="Last Order Date"
            value={c.lastOrderDate ? new Date(c.lastOrderDate).toLocaleDateString() : "—"}
          />
        </div>
      </div>

      {/* ===== Product order frequency ===== */}
      <div>
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <Package className="h-3.5 w-3.5" /> Products Ordered Frequency
        </h3>
        <div className="overflow-hidden rounded-lg border border-border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-muted text-[11px] uppercase text-muted-foreground">
              <tr>
                <th className="p-2.5 text-left">Product</th>
                <th className="p-2.5 text-left">SKU</th>
                <th className="p-2.5 text-right">Times Ordered</th>
                <th className="p-2.5 text-right">Total Quantity</th>
              </tr>
            </thead>
            <tbody>
              {c.frequency.map((f) => (
                <tr key={f.name} className="border-t border-border">
                  <td className="p-2.5 font-medium">{f.name}</td>
                  <td className="p-2.5 text-xs text-muted-foreground">{f.sku || "—"}</td>
                  <td className="p-2.5 text-right font-semibold">
                    {f.times} {f.times === 1 ? "Time" : "Times"}
                  </td>
                  <td className="p-2.5 text-right">{f.totalQty}</td>
                </tr>
              ))}
              {!c.frequency.length && (
                <tr>
                  <td colSpan={4} className="p-4 text-center text-xs text-muted-foreground/70">
                    No completed orders yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ===== Order history ===== */}
      <div>
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <Calendar className="h-3.5 w-3.5" /> Order History ({c.orders.length})
        </h3>
        <div className="overflow-x-auto rounded-lg border border-border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-muted text-[11px] uppercase text-muted-foreground">
              <tr>
                <th className="p-2.5 text-left">Product Name</th>
                <th className="p-2.5 text-left">SKU / Code</th>
                <th className="p-2.5 text-right">Quantity</th>
                <th className="p-2.5 text-left">Order Date</th>
                <th className="p-2.5 text-left">Order / Invoice No.</th>
                <th className="p-2.5 text-right">Selling Price</th>
                <th className="p-2.5 text-right">Total Amount</th>
                <th className="p-2.5 text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {c.orders
                .flatMap((o) => {
                  const lines = o.items.length
                    ? o.items.map((it) => ({ ...it, order: o }))
                    : [{ product_name: "—", sku: "", quantity: 0, unit_price: 0, order: o }];
                  return lines;
                })
                .map((ln, i) => (
                  <tr
                    key={`${ln.order.id}-${i}`}
                    className={`border-t border-border ${ln.order.status === "CANCELLED" ? "opacity-60" : ""}`}
                  >
                    <td className="p-2.5 font-medium">{ln.product_name}</td>
                    <td className="p-2.5 text-xs text-muted-foreground">{ln.sku || "—"}</td>
                    <td className="p-2.5 text-right">{ln.quantity}</td>
                    <td className="p-2.5 text-xs text-muted-foreground">
                      {new Date(ln.order.created_at).toLocaleDateString()}
                    </td>
                    <td className="p-2.5 font-mono text-xs">
                      #{ln.order.id.slice(0, 8).toUpperCase()}
                    </td>
                    <td className="p-2.5 text-right">₹{Number(ln.unit_price).toFixed(2)}</td>
                    <td className="p-2.5 text-right font-semibold">
                      ₹{Number(ln.unit_price * ln.quantity).toFixed(2)}
                    </td>
                    <td className="p-2.5 text-center">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${ln.order.status === "CANCELLED" ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}
                      >
                        {ln.order.status === "CANCELLED" ? "Cancelled" : "Completed"}
                      </span>
                    </td>
                  </tr>
                ))}
              {!c.orders.length && (
                <tr>
                  <td colSpan={8} className="p-4 text-center text-xs text-muted-foreground/70">
                    No orders yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-white px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate text-sm font-bold text-foreground">{value}</div>
    </div>
  );
}
