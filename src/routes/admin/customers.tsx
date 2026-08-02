import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/admin/customers")({
  head: () => ({ meta: [{ title: "Customers — ACH Admin" }] }),
  component: Customers,
});

function Customers() {
  const { data } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const { data: profiles } = await supabase.from("profiles").select("*").order("created_at", { ascending: false });
      const { data: orders } = await supabase.from("orders").select("user_id,total").not("user_id", "is", null);
      const spend = new Map<string, { count: number; total: number }>();
      (orders ?? []).forEach((o) => {
        if (!o.user_id) return;
        const prev = spend.get(o.user_id) ?? { count: 0, total: 0 };
        prev.count++; prev.total += Number(o.total);
        spend.set(o.user_id, prev);
      });
      return (profiles ?? []).map((p) => ({ ...p, ...(spend.get(p.id) ?? { count: 0, total: 0 }) }));
    },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Customers</h1>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase text-slate-500"><tr><th className="p-3 text-left">Name</th><th className="p-3">Phone</th><th className="p-3">Joined</th><th className="p-3 text-right">Orders</th><th className="p-3 text-right">Lifetime Value</th></tr></thead>
          <tbody>
            {(data ?? []).map((c) => (
              <tr key={c.id} className="border-t border-slate-100">
                <td className="p-3">{c.full_name || "—"}</td>
                <td className="p-3 text-xs text-center">{c.phone || "—"}</td>
                <td className="p-3 text-xs text-center">{new Date(c.created_at).toLocaleDateString()}</td>
                <td className="p-3 text-right font-semibold">{c.count}</td>
                <td className="p-3 text-right font-semibold">₹{c.total.toFixed(0)}</td>
              </tr>
            ))}
            {!data?.length && <tr><td colSpan={5} className="p-6 text-center text-xs text-slate-400">No customers</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
