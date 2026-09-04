import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { DollarSign, Save, Loader2, Calculator } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/mc/costs")({
  head: () => ({ meta: [{ title: "Cost Calculation — Multi-Channel" }] }),
  component: CostCalculation,
});

type CostData = {
  id: string;
  master_product_id: string;
  purchase_cost: number;
  gst_amount: number;
  shipping_cost: number;
  transport_cost: number;
  packaging_cost: number;
  marketplace_fee: number;
  commission: number;
  payment_gateway_charges: number;
  other_expenses: number;
  landed_cost: number;
  gross_profit: number;
  net_profit: number;
  profit_margin_pct: number;
  mc_master_products: { name: string; sku: string; selling_price: number } | null;
};

function CostCalculation() {
  const qc = useQueryClient();
  const [selectedProduct, setSelectedProduct] = useState<string>("");
  const [costs, setCosts] = useState({
    purchase_cost: 0,
    gst_amount: 0,
    shipping_cost: 0,
    transport_cost: 0,
    packaging_cost: 0,
    marketplace_fee: 0,
    commission: 0,
    payment_gateway_charges: 0,
    other_expenses: 0,
  });
  const [saving, setSaving] = useState(false);

  const { data: products } = useQuery({
    queryKey: ["mc-products-cost"],
    queryFn: async () =>
      (await supabase.from("mc_master_products").select("id,name,sku,selling_price,purchase_price").order("name")).data ?? [],
  });

  const { data: existingCosts } = useQuery({
    queryKey: ["mc-costs"],
    queryFn: async () =>
      (await supabase.from("mc_product_costs").select("*, mc_master_products(name,sku,selling_price)")).data ?? [],
  });

  const selectedProductData = products?.find((p) => p.id === selectedProduct);

  // Calculate derived values
  const totalCost = Object.values(costs).reduce((s, v) => s + (Number(v) || 0), 0);
  const sellingPrice = Number(selectedProductData?.selling_price) || 0;
  const grossProfit = sellingPrice - totalCost;
  const profitMargin = sellingPrice > 0 ? (grossProfit / sellingPrice) * 100 : 0;

  function selectProduct(productId: string) {
    setSelectedProduct(productId);
    const existing = existingCosts?.find((c) => c.master_product_id === productId);
    if (existing) {
      setCosts({
        purchase_cost: Number(existing.purchase_cost) || 0,
        gst_amount: Number(existing.gst_amount) || 0,
        shipping_cost: Number(existing.shipping_cost) || 0,
        transport_cost: Number(existing.transport_cost) || 0,
        packaging_cost: Number(existing.packaging_cost) || 0,
        marketplace_fee: Number(existing.marketplace_fee) || 0,
        commission: Number(existing.commission) || 0,
        payment_gateway_charges: Number(existing.payment_gateway_charges) || 0,
        other_expenses: Number(existing.other_expenses) || 0,
      });
    } else {
      const product = products?.find((p) => p.id === productId);
      setCosts({
        purchase_cost: Number(product?.purchase_price) || 0,
        gst_amount: 0,
        shipping_cost: 0,
        transport_cost: 0,
        packaging_cost: 0,
        marketplace_fee: 0,
        commission: 0,
        payment_gateway_charges: 0,
        other_expenses: 0,
      });
    }
  }

  async function saveCost() {
    if (!selectedProduct) return toast.error("Select a product first");
    setSaving(true);
    const payload = {
      master_product_id: selectedProduct,
      ...costs,
      landed_cost: totalCost,
      gross_profit: grossProfit,
      net_profit: grossProfit,
      profit_margin_pct: Math.round(profitMargin * 100) / 100,
    };
    const existing = existingCosts?.find((c) => c.master_product_id === selectedProduct);
    if (existing) {
      const { error } = await supabase.from("mc_product_costs").update(payload).eq("id", existing.id);
      if (error) { setSaving(false); return toast.error(error.message); }
    } else {
      const { error } = await supabase.from("mc_product_costs").insert(payload);
      if (error) { setSaving(false); return toast.error(error.message); }
    }
    toast.success("Cost calculation saved");
    setSaving(false);
    qc.invalidateQueries({ queryKey: ["mc-costs"] });
  }

  const costFields = [
    { key: "purchase_cost" as const, label: "Purchase Cost", icon: "📦" },
    { key: "gst_amount" as const, label: "GST / Tax", icon: "🏛️" },
    { key: "shipping_cost" as const, label: "Shipping Cost", icon: "🚚" },
    { key: "transport_cost" as const, label: "Transport Cost", icon: "🚛" },
    { key: "packaging_cost" as const, label: "Packaging Cost", icon: "📋" },
    { key: "marketplace_fee" as const, label: "Marketplace Fees", icon: "🏪" },
    { key: "commission" as const, label: "Commission", icon: "💰" },
    { key: "payment_gateway_charges" as const, label: "Payment Gateway", icon: "💳" },
    { key: "other_expenses" as const, label: "Other Expenses", icon: "📎" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <DollarSign className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold text-foreground flex-1">Cost Calculation</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Product Selection & Cost Inputs */}
        <div className="lg:col-span-2 rounded-xl border border-border bg-white shadow-sm p-4 space-y-4">
          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase">Select Product</label>
            <select value={selectedProduct} onChange={(e) => selectProduct(e.target.value)} className={inputCls}>
              <option value="">— Choose a product —</option>
              {(products ?? []).map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({p.sku || "no SKU"}) — ₹{p.selling_price}</option>
              ))}
            </select>
          </div>

          {selectedProduct && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {costFields.map((f) => (
                <div key={f.key} className="space-y-1">
                  <label className="text-[11px] font-semibold text-muted-foreground uppercase flex items-center gap-1">
                    <span>{f.icon}</span> {f.label}
                  </label>
                  <input
                    type="number"
                    value={costs[f.key] || ""}
                    onChange={(e) => setCosts({ ...costs, [f.key]: Number(e.target.value) || 0 })}
                    className={inputCls}
                    step="0.01"
                    placeholder="0.00"
                  />
                </div>
              ))}
            </div>
          )}

          {selectedProduct && (
            <div className="flex justify-end">
              <button onClick={saveCost} disabled={saving} className="flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Save Cost Calculation
              </button>
            </div>
          )}
        </div>

        {/* Summary Panel */}
        <div className="rounded-xl border border-border bg-white shadow-sm p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Calculator className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-bold text-foreground">Cost Summary</h2>
          </div>

          {selectedProduct ? (
            <div className="space-y-3">
              <div className="rounded-lg bg-muted/50 p-3 space-y-2">
                <div className="text-xs font-semibold text-foreground">{selectedProductData?.name}</div>
                <div className="text-[10px] text-muted-foreground">SKU: {selectedProductData?.sku || "—"}</div>
                <div className="text-[10px] text-muted-foreground">Selling Price: <span className="font-bold text-foreground">₹{sellingPrice.toLocaleString("en-IN")}</span></div>
              </div>

              <div className="space-y-1.5">
                {costFields.map((f) => (
                  costs[f.key] > 0 && (
                    <div key={f.key} className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{f.label}</span>
                      <span className="font-semibold">₹{Number(costs[f.key]).toLocaleString("en-IN")}</span>
                    </div>
                  )
                ))}
              </div>

              <div className="border-t border-border pt-3 space-y-2">
                <div className="flex justify-between text-sm font-bold">
                  <span>Landed Cost</span>
                  <span className="text-foreground">₹{totalCost.toLocaleString("en-IN")}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Selling Price</span>
                  <span className="font-semibold">₹{sellingPrice.toLocaleString("en-IN")}</span>
                </div>
                <div className="flex justify-between text-sm font-bold">
                  <span className={grossProfit >= 0 ? "text-emerald-600" : "text-rose-600"}>Net Profit</span>
                  <span className={grossProfit >= 0 ? "text-emerald-600" : "text-rose-600"}>
                    ₹{grossProfit.toLocaleString("en-IN")}
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Profit Margin</span>
                  <span className={`font-bold ${profitMargin >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                    {profitMargin.toFixed(1)}%
                  </span>
                </div>
              </div>

              {/* Visual bar */}
              <div className="space-y-1">
                <div className="text-[10px] font-semibold text-muted-foreground uppercase">Cost Breakdown</div>
                <div className="h-4 rounded-full bg-muted overflow-hidden flex">
                  {sellingPrice > 0 && costFields.map((f, i) => {
                    const pct = (Number(costs[f.key]) / sellingPrice) * 100;
                    if (pct <= 0) return null;
                    const colors = ["bg-blue-400", "bg-purple-400", "bg-amber-400", "bg-orange-400", "bg-pink-400", "bg-indigo-400", "bg-teal-400", "bg-cyan-400", "bg-gray-400"];
                    return <div key={f.key} className={`${colors[i]} h-full`} style={{ width: `${Math.min(pct, 100)}%` }} title={`${f.label}: ${pct.toFixed(1)}%`} />;
                  })}
                  {grossProfit > 0 && <div className="bg-green-500 h-full" style={{ width: `${Math.min((grossProfit / sellingPrice) * 100, 100)}%` }} title={`Profit: ${((grossProfit / sellingPrice) * 100).toFixed(1)}%`} />}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-xs text-muted-foreground/70">
              Select a product to calculate costs
            </div>
          )}
        </div>
      </div>

      {/* All Saved Cost Calculations */}
      {existingCosts && existingCosts.length > 0 && (
        <div className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-bold text-foreground">Saved Cost Calculations</h2>
          </div>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-muted">
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-left border-b border-border">Product</th>
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-right border-b border-border">Landed Cost</th>
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-right border-b border-border">Selling Price</th>
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-right border-b border-border">Profit</th>
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-right border-b border-border">Margin</th>
              </tr>
            </thead>
            <tbody>
              {existingCosts.map((c) => (
                <tr key={c.id} className="border-b border-border/50 last:border-0 hover:bg-secondary-soft/20 cursor-pointer" onClick={() => selectProduct(c.master_product_id)}>
                  <td className="px-3 py-2.5 text-xs font-semibold">{c.mc_master_products?.name ?? "—"}</td>
                  <td className="px-3 py-2.5 text-xs text-right">₹{Number(c.landed_cost).toLocaleString("en-IN")}</td>
                  <td className="px-3 py-2.5 text-xs text-right font-semibold">₹{Number(c.mc_master_products?.selling_price ?? 0).toLocaleString("en-IN")}</td>
                  <td className="px-3 py-2.5 text-xs text-right font-bold">
                    <span className={Number(c.net_profit) >= 0 ? "text-emerald-600" : "text-rose-600"}>
                      ₹{Number(c.net_profit).toLocaleString("en-IN")}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-right">
                    <span className={`font-bold ${Number(c.profit_margin_pct) >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                      {Number(c.profit_margin_pct).toFixed(1)}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const inputCls = "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary";
