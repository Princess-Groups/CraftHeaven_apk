import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useMemo } from "react";
import { Plus, Trash2, Search, Edit2, X, Loader2, Layers } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/materials")({
  head: () => ({ meta: [{ title: "Materials — ACH Admin" }] }),
  component: Materials,
});

type MaterialRow = {
  id: string;
  name: string;
  category_id: string | null;
  is_active: boolean | null;
  created_at: string;
  categories?: { name: string } | null;
};

function Materials() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: "",
    category_id: "",
  });

  // Fetch materials with category
  const { data: materials, isLoading } = useQuery({
    queryKey: ["materials"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("materials")
        .select("*, categories(name)")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as MaterialRow[];
    },
  });

  // Fetch categories for dropdown
  const { data: categories } = useQuery({
    queryKey: ["cats-lite"],
    queryFn: async () => (await supabase.from("categories").select("id,name").order("name")).data ?? [],
  });

  const filtered = useMemo(() => {
    let result = materials ?? [];
    if (categoryFilter) {
      result = result.filter((m) => m.category_id === categoryFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (m) =>
          m.name?.toLowerCase().includes(q) ||
          m.categories?.name?.toLowerCase().includes(q),
      );
    }
    return result;
  }, [search, categoryFilter, materials]);

  function resetForm() {
    setForm({ name: "", category_id: "" });
    setEditingId(null);
    setFormOpen(false);
  }

  function startEdit(m: MaterialRow) {
    setForm({
      name: m.name ?? "",
      category_id: m.category_id ?? "",
    });
    setEditingId(m.id);
    setFormOpen(true);
  }

  async function saveMaterial() {
    if (!form.name.trim()) return toast.error("Material name is required");
    if (!form.category_id) return toast.error("Please select a category");
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        category_id: form.category_id || null,
        is_active: true,
      };

      if (editingId) {
        const { error } = await supabase.from("materials").update(payload).eq("id", editingId);
        if (error) throw error;
        toast.success("Material updated");
      } else {
        const { error } = await supabase.from("materials").insert(payload);
        if (error) throw error;
        toast.success("Material added");
      }
      resetForm();
      qc.invalidateQueries({ queryKey: ["materials"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function deleteMaterial(id: string) {
    const { error } = await supabase.from("materials").update({ is_active: false }).eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["materials"] });
    toast.success("Material removed");
  }

  // Group materials by category for display
  const materialsByCategory = useMemo(() => {
    const groups: Record<string, { category: string; materials: MaterialRow[] }> = {};
    for (const m of filtered) {
      const catName = m.categories?.name ?? "Uncategorized";
      if (!groups[m.category_id ?? "none"]) {
        groups[m.category_id ?? "none"] = { category: catName, materials: [] };
      }
      groups[m.category_id ?? "none"].materials.push(m);
    }
    return Object.values(groups);
  }, [filtered]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Layers className="h-5 w-5 text-primary" />
          Materials Management
        </h1>
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-1.5 shadow-sm flex-1">
            <Search className="h-4 w-4 text-muted-foreground/70" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search materials…"
              className="bg-transparent text-sm outline-none w-full"
            />
          </div>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="rounded-lg border border-border bg-white px-3 py-1.5 text-sm outline-none"
          >
            <option value="">All Categories</option>
            {(categories ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <button
          onClick={() => { resetForm(); setFormOpen(true); }}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary/90 transition"
        >
          <Plus className="h-3.5 w-3.5" /> Add Material
        </button>
      </div>

      {/* Add/Edit Form */}
      {formOpen && (
        <div className="rounded-xl border-2 border-primary/30 bg-white shadow-card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-primary/5 border-b border-border">
            <h2 className="text-sm font-bold text-primary">
              {editingId ? "Edit Material" : "Add New Material"}
            </h2>
            <button onClick={resetForm} className="rounded-lg p-1 hover:bg-secondary-soft transition">
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Material Name */}
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Material Name *</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Cotton, Wool, Silk"
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
              </div>

              {/* Category */}
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Category *</label>
                <select
                  value={form.category_id}
                  onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                >
                  <option value="">Select Category</option>
                  {(categories ?? []).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Save buttons */}
            <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-border">
              <button
                onClick={resetForm}
                className="rounded-lg border border-border px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-secondary-soft transition"
              >
                Cancel
              </button>
              <button
                onClick={saveMaterial}
                disabled={saving || !form.name.trim() || !form.category_id}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50 transition"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                {saving ? "Saving…" : editingId ? "Update Material" : "Add Material"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Materials Table */}
      {isLoading ? (
        <div className="rounded-xl border border-border bg-white p-12 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto" />
          <p className="text-sm text-muted-foreground mt-2">Loading materials…</p>
        </div>
      ) : filtered.length > 0 ? (
        <div className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted text-[11px] uppercase text-muted-foreground">
              <tr>
                <th className="p-3 text-left w-10">#</th>
                <th className="p-3 text-left">Material Name</th>
                <th className="p-3 text-left">Category</th>
                <th className="p-3 text-right w-20">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m, i) => (
                <tr key={m.id} className="border-t border-border hover:bg-secondary-soft/30 transition">
                  <td className="p-3 text-xs font-semibold text-muted-foreground">{i + 1}</td>
                  <td className="p-3 font-medium text-sm">{m.name}</td>
                  <td className="p-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                      {m.categories?.name ?? "—"}
                    </span>
                  </td>
                  <td className="p-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => startEdit(m)}
                        className="rounded p-1 hover:bg-primary/10 transition"
                        title="Edit"
                      >
                        <Edit2 className="h-3.5 w-3.5 text-primary" />
                      </button>
                      <button
                        onClick={() => deleteMaterial(m.id)}
                        className="rounded p-1 hover:bg-rose-50 transition"
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-white/50 py-12 text-center">
          <Layers className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            {search || categoryFilter ? "No materials match your search." : "No materials added yet."}
          </p>
          {!search && !categoryFilter && (
            <p className="text-xs text-muted-foreground/70 mt-1">
              Click <strong>+ Add Material</strong> to create your first material.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
