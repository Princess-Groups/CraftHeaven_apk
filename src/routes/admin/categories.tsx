import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { Plus, Trash2, Edit3, Check, X } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/categories")({
  head: () => ({ meta: [{ title: "Categories — ACH Admin" }] }),
  component: Categories,
});

function Categories() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

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
    const { error } = await supabase.from("categories").insert({ name: name.trim(), slug });
    if (error) return toast.error(error.message);
    setName("");
    toast.success("Category added");
    qc.invalidateQueries({ queryKey: ["admin-cats"] });
  }

  async function saveEdit(id: string) {
    if (!editName.trim()) return toast.error("Name required");
    const slug = editName
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
    const { error } = await supabase.from("categories").update({ name: editName.trim(), slug }).eq("id", id);
    if (error) return toast.error(error.message);
    setEditingId(null);
    toast.success("Category updated");
    qc.invalidateQueries({ queryKey: ["admin-cats"] });
  }

  function startEdit(id: string, currentName: string) {
    setEditingId(id);
    setEditName(currentName);
  }

  async function del(id: string) {
    if (!confirm("Delete this category? Products using it will become uncategorized.")) return;
    const { error } = await supabase.from("categories").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Category deleted");
    qc.invalidateQueries({ queryKey: ["admin-cats"] });
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <h1 className="text-xl font-bold text-foreground">Categories</h1>
      <p className="text-xs text-muted-foreground">
        Manage product categories. Categories help organize products in Purchase Entry and Inventory.
      </p>

      {/* Add new category */}
      <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="New category name"
            className="flex-1 rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-secondary"
          />
          <button
            onClick={add}
            className="flex items-center gap-1 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        </div>
      </div>

      {/* Categories list */}
      <div className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
        {(cats ?? []).map((c, i) => (
          <div
            key={c.id}
            className="flex items-center justify-between border-b border-border p-3 last:border-0 hover:bg-secondary-soft/30"
          >
            {editingId === c.id ? (
              <div className="flex items-center gap-2 flex-1">
                <span className="text-xs font-semibold text-muted-foreground/70 w-6">{i + 1}.</span>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveEdit(c.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  className="flex-1 rounded-lg border border-secondary px-3 py-1.5 text-sm outline-none"
                  autoFocus
                />
                <button
                  onClick={() => saveEdit(c.id)}
                  className="rounded p-1.5 hover:bg-emerald-50 text-emerald-600"
                  title="Save"
                >
                  <Check className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setEditingId(null)}
                  className="rounded p-1.5 hover:bg-muted text-muted-foreground"
                  title="Cancel"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <>
                <div className="text-sm">
                  <span className="mr-3 inline-block w-6 text-xs font-semibold text-muted-foreground/70">
                    {i + 1}
                  </span>
                  {c.name}
                  <span className="ml-2 text-xs text-muted-foreground/50">/{c.slug}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => startEdit(c.id, c.name)}
                    className="rounded p-1.5 hover:bg-secondary-soft"
                    title="Edit category"
                  >
                    <Edit3 className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                  <button
                    onClick={() => del(c.id)}
                    className="rounded p-1.5 hover:bg-rose-50"
                    title="Delete category"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-rose-600" />
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
        {!cats?.length && (
          <div className="p-6 text-center text-xs text-muted-foreground/70">
            No categories yet — add one above
          </div>
        )}
      </div>

      <div className="text-[11px] text-muted-foreground">
        Total: {cats?.length ?? 0} categories
      </div>
    </div>
  );
}
