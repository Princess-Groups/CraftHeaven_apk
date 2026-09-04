import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { Tag, Save, Loader2, Edit3 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/mc/pricing")({
  head: () => ({ meta: [{ title: "Platform Pricing — Multi-Channel" }] }),
  component: PlatformPricing,
});

const CHANNELS = [
  { key: "WEBSITE", label: "Website", color: "bg-blue-50 text-blue-700" },
  { key: "AMAZON", label: "Amazon", color: "bg-amber-50 text-amber-700" },
  { key: "FLIPKART", label: "Flipkart", color: "bg-blue-50 text-blue-800" },
  { key: "MEESHO", label: "Meesho", color: "bg-rose-50 text-rose-700" },
] as const;

type ChannelPrice = {
  id: string;
  master_product_id: string;
  channel: string;
  price: number;
  min_price: number | null;
  max_price: number | null;
  discount_price: number | null;
  promotional_price: number | null;
  platform_margin_pct: number;
};

function PlatformPricing() {
  const qc = useQueryClient();
  const [searchQ, setSearchQ] = useState("");
  const [editingProduct, setEditingProduct] = useState<string | null>(null);
  const [prices, setPrices] = useState<Record<string, ChannelPrice[]>>({});
  const [saving, setSaving] = useState(false);

  const { data: products } = useQuery({
    queryKey: ["mc-products-pricing", searchQ],
    queryFn: async () => {
      let q = supabase.from("mc_master_products").select("id,name,sku,selling_price").order("name");
      if (searchQ.trim()) q = q.ilike("name", `%${searchQ}%`);
      return (await q).data ?? [];
    },
  });

  const { data: allPrices } = useQuery({
    queryKey: ["mc-channel-prices"],
    queryFn: async () =>
      (await supabase.from("mc_channel_prices").select("*")).data ?? [],
  });

  function startEditing(productId: string) {
    setEditingProduct(productId);
    const productPrices = allPrices?.filter((p) => p.master_product_id === productId) ?? [];
    const priceMap: Record<string, ChannelPrice[]> = {};
    for (const ch of CHANNELS) {
      const existing = productPrices.find((p) => p.channel === ch.key);
      priceMap[ch.key] = existing ? [existing] : [{
        id: "",
        master_product_id: productId,
        channel: ch.key,
        price: 0,
        min_price: null,
        max_price: null,
        discount_price: null,
        promotional_price: null,
        platform_margin_pct: 0,
      }];
    }
    setPrices(priceMap);
  }

  function updatePrice(channel: string, field: string, value: number) {
    setPrices((prev) => ({
      ...prev,
      [channel]: [{
        ...prev[channel]?.[0],
        [field]: value,
      }],
    }));
  }

  async function savePrices() {
    if (!editingProduct) return;
    setSaving(true);
    try {
      for (const ch of CHANNELS) {
        const p = prices[ch.key]?.[0];
        if (!p) continue;
        if (p.id) {
          await supabase.from("mc_channel_prices").update({
            price: p.price,
            min_price: p.min_price,
            max_price: p.max_price,
            discount_price: p.discount_price,
            promotional_price: p.promotional_price,
            platform_margin_pct: p.platform_margin_pct,
          }).eq("id", p.id);
        } else if (p.price > 0) {
          await supabase.from("mc_channel_prices").insert({
            master_product_id: editingProduct,
            channel: ch.key,
            price: p.price,
            min_price: p.min_price,
            max_price: p.max_price,
            discount_price: p.discount_price,
            promotional_price: p.promotional_price,
            platform_margin_pct: p.platform_margin_pct,
          });
        }
      }
      toast.success("Platform prices saved");
      setEditingProduct(null);
      qc.invalidateQueries({ queryKey: ["mc-channel-prices"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Tag className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold text-foreground flex-1">Platform Pricing</h1>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-1.5 shadow-sm">
          <input value={searchQ} onChange={(e) => setSearchQ(e.target.value)} placeholder="Search products…" className="bg-transparent text-sm outline-none w-48" />
        </div>
      </div>

      {/* Products Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {(products ?? []).map((product) => {
          const productPrices = allPrices?.filter((p) => p.master_product_id === product.id) ?? [];
          const isEditing = editingProduct === product.id;

          return (
            <div key={product.id} className={`rounded-xl border bg-white shadow-sm p-4 transition ${isEditing ? "border-primary ring-2 ring-primary/20" : "border-border"}`}>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="text-sm font-bold text-foreground">{product.name}</div>
                  <div className="text-[10px] text-muted-foreground font-mono">SKU: {product.sku || "—"}</div>
                  <div className="text-xs text-primary font-semibold mt-0.5">Base: ₹{Number(product.selling_price ?? 0).toLocaleString("en-IN")}</div>
                </div>
                {!isEditing && (
                  <button onClick={() => startEditing(product.id)} className="rounded-lg p-1.5 hover:bg-secondary-soft text-primary">
                    <Edit3 className="h-4 w-4" />
                  </button>
                )}
              </div>

              {isEditing ? (
                <div className="space-y-2">
                  {CHANNELS.map((ch) => {
                    const chPrice = prices[ch.key]?.[0];
                    return (
                      <div key={ch.key} className="rounded-lg border border-border/50 p-2 space-y-1">
                        <div className={`text-[10px] font-bold uppercase ${ch.color} inline-block px-1.5 py-0.5 rounded`}>{ch.label}</div>
                        <div className="grid grid-cols-2 gap-1">
                          <div>
                            <label className="text-[9px] text-muted-foreground">Price ₹</label>
                            <input type="number" value={chPrice?.price ?? ""} onChange={(e) => updatePrice(ch.key, "price", Number(e.target.value))} className="w-full rounded border border-border px-2 py-1 text-xs" step="0.01" />
                          </div>
                          <div>
                            <label className="text-[9px] text-muted-foreground">Margin %</label>
                            <input type="number" value={chPrice?.platform_margin_pct ?? ""} onChange={(e) => updatePrice(ch.key, "platform_margin_pct", Number(e.target.value))} className="w-full rounded border border-border px-2 py-1 text-xs" step="0.01" />
                          </div>
                          <div>
                            <label className="text-[9px] text-muted-foreground">Min ₹</label>
                            <input type="number" value={chPrice?.min_price ?? ""} onChange={(e) => updatePrice(ch.key, "min_price", Number(e.target.value))} className="w-full rounded border border-border px-2 py-1 text-xs" step="0.01" />
                          </div>
                          <div>
                            <label className="text-[9px] text-muted-foreground">Discount ₹</label>
                            <input type="number" value={chPrice?.discount_price ?? ""} onChange={(e) => updatePrice(ch.key, "discount_price", Number(e.target.value))} className="w-full rounded border border-border px-2 py-1 text-xs" step="0.01" />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div className="flex justify-end gap-1 pt-1">
                    <button onClick={() => setEditingProduct(null)} className="rounded px-2 py-1 text-[10px] font-semibold text-muted-foreground hover:bg-secondary-soft">Cancel</button>
                    <button onClick={savePrices} disabled={saving} className="flex items-center gap-1 rounded bg-primary px-3 py-1 text-[10px] font-semibold text-white hover:bg-primary/90 disabled:opacity-50">
                      {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  {CHANNELS.map((ch) => {
                    const chPrice = productPrices.find((p) => p.channel === ch.key);
                    return (
                      <div key={ch.key} className="flex items-center justify-between text-xs">
                        <span className={`text-[10px] font-semibold ${ch.color} px-1.5 py-0.5 rounded`}>{ch.label}</span>
                        <span className="font-bold">{chPrice ? `₹${Number(chPrice.price).toLocaleString("en-IN")}` : "—"}</span>
                      </div>
                    );
                  })}
                  {productPrices.length === 0 && (
                    <p className="text-[10px] text-muted-foreground/70 text-center py-2">No prices set</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {(!products || products.length === 0) && (
          <div className="col-span-full text-center py-12 text-xs text-muted-foreground/70">
            No products found. Add products in Master Products first.
          </div>
        )}
      </div>
    </div>
  );
}
