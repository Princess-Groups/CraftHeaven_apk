import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/categories")({
  head: () => ({ meta: [{ title: "Categories — ACH Admin" }] }),
  component: Categories,
});

function Categories() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const { data: cats } = useQuery({
    queryKey: ["admin-cats"],
    queryFn: async () => (await supabase.from("categories").select("*").order("name")).data ?? [],
  });

  async function add() {
    if (!name.trim()) return;
    const slug = name
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
    const { error } = await supabase.from("categories").insert({ name, slug });
    if (error) return toast.error(error.message);
    setName("");
    toast.success("Added");
    qc.invalidateQueries({ queryKey: ["admin-cats"] });
  }
  async function del(id: string) {
    if (!confirm("Delete category?")) return;
    const { error } = await supabase.from("categories").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["admin-cats"] });
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <h1 className="text-xl font-bold">Categories</h1>
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New category name"
          className="flex-1 rounded-lg border border-border px-3 py-2 text-sm"
        />
        <button
          onClick={add}
          className="flex items-center gap-1 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white"
        >
          <Plus className="h-3.5 w-3.5" /> Add
        </button>
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
        {(cats ?? []).map((c, i) => (
          <div
            key={c.id}
            className="flex items-center justify-between border-b border-border p-3 last:border-0"
          >
            <div className="text-sm">
              <span className="mr-3 inline-block w-6 text-xs font-semibold text-muted-foreground/70">
                {i + 1}
              </span>
              {c.name}
              <span className="ml-2 text-xs text-muted-foreground/70">/{c.slug}</span>
            </div>
            <button onClick={() => del(c.id)} className="text-rose-500">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        {!cats?.length && (
          <div className="p-6 text-center text-xs text-muted-foreground/70">No categories</div>
        )}
      </div>
    </div>
  );
}
