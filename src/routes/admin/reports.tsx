import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";

export const Route = createFileRoute("/admin/reports")({
  head: () => ({ meta: [{ title: "Reports — ACH Admin" }] }),
  component: Reports,
});

type Tab = "summary" | "purchase" | "sales";

function Reports() {
  const [period, setPeriod] = useState<"daily" | "monthly" | "yearly">("daily");
  const [tab, setTab] = useState<Tab>("summary");

  const { data } = useQuery({
    queryKey: ["report", period],
    queryFn: async () => {
      const now = new Date();
      const from =
        period === "daily"
          ? new Date(now.getTime() - 30 * 864e5)
          : period === "monthly"
            ? new Date(now.getFullYear(), now.getMonth() - 11, 1)
            : new Date(now.getFullYear() - 4, 0, 1);
      const { data: orders } = await supabase
        .from("orders")
        .select("total,channel,created_at,status")
        .gte("created_at", from.toISOString());
      const { data: purchases } = await supabase
        .from("purchases")
        .select("total,created_at")
        .gte("created_at", from.toISOString());
      const os = orders ?? [];
      return {
        totalSales: os.reduce((s, o) => s + Number(o.total), 0),
        online: os.filter((o) => o.channel === "ONLINE").reduce((s, o) => s + Number(o.total), 0),
        offline: os
          .filter((o) => o.channel === "IN_STORE")
          .reduce((s, o) => s + Number(o.total), 0),
        orderCount: os.length,
        cancelled: os.filter((o) => o.status === "CANCELLED").length,
        purchaseTotal: (purchases ?? []).reduce((s, p) => s + Number(p.total), 0),
      };
    },
  });

  // Purchase report — product name always visible
  const { data: purchaseReport } = useQuery({
    queryKey: ["report-purchases"],
    queryFn: async () =>
      (
        await supabase
          .from("purchases")
          .select(
            "id,invoice_no,purchase_date,total,supplier_id,suppliers(name),purchase_items(id,quantity,unit_cost,line_total,products(name,sku))",
          )
          .order("purchase_date", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(100)
      ).data ?? [],
  });

  // Sales report — completed (non-cancelled) orders
  const { data: salesReport } = useQuery({
    queryKey: ["report-sales"],
    queryFn: async () => {
      const { data: orders } = await supabase
        .from("orders")
        .select("id,channel,status,payment_method,total,created_at,user_id")
        .order("created_at", { ascending: false })
        .limit(200);
      const { data: items } = await supabase
        .from("order_items")
        .select("id,order_id,product_name,quantity,unit_price,line_total");
      const byOrder = new Map<string, typeof items>();
      (items ?? []).forEach((it) => {
        const arr = byOrder.get(it.order_id) ?? [];
        arr.push(it);
        byOrder.set(it.order_id, arr);
      });
      return (orders ?? [])
        .filter((o) => o.status !== "CANCELLED")
        .map((o) => ({ ...o, items: byOrder.get(o.id) ?? [] }));
    },
  });

  function exportCsv() {
    if (!data) return;
    const rows = [
      ["Metric", "Value"],
      ["Period", period],
      ["Total Sales", data.totalSales],
      ["Online Sales", data.online],
      ["Offline Sales", data.offline],
      ["Orders", data.orderCount],
      ["Cancelled", data.cancelled],
      ["Purchases", data.purchaseTotal],
      ["Profit (est.)", data.totalSales - data.purchaseTotal],
    ];
    const csv = rows.map((r) => r.join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `report-${period}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const purchaseLines = (purchaseReport ?? []).flatMap((p) => {
    const its = (p.purchase_items ?? []).filter(Boolean);
    if (!its.length)
      return [{ ...p, productName: "—", sku: "", qty: 0, cost: 0, line: Number(p.total) }];
    return its.map((it) => ({
      ...p,
      productName: it.products?.name ?? "—",
      sku: it.products?.sku ?? "",
      qty: it.quantity,
      cost: Number(it.unit_cost),
      line: Number(it.line_total),
    }));
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-bold flex-1">Reports</h1>
        <div className="flex rounded-lg border border-border bg-white p-1">
          {(["daily", "monthly", "yearly"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-4 py-1.5 text-xs font-semibold rounded ${period === p ? "bg-primary text-white" : "text-muted-foreground"}`}
            >
              {p}
            </button>
          ))}
        </div>
        <button
          onClick={() => setTab("purchase")}
          className={`rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold ${tab === "purchase" ? "ring-2 ring-secondary" : ""}`}
        >
          Purchase Report
        </button>
        <button
          onClick={() => setTab("sales")}
          className={`rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold ${tab === "sales" ? "ring-2 ring-secondary" : ""}`}
        >
          Sales Report
        </button>
        <button
          onClick={exportCsv}
          className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold"
        >
          Export CSV
        </button>
      </div>

      {tab === "summary" && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            ["Total Sales", data?.totalSales],
            ["Online Sales", data?.online],
            ["Offline Sales", data?.offline],
            ["Purchases", data?.purchaseTotal],
            ["Profit (est.)", (data?.totalSales ?? 0) - (data?.purchaseTotal ?? 0)],
            ["Orders", data?.orderCount ?? 0],
            ["Cancelled", data?.cancelled ?? 0],
          ].map(([label, val]) => (
            <div
              key={label as string}
              className="rounded-xl border border-border bg-white p-4 shadow-sm"
            >
              <div className="text-[11px] uppercase text-muted-foreground">{label as string}</div>
              <div className="mt-1 text-xl font-bold">
                {typeof val === "number" && label !== "Orders" && label !== "Cancelled"
                  ? `₹${Number(val).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
                  : (val ?? 0)}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "purchase" && (
        <div className="rounded-xl border border-border bg-white shadow-sm">
          <div className="border-b border-border px-4 py-3">
            <div className="text-sm font-bold text-foreground">Purchase Report</div>
            <div className="text-[11px] text-muted-foreground">
              Every purchase line with the product name, supplier and totals.
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted text-[11px] uppercase text-muted-foreground">
                <tr>
                  <th className="p-3 text-left">S.No.</th>
                  <th className="p-3 text-left">Purchase Date</th>
                  <th className="p-3 text-left">Product Name</th>
                  <th className="p-3 text-left">SKU / Code</th>
                  <th className="p-3 text-right">Quantity</th>
                  <th className="p-3 text-left">Supplier</th>
                  <th className="p-3 text-right">Purchase Price</th>
                  <th className="p-3 text-right">Total Amount</th>
                  <th className="p-3 text-left">Invoice No.</th>
                </tr>
              </thead>
              <tbody>
                {purchaseLines.map((r, i) => (
                  <tr key={`${r.id}-${i}`} className="border-t border-border">
                    <td className="p-3 text-xs font-semibold text-muted-foreground">{i + 1}</td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {new Date(r.purchase_date).toLocaleDateString()}
                    </td>
                    <td className="p-3 font-semibold text-foreground">{r.productName}</td>
                    <td className="p-3 text-xs text-muted-foreground">{r.sku || "—"}</td>
                    <td className="p-3 text-right">{r.qty}</td>
                    <td className="p-3 text-xs">{r.suppliers?.name ?? "—"}</td>
                    <td className="p-3 text-right">₹{Number(r.cost).toFixed(2)}</td>
                    <td className="p-3 text-right font-semibold">₹{Number(r.line).toFixed(2)}</td>
                    <td className="p-3 text-xs">{r.invoice_no ?? "—"}</td>
                  </tr>
                ))}
                {!purchaseLines.length && (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-xs text-muted-foreground/70">
                      No purchases recorded yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "sales" && (
        <div className="rounded-xl border border-border bg-white shadow-sm">
          <div className="border-b border-border px-4 py-3">
            <div className="text-sm font-bold text-foreground">Sales Report</div>
            <div className="text-[11px] text-muted-foreground">
              Completed / non-cancelled orders (cancelled orders are excluded).
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted text-[11px] uppercase text-muted-foreground">
                <tr>
                  <th className="p-3 text-left">S.No.</th>
                  <th className="p-3 text-left">Order</th>
                  <th className="p-3 text-left">Product Name</th>
                  <th className="p-3 text-right">Quantity</th>
                  <th className="p-3 text-right">Selling Price</th>
                  <th className="p-3 text-right">Total</th>
                  <th className="p-3 text-left">Payment</th>
                  <th className="p-3 text-left">Date</th>
                </tr>
              </thead>
              <tbody>
                {(salesReport ?? [])
                  .flatMap((o) => {
                    const its = o.items ?? [];
                    if (!its.length)
                      return [{ ...o, name: "—", qty: 0, price: 0, line: Number(o.total) }];
                    return its.map((it) => ({
                      ...o,
                      name: it.product_name,
                      qty: it.quantity,
                      price: Number(it.unit_price),
                      line: Number(it.line_total),
                    }));
                  })
                  .map((r, i) => (
                    <tr key={`${r.id}-${i}`} className="border-t border-border">
                      <td className="p-3 text-xs font-semibold text-muted-foreground">{i + 1}</td>
                      <td className="p-3 font-mono text-xs">#{r.id.slice(0, 8).toUpperCase()}</td>
                      <td className="p-3 font-semibold text-foreground">{r.name}</td>
                      <td className="p-3 text-right">{r.qty}</td>
                      <td className="p-3 text-right">₹{Number(r.price).toFixed(2)}</td>
                      <td className="p-3 text-right font-semibold">₹{Number(r.line).toFixed(2)}</td>
                      <td className="p-3 text-xs">{r.payment_method}</td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {new Date(r.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                {(salesReport ?? []).length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-xs text-muted-foreground/70">
                      No sales recorded yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
