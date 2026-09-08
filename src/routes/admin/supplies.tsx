import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useMemo } from "react";
import { Plus, Trash2, Search, Edit2, X, Loader2, Package } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/supplies")({
  head: () => ({ meta: [{ title: "Supplies — ACH Admin" }] }),
  component: Supplies,
});

type SupplyRow = {
  id: string;
  name: string;
  supplier_id: string | null;
  category: string | null;
  unit: string | null;
  rate: number | null;
  notes: string | null;
  is_active: boolean | null;
  created_at: string;
  // Joined supplier data
  suppliers?: { name: string; phone: string | null; gstin: string | null; address: string | null } | null;
};

const UNITS = ["Nos", "Kilogram", "Gram", "Liter", "ML", "Meter", "Centimeter", "Inch", "Packet", "Box", "Roll", "Sheet", "Pair", "Set"] as const;

function Supplies() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Supplier search for linking
  const [supplierSearch, setSupplierSearch] = useState("");
  const [supplierDropdownOpen, setSupplierDropdownOpen] = useState(false);

  const [form, setForm] = useState({
    name: "",
    supplier_id: "",
    supplier_name: "",
    category: "",
    unit: "Nos",
    rate: 0,
    notes: "",
  });

  // Fetch supplies with joined supplier data
  const { data: supplies, isLoading } = useQuery({
    queryKey: ["supplies"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("supplies")
        .select("*, suppliers(name, phone, gstin, address)")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as SupplyRow[];
    },
  });

  // Fetch suppliers for linking
  const { data: suppliers } = useQuery({
    queryKey: ["suppliers-lite"],
    queryFn: async () => (await supabase.from("suppliers").select("id,name").order("name")).data ?? [],
  });

  const filteredSuppliers = useMemo(() => {
    if (!supplierSearch.trim()) return suppliers ?? [];
    const q = supplierSearch.toLowerCase();
    return (suppliers ?? []).filter((s) => s.name?.toLowerCase().includes(q));
  }, [supplierSearch, suppliers]);

  const filtered = useMemo(() => {
    if (!search.trim()) return supplies ?? [];
    const q = search.toLowerCase();
    return (supplies ?? []).filter(
      (s) =>
        s.name?.toLowerCase().includes(q) ||
        s.category?.toLowerCase().includes(q) ||
        s.suppliers?.name?.toLowerCase().includes(q),
    );
  }, [search, supplies]);

  function resetForm() {
    setForm({ name: "", supplier_id: "", supplier_name: "", category: "", unit: "Nos", rate: 0, notes: "" });
    setEditingId(null);
    setFormOpen(false);
    setSupplierSearch("");
    setSupplierDropdownOpen(false);
  }

  function startEdit(s: SupplyRow) {
    setForm({
      name: s.name ?? "",
      supplier_id: s.supplier_id ?? "",
      supplier_name: s.suppliers?.name ?? "",
      category: s.category ?? "",
      unit: s.unit ?? "Nos",
      rate: s.rate ?? 0,
      notes: s.notes ?? "",
    });
    setEditingId(s.id);
    setFormOpen(true);
  }

  async function saveSupply() {
    if (!form.name.trim()) return toast.error("Supply name is required");
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        supplier_id: form.supplier_id || null,
        category: form.category.trim() || null,
        unit: form.unit,
        rate: Number(form.rate) || 0,
        notes: form.notes.trim() || null,
        is_active: true,
      };

      if (editingId) {
        const { error } = await supabase.from("supplies").update(payload).eq("id", editingId);
        if (error) throw error;
        toast.success("Supply updated");
      } else {
        const { error } = await supabase.from("supplies").insert(payload);
        if (error) throw error;
        toast.success("Supply added");
      }
      resetForm();
      qc.invalidateQueries({ queryKey: ["supplies"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function deleteSupply(id: string) {
    const { error } = await supabase.from("supplies").update({ is_active: false }).eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["supplies"] });
    toast.success("Supply removed");
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Package className="h-5 w-5 text-primary" />
          Supplies Master
        </h1>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-1.5 shadow-sm flex-1 max-w-sm">
          <Search className="h-4 w-4 text-muted-foreground/70" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search supplies…"
            className="bg-transparent text-sm outline-none w-full"
          />
        </div>
        <button
          onClick={() => { resetForm(); setFormOpen(true); }}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary/90 transition"
        >
          <Plus className="h-3.5 w-3.5" /> Add Supply
        </button>
      </div>

      {/* Add/Edit Form */}
      {formOpen && (
        <div className="rounded-xl border-2 border-primary/30 bg-white shadow-card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-primary/5 border-b border-border">
            <h2 className="text-sm font-bold text-primary">
              {editingId ? "Edit Supply" : "Add New Supply"}
            </h2>
            <button onClick={resetForm} className="rounded-lg p-1 hover:bg-secondary-soft transition">
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {/* Supply Name */}
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Supply Name *</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Glue, A4 Sheet, Ribbon"
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
              </div>

              {/* Supplier (searchable) */}
              <div className="space-y-1 relative">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Supplier Name</label>
                <input
                  value={form.supplier_name}
                  onChange={(e) => {
                    setForm({ ...form, supplier_name: e.target.value, supplier_id: "" });
                    setSupplierSearch(e.target.value);
                    setSupplierDropdownOpen(true);
                  }}
                  onFocus={() => setSupplierDropdownOpen(true)}
                  placeholder="Type to search supplier…"
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  autoComplete="off"
                />
                {supplierDropdownOpen && filteredSuppliers.length > 0 && (
                  <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-white shadow-lg max-h-48 overflow-y-auto">
                    {filteredSuppliers.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setForm({ ...form, supplier_id: s.id, supplier_name: s.name });
                          setSupplierDropdownOpen(false);
                        }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-secondary-soft transition"
                      >
                        {s.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Category */}
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Supply Category</label>
                <input
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  placeholder="e.g. Stationery, Packing, Craft"
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
              </div>

              {/* Unit */}
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Unit</label>
                <select
                  value={form.unit}
                  onChange={(e) => setForm({ ...form, unit: e.target.value })}
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                >
                  {UNITS.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </div>

              {/* Rate */}
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Purchase Rate (₹)</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.rate || ""}
                  onChange={(e) => setForm({ ...form, rate: Number(e.target.value) || 0 })}
                  placeholder="0.00"
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary text-right"
                />
              </div>

              {/* Notes */}
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Notes</label>
                <input
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Optional notes"
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
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
                onClick={saveSupply}
                disabled={saving || !form.name.trim()}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50 transition"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                {saving ? "Saving…" : editingId ? "Update Supply" : "Add Supply"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Supplies Table */}
      {isLoading ? (
        <div className="rounded-xl border border-border bg-white p-12 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto" />
          <p className="text-sm text-muted-foreground mt-2">Loading supplies…</p>
        </div>
      ) : filtered.length > 0 ? (
        <div className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted text-[11px] uppercase text-muted-foreground">
              <tr>
                <th className="p-3 text-left w-10">#</th>
                <th className="p-3 text-left">Supply Name</th>
                <th className="p-3 text-left">Supplier</th>
                <th className="p-3 text-left">Category</th>
                <th className="p-3 text-center">Unit</th>
                <th className="p-3 text-right">Rate (₹)</th>
                <th className="p-3 text-left">Notes</th>
                <th className="p-3 text-right w-20">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s, i) => (
                <tr key={s.id} className="border-t border-border hover:bg-secondary-soft/30 transition">
                  <td className="p-3 text-xs font-semibold text-muted-foreground">{i + 1}</td>
                  <td className="p-3 font-medium text-sm">{s.name}</td>
                  <td className="p-3 text-xs text-muted-foreground">{s.suppliers?.name ?? "—"}</td>
                  <td className="p-3 text-xs text-muted-foreground">{s.category ?? "—"}</td>
                  <td className="p-3 text-xs text-center">{s.unit ?? "Nos"}</td>
                  <td className="p-3 text-xs text-right font-semibold">{s.rate ? `₹${s.rate}` : "—"}</td>
                  <td className="p-3 text-xs text-muted-foreground truncate max-w-[150px]">{s.notes ?? "—"}</td>
                  <td className="p-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => startEdit(s)}
                        className="rounded p-1 hover:bg-primary/10 transition"
                        title="Edit"
                      >
                        <Edit2 className="h-3.5 w-3.5 text-primary" />
                      </button>
                      <button
                        onClick={() => deleteSupply(s.id)}
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
          <Package className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            {search ? "No supplies match your search." : "No supplies added yet."}
          </p>
          {!search && (
            <p className="text-xs text-muted-foreground/70 mt-1">
              Click <strong>+ Add Supply</strong> to create your first supply record.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
