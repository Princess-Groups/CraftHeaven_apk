import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { Sliders, Save, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/mc/settings")({
  head: () => ({ meta: [{ title: "Channel Settings — Multi-Channel" }] }),
  component: MCChannelSettings,
});

function MCChannelSettings() {
  const qc = useQueryClient();
  const [saving, setSaving] = useState<string | null>(null);

  const { data: channels } = useQuery({
    queryKey: ["mc-channels-settings"],
    queryFn: async () =>
      (await supabase.from("mc_marketplace_channels").select("*").order("channel")).data ?? [],
  });

  const [edits, setEdits] = useState<Record<string, Partial<{
    is_enabled: boolean;
    inventory_sync: boolean;
    product_sync: boolean;
    price_sync: boolean;
    order_sync: boolean;
    sync_frequency_minutes: number;
    default_pricing_rule: string;
  }>>>({});

  function getEdit(channelId: string, channelList: typeof channels): Record<string, any> {
    const ch = channelList?.find((c) => c.id === channelId);
    if (!ch) return {};
    return { ...ch, ...(edits[channelId] || {}) };
  }

  function updateEdit(channelId: string, field: string, value: any) {
    setEdits((prev) => ({ ...prev, [channelId]: { ...(prev[channelId] || {}), [field]: value } }));
  }

  async function saveChannel(channelId: string) {
    setSaving(channelId);
    const edit = edits[channelId];
    if (!edit) { setSaving(null); return; }
    const { error } = await supabase.from("mc_marketplace_channels").update({
      is_enabled: edit.is_enabled,
      inventory_sync: edit.inventory_sync,
      product_sync: edit.product_sync,
      price_sync: edit.price_sync,
      order_sync: edit.order_sync,
      sync_frequency_minutes: edit.sync_frequency_minutes,
      default_pricing_rule: edit.default_pricing_rule,
    }).eq("id", channelId);
    if (error) { setSaving(null); return toast.error(error.message); }
    toast.success("Channel settings saved");
    setSaving(null);
    setEdits((prev) => { const next = { ...prev }; delete next[channelId]; return next; });
    qc.invalidateQueries({ queryKey: ["mc-channels-settings"] });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Sliders className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold text-foreground">Channel Settings</h1>
      </div>

      <div className="space-y-4">
        {(channels ?? []).map((ch) => {
          const data = getEdit(ch.id, channels);
          const hasChanges = !!edits[ch.id];
          return (
            <div key={ch.id} className={`rounded-xl border bg-white shadow-sm p-5 transition ${hasChanges ? "border-primary ring-1 ring-primary/20" : "border-border"}`}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <span className="text-xl">
                    {ch.channel === "WEBSITE" ? "🌐" : ch.channel === "AMAZON" ? "📦" : ch.channel === "FLIPKART" ? "🛒" : "🛍️"}
                  </span>
                  <div>
                    <h3 className="text-sm font-bold text-foreground">{ch.name}</h3>
                    <div className="text-[10px] text-muted-foreground uppercase">{ch.channel}</div>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" checked={data.is_enabled ?? false} onChange={(e) => updateEdit(ch.id, "is_enabled", e.target.checked)} className="sr-only peer" />
                  <div className="w-9 h-5 bg-gray-200 peer-focus:ring-2 peer-focus:ring-primary/30 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                </label>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                {[
                  { key: "product_sync", label: "Product Sync" },
                  { key: "inventory_sync", label: "Inventory Sync" },
                  { key: "price_sync", label: "Price Sync" },
                  { key: "order_sync", label: "Order Sync" },
                ].map((s) => (
                  <label key={s.key} className="flex items-center gap-2 rounded-lg border border-border/50 px-3 py-2 cursor-pointer hover:bg-secondary-soft/30">
                    <input
                      type="checkbox"
                      checked={data[s.key as keyof typeof data] as boolean ?? false}
                      onChange={(e) => updateEdit(ch.id, s.key, e.target.checked)}
                      className="rounded border-gray-300 h-3.5 w-3.5"
                    />
                    <span className="text-xs font-medium">{s.label}</span>
                  </label>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-muted-foreground uppercase">Sync Frequency (minutes)</label>
                  <input
                    type="number"
                    value={data.sync_frequency_minutes ?? 60}
                    onChange={(e) => updateEdit(ch.id, "sync_frequency_minutes", Number(e.target.value))}
                    className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary"
                    min={5}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-muted-foreground uppercase">Default Pricing Rule</label>
                  <select
                    value={data.default_pricing_rule ?? "FIXED"}
                    onChange={(e) => updateEdit(ch.id, "default_pricing_rule", e.target.value)}
                    className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary"
                  >
                    <option value="FIXED">Fixed Price</option>
                    <option value="MARGIN">Cost + Margin</option>
                    <option value="COMPETITIVE">Competitive Pricing</option>
                  </select>
                </div>
              </div>

              {hasChanges && (
                <div className="flex justify-end">
                  <button onClick={() => saveChannel(ch.id)} disabled={saving === ch.id} className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50">
                    {saving === ch.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    Save Changes
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
