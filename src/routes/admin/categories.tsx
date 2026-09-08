import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useMemo } from "react";
import { Plus, Trash2, Edit3, Check, X, Search, Loader2, Tags, Layers } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/categories")({
  head: () => ({ meta: [{ title: "Categories & Materials — ACH Admin" }] }),
  component: Categories,
});

type MaterialRow = {
  id: string;
  name: string;
  category_id: string | null;
  is_active: boolean | null;
  created_at: string;
};

function Categories() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [materialName, setMaterialName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editingMaterialId, setEditingMaterialId] = useState<string | null>(null);
  const [editMaterialName, setEditMaterialName] = useState("");
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  const { data: cats, isLoading: catsLoading } = useQuery({
    queryKey: ["admin-cats"],
    queryFn: async () => (await supabase.from("categories").select("*").order("name")).data ?? [],
  });

  const { data: materials, isLoading: matsLoading } = useQuery({
    queryKey: ["admin-materials"],
    queryFn: async () => (await supabase.from("materials").select("*").eq("is_active", true).order("name")).data ?? [],
  });

  // Group materials by category
  const materialsByCategory = useMemo(() => {
    const map: Record<string, MaterialRow[]> = {};
    for (const m of materials ?? []) {
      const catId = m.category_id || "none";
      if (!map[catId]) map[catId] = [];
      map[catId].push(m);
    }
    return map;
  }, [materials]);

  const filteredCats = useMemo(() => {
    if (!search.trim()) return cats ?? [];
    const q = search.toLowerCase();
    return (cats ?? []).filter(
      (c) => c.name?.toLowerCase().includes(q),
    );
  }, [search, cats]);

  // Add category (and optionally a material under it)
  async function add() {
    if (!name.trim()) return toast.error("Category name is required");
    setSaving(true);
    try {
      const slug = name
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "");
      const { data: newCat, error } = await supabase
        .from("categories")
        .insert({ name: name.trim(), slug })
        .select("id")
        .single();
      if (error) throw error;

      // If material name provided, create material under this category
      if (materialName.trim() && newCat) {
        const { error: matErr } = await supabase
          .from("materials")
          .insert({ name: materialName.trim(), category_id: newCat.id, is_active: true });
        if (matErr) {
          console.error("Failed to add material:", matErr);
          toast.error("Category added but material failed: " + matErr.message);
        } else {
          toast.success("Category and material added");
          qc.invalidateQueries({ queryKey: ["admin-materials"] });
          qc.invalidateQueries({ queryKey: ["materials-lite"] });
        }
      } else {
        toast.success("Category added");
      }
      setName("");
      setMaterialName("");
      qc.invalidateQueries({ queryKey: ["admin-cats"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  // Add material under an existing category
  async function addMaterial(categoryId: string, catName: string) {
    const matName = prompt(`Add a material under "${catName}":`);
    if (!matName?.trim()) return;
    const { error } = await supabase
      .from("materials")
      .insert({ name: matName.trim(), category_id: categoryId, is_active: true });
    if (error) return toast.error(error.message);
    toast.success("Material added");
    qc.invalidateQueries({ queryKey: ["admin-materials"] });
    qc.invalidateQueries({ queryKey: ["materials-lite"] });
  }

  // Edit category
  function startEdit(id: string, currentName: string) {
    setEditingId(id);
    setEditName(currentName);
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

  // Delete category
  async function del(id: string) {
    if (!confirm("Delete this category? Materials under it will become uncategorized.")) return;
    const { error } = await supabase.from("categories").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Category deleted");
    qc.invalidateQueries({ queryKey: ["admin-cats"] });
  }

  // Edit material
  function startEditMaterial(id: string, currentName: string) {
    setEditingMaterialId(id);
    setEditMaterialName(currentName);
  }

  async function saveEditMaterial(id: string) {
    if (!editMaterialName.trim()) return toast.error("Material name required");
    const { error } = await supabase.from("materials").update({ name: editMaterialName.trim() }).eq("id", id);
    if (error) return toast.error(error.message);
    setEditingMaterialId(null);
    toast.success("Material updated");
    qc.invalidateQueries({ queryKey: ["admin-materials"] });
    qc.invalidateQueries({ queryKey: ["materials-lite"] });
  }

  // Delete material
  async function deleteMaterial(id: string) {
    if (!confirm("Delete this material?")) return;
    const { error } = await supabase.from("materials").update({ is_active: false }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Material deleted");
    qc.invalidateQueries({ queryKey: ["admin-materials"] });
    qc.invalidateQueries({ queryKey: ["materials-lite"] });
  }

  const isLoading = catsLoading || matsLoading;
  const totalMaterials = materials?.length ?? 0;

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Tags className="h-5 w-5 text-primary" />
          Categories & Materials
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Manage categories and their materials. Materials created here are available in Purchase Entry.
        </p>
      </div>

      {/* Add new category + material */}
      <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="Category name *"
            className="rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-secondary"
          />
          <input
            value={materialName}
            onChange={(e) => setMaterialName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="Material name (optional)"
            className="rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-secondary"
          />
          <button
            onClick={add}
            disabled={saving || !name.trim()}
            className="flex items-center justify-center gap-1 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">
          Enter a category name and optionally a material name. The material will be linked to this category.
        </p>
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-1.5 shadow-sm">
        <Search className="h-4 w-4 text-muted-foreground/70" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search categories…"
          className="bg-transparent text-sm outline-none w-full"
        />
      </div>

      {/* Categories list with materials */}
      {isLoading ? (
        <div className="rounded-xl border border-border bg-white p-12 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto" />
          <p className="text-sm text-muted-foreground mt-2">Loading…</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredCats.map((c, i) => {
            const catMats = materialsByCategory[c.id] || [];
            return (
              <div key={c.id} className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
                {/* Category header */}
                <div className="flex items-center justify-between px-4 py-3 hover:bg-secondary-soft/20">
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
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-muted-foreground/70 w-6">{i + 1}.</span>
                        <Tags className="h-4 w-4 text-primary" />
                        <span className="text-sm font-semibold text-foreground">{c.name}</span>
                        <span className="text-[10px] text-muted-foreground/50">/{c.slug}</span>
                        <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                          {catMats.length} material{catMats.length !== 1 ? "s" : ""}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => addMaterial(c.id, c.name)}
                          className="rounded p-1.5 hover:bg-primary/10 text-primary"
                          title="Add material"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
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

                {/* Materials under this category */}
                {catMats.length > 0 && (
                  <div className="border-t border-border bg-muted/20 px-4 py-2">
                    <div className="flex flex-wrap gap-1.5">
                      {catMats.map((m) => (
                        <div
                          key={m.id}
                          className="flex items-center gap-1 rounded-lg bg-white border border-border px-2.5 py-1 text-xs"
                        >
                          {editingMaterialId === m.id ? (
                            <>
                              <input
                                value={editMaterialName}
                                onChange={(e) => setEditMaterialName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") saveEditMaterial(m.id);
                                  if (e.key === "Escape") setEditingMaterialId(null);
                                }}
                                className="w-28 rounded border border-secondary px-1.5 py-0.5 text-xs outline-none"
                                autoFocus
                              />
                              <button onClick={() => saveEditMaterial(m.id)} className="text-emerald-600">
                                <Check className="h-3 w-3" />
                              </button>
                              <button onClick={() => setEditingMaterialId(null)} className="text-muted-foreground">
                                <X className="h-3 w-3" />
                              </button>
                            </>
                          ) : (
                            <>
                              <Layers className="h-3 w-3 text-primary/60" />
                              <span className="text-foreground font-medium">{m.name}</span>
                              <button
                                onClick={() => startEditMaterial(m.id, m.name)}
                                className="text-muted-foreground hover:text-primary ml-1"
                                title="Edit material"
                              >
                                <Edit3 className="h-3 w-3" />
                              </button>
                              <button
                                onClick={() => deleteMaterial(m.id)}
                                className="text-muted-foreground hover:text-rose-500"
                                title="Delete material"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {filteredCats.length === 0 && (
            <div className="rounded-xl border border-dashed border-border bg-white/50 py-12 text-center">
              <Tags className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">
                {search ? "No categories match your search." : "No categories yet — add one above"}
              </p>
            </div>
          )}
        </div>
      )}

      <div className="text-[11px] text-muted-foreground">
        Total: {cats?.length ?? 0} categories, {totalMaterials} materials
      </div>
    </div>
  );
}
