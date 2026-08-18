import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, Fragment } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronUp } from "lucide-react";

export const Route = createFileRoute("/admin/orders")({
  head: () => ({ meta: [{ title: "Orders — ACH Admin" }] }),
  component: Orders,
});

const STATUSES = [
  "NEW",
  "PROCESSING",
  "PACKED",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "CANCELLED",
] as const;

type OrderRow = {
  id: string;
  channel: "ONLINE" | "IN_STORE";
  status: string;
  payment_method: string;
  total: number;
  subtotal: number;
  discount: number;
  delivery_fee: number;
  shipping_charges: number;
  tax_type: string;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  gst_total: number;
  transaction_state: string | null;
  created_at: string;
  user_id: string | null;
  user?: { full_name: string | null; phone: string | null } | null;
  order_items: {
    product_name: string;
    quantity: number;
    unit: string;
    unit_price: number;
    line_total: number;
    variation: string | null;
  }[];
};

function Orders() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"ONLINE" | "IN_STORE">("ONLINE");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const { data: orders } = useQuery({
    queryKey: ["admin-orders", tab, statusFilter],
    queryFn: async () => {
      let q = supabase
        .from("orders")
        .select(
          "*, user_id, order_items(product_name,quantity,unit,unit_price,line_total,variation)",
        )
        .eq("channel", tab)
        .order("created_at", { ascending: false })
        .limit(200);
      if (statusFilter) q = q.eq("status", statusFilter as never);
      const { data } = await q;
      const rows = (data ?? []) as unknown as (OrderRow & { user_id: string | null })[];
      // Customer info lives on profiles (keyed by auth user id), not a direct FK.
      const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
      const { data: profiles } = userIds.length
        ? await supabase
            .from("profiles")
            .select("id,full_name,phone")
            .in("id", userIds as string[])
        : { data: [] };
      const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
      return rows.map((r) => ({
        ...r,
        user: r.user_id ? (byId.get(r.user_id) ?? null) : null,
      })) as unknown as OrderRow[];
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

  function toggle(id: string) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-foreground flex-1">Orders</h1>
        <div className="flex rounded-lg border border-border bg-white p-1">
          {(["ONLINE", "IN_STORE"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 text-xs font-semibold rounded ${tab === t ? "bg-secondary text-white" : "text-muted-foreground"}`}
            >
              {t === "ONLINE" ? "Online Orders" : "Offline Bills"}
            </button>
          ))}
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-border bg-white px-3 py-2 text-xs"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-muted text-[11px] uppercase text-muted-foreground">
            <tr>
              <th className="p-3 text-left">S.No.</th>
              <th className="p-3 text-left">Order</th>
              <th className="p-3 text-left">Customer</th>
              <th className="p-3 text-left">Date</th>
              <th className="p-3 text-right">Subtotal</th>
              <th className="p-3 text-right">GST</th>
              <th className="p-3 text-right">Shipping</th>
              <th className="p-3 text-right">Total</th>
              <th className="p-3">Payment</th>
              <th className="p-3">Status</th>
              <th className="p-3 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {(orders ?? []).map((o, i) => (
              <Fragment key={o.id}>
                <tr className="border-t border-border">
                  <td className="p-3 text-xs font-semibold text-muted-foreground w-10">{i + 1}</td>
                  <td className="p-3 font-mono text-xs">#{o.id.slice(0, 8).toUpperCase()}</td>
                  <td className="p-3 text-xs">
                    {o.channel === "ONLINE" ? (
                      <span className="font-medium text-foreground">
                        {o.user?.full_name || "Guest"}
                        {o.user?.phone ? (
                          <span className="block text-[10px] text-muted-foreground">
                            {o.user.phone}
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Walk-in</span>
                    )}
                  </td>
                  <td className="p-3 text-xs text-muted-foreground">
                    {new Date(o.created_at).toLocaleString()}
                  </td>
                  <td className="p-3 text-right">₹{Number(o.subtotal).toFixed(2)}</td>
                  <td className="p-3 text-right text-muted-foreground">
                    ₹{Number(o.gst_total).toFixed(2)}
                  </td>
                  <td className="p-3 text-right text-muted-foreground">
                    ₹{Number(o.shipping_charges).toFixed(2)}
                  </td>
                  <td className="p-3 text-right font-semibold">₹{Number(o.total).toFixed(2)}</td>
                  <td className="p-3 text-center text-xs">
                    <span className="rounded bg-secondary-soft px-2 py-0.5">
                      {o.payment_method}
                    </span>
                  </td>
                  <td className="p-3">
                    <select
                      value={o.status}
                      onChange={(e) => updateStatus(o.id, e.target.value)}
                      className="rounded-lg border border-border bg-white px-2 py-1 text-xs"
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s.replace(/_/g, " ")}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="p-3">
                    <button
                      onClick={() => toggle(o.id)}
                      className="rounded p-1 hover:bg-secondary-soft"
                    >
                      {expanded[o.id] ? (
                        <ChevronUp className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                    </button>
                  </td>
                </tr>
                {expanded[o.id] && (
                  <tr className="bg-muted/70">
                    <td colSpan={11} className="p-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div>
                          <div className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">
                            Items
                          </div>
                          <table className="w-full text-xs">
                            <tbody>
                              {(o.order_items ?? []).map((it, k) => (
                                <tr key={k} className="border-b border-border">
                                  <td className="py-1">
                                    {it.product_name}
                                    {it.variation ? (
                                      <span className="ml-1 rounded bg-emerald-50 px-1 py-0.5 text-[10px] font-semibold text-emerald-700">
                                        {it.variation}
                                      </span>
                                    ) : null}
                                  </td>
                                  <td className="py-1 text-right text-muted-foreground whitespace-nowrap">
                                    ×{Number(it.quantity)} {it.unit ?? ""}
                                  </td>
                                  <td className="py-1 text-right font-semibold">
                                    ₹{Number(it.line_total).toFixed(2)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div>
                          <div className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">
                            Bill summary
                          </div>
                          <div className="space-y-1 text-xs">
                            <div className="flex justify-between">
                              <span>Subtotal</span>
                              <span>₹{Number(o.subtotal).toFixed(2)}</span>
                            </div>
                            {Number(o.discount) > 0 && (
                              <div className="flex justify-between text-rose-600">
                                <span>Discount</span>
                                <span>–₹{Number(o.discount).toFixed(2)}</span>
                              </div>
                            )}
                            {o.tax_type === "CGST_SGST" ? (
                              <>
                                {Number(o.cgst_amount) > 0 && (
                                  <div className="flex justify-between">
                                    <span>CGST (Central)</span>
                                    <span>₹{Number(o.cgst_amount).toFixed(2)}</span>
                                  </div>
                                )}
                                {Number(o.sgst_amount) > 0 && (
                                  <div className="flex justify-between">
                                    <span>SGST (State)</span>
                                    <span>₹{Number(o.sgst_amount).toFixed(2)}</span>
                                  </div>
                                )}
                              </>
                            ) : (
                              Number(o.igst_amount) > 0 && (
                                <div className="flex justify-between">
                                  <span>IGST</span>
                                  <span>₹{Number(o.igst_amount).toFixed(2)}</span>
                                </div>
                              )
                            )}
                            {Number(o.delivery_fee) > 0 && (
                              <div className="flex justify-between">
                                <span>Delivery fee</span>
                                <span>₹{Number(o.delivery_fee).toFixed(2)}</span>
                              </div>
                            )}
                            <div className="flex justify-between">
                              <span>Shipping / Courier</span>
                              <span>₹{Number(o.shipping_charges).toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between border-t border-border pt-1 text-sm font-bold">
                              <span>Total</span>
                              <span>₹{Number(o.total).toFixed(2)}</span>
                            </div>
                            {o.transaction_state && (
                              <div className="pt-1 text-[10px] text-muted-foreground">
                                State: {o.transaction_state}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {!orders?.length && (
              <tr>
                <td colSpan={11} className="p-8 text-center text-xs text-muted-foreground/70">
                  No orders
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
