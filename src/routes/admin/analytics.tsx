import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, PieChart, Pie, Cell, CartesianGrid } from "recharts";

export const Route = createFileRoute("/admin/analytics")({
  head: () => ({ meta: [{ title: "Analytics — ACH Admin" }] }),
  component: Analytics,
});

const COLORS = ["#F6A99A", "#8FAF9A", "#F8D6D0", "#E8B0A0", "#B4C9BB"];

function Analytics() {
  const { data } = useQuery({
    queryKey: ["analytics"],
    queryFn: async () => {
      const { data: items } = await supabase.from("order_items").select("product_name,quantity,line_total").limit(2000);
      const { data: orders } = await supabase.from("orders").select("channel,total");
      const perProduct = new Map<string, number>();
      (items ?? []).forEach((it) => perProduct.set(it.product_name, (perProduct.get(it.product_name) ?? 0) + it.quantity));
      const top = [...perProduct.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, qty]) => ({ name: name.slice(0, 20), qty }));
      const channels = [
        { name: "Online", value: (orders ?? []).filter((o) => o.channel === "ONLINE").reduce((s, o) => s + Number(o.total), 0) },
        { name: "In-Store", value: (orders ?? []).filter((o) => o.channel === "IN_STORE").reduce((s, o) => s + Number(o.total), 0) },
      ];
      return { top, channels };
    },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Analytics</h1>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 text-sm font-semibold">Top 10 Products by Quantity</div>
          <div className="h-72">
            <ResponsiveContainer><BarChart data={data?.top ?? []} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" />
              <XAxis type="number" tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 10 }} />
              <Tooltip /><Bar dataKey="qty" fill="#8FAF9A" radius={[0, 6, 6, 0]} />
            </BarChart></ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 text-sm font-semibold">Revenue by Channel</div>
          <div className="h-72">
            <ResponsiveContainer><PieChart>
              <Pie data={data?.channels ?? []} dataKey="value" outerRadius={100} label>
                {(data?.channels ?? []).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie><Tooltip formatter={(v: number) => `₹${v.toFixed(0)}`} />
            </PieChart></ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
