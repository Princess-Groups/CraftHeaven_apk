import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useMemo } from "react";
import { Plus, Trash2, Search, Edit2, X, Loader2, Box, Calculator } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/slots")({
  head: () => ({ meta: [{ title: "Slot Management — ACH Admin" }] }),
  component: Slots,
});

type SlotRow = {
  id: string;
  name: string;
  total_charges: number | null;
  packing_charges: number | null;
  freight_charges: number | null;
  other_charges: number | null;
  total_quantity: number | null;
  notes: string | null;
  is_active: boolean | null;
  created_at: string;
};

function Slots() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: "",
    total_charges: 0,
    packing_charges: 0,
    freight_charges: 0,
    other_charges: 0,
    total_quantity: 0,
    notes: "",
  });

  // Fetch slots
  const { data: slots, isLoading } = useQuery({
    queryKey: ["slots"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("slots")
        .select("*")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as SlotRow[];
    },
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return slots ?? [];
    const q = search.toLowerCase();
    return (slots ?? []).filter(
      (s) =>
        s.name?.toLowerCase().includes(q) ||
        s.notes?.toLowerCase().includes(q),
    );
  }, [search, slots]);

  function resetForm() {
    setForm({ name: "", total_charges: 0, packing_charges: 0, freight_charges: 0, other_charges: 0, total_quantity: 0, notes: "" });
    setEditingId(null);
    setFormOpen(false);
  }

  function startEdit(s: SlotRow) {
    setForm({
      name: s.name ?? "",
      total_charges: s.total_charges ?? 0,
      packing_charges: s.packing_charges ?? 0,
      freight_charges: s.freight_charges ?? 0,
      other_charges: s.other_charges ?? 0,
      total_quantity: s.total_quantity ?? 0,
      notes: s.notes ?? "",
    });
    setEditingId(s.id);
    setFormOpen(true);
  }

  // Calculate per-unit charge
  const perUnitCharge = useMemo(() => {
    const totalCharges = (Number(form.packing_charges) || 0) + (Number(form.freight_charges) || 0) + (Number(form.other_charges) || 0);
    const qty = Number(form.total_quantity) || 0;
    return qty > 0 ? Math.round((totalCharges / qty) * 100) / 100 : 0;
  }, [form.packing_charges, form.freight_charges, form.other_charges, form.total_quantity]);

  async function saveSlot() {
    if (!form.name.trim()) return toast.error("Slot name is required");
    setSaving(true);
    try {
      const totalCharges = (Number(form.packing_charges) || 0) + (Number(form.freight_charges) || 0) + (Number(form.other_charges) || 0);
      const payload = {
        name: form.name.trim(),
        total_charges: totalCharges,
        packing_charges: Number(form.packing_charges) || 0,
        freight_charges: Number(form.freight_charges) || 0,
        other_charges: Number(form.other_charges) || 0,
        total_quantity: Number(form.total_quantity) || 0,
        notes: form.notes.trim() || null,
        is_active: true,
      };

      if (editingId) {
        const { error } = await supabase.from("slots").update(payload).eq("id", editingId);
        if (error) throw error;
        toast.success("Slot updated");
      } else {
        const { error } = await supabase.from("slots").insert(payload);
        if (error) throw error;
        toast.success("Slot created");
      }
      resetForm();
      qc.invalidateQueries({ queryKey: ["slots"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function deleteSlot(id: string) {
    const { error } = await supabase.from("slots").update({ is_active: false }).eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["slots"] });
    toast.success("Slot removed");
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Box className="h-5 w-5 text-primary" />
          Slot & Purchase Charges
        </h1>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-1.5 shadow-sm flex-1 max-w-sm">
          <Search className="h-4 w-4 text-muted-foreground/70" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search slots…"
            className="bg-transparent text-sm outline-none w-full"
          />
        </div>
        <button
          onClick={() => { resetForm(); setFormOpen(true); }}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary/90 transition"
        >
          <Plus className="h-3.5 w-3.5" /> Add Slot
        </button>
      </div>

      {/* Add/Edit Form */}
      {formOpen && (
        <div className="rounded-xl border-2 border-primary/30 bg-white shadow-card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-primary/5 border-b border-border">
            <h2 className="text-sm font-bold text-primary">
              {editingId ? "Edit Slot" : "Add New Slot"}
            </h2>
            <button onClick={resetForm} className="rounded-lg p-1 hover:bg-secondary-soft transition">
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {/* Slot Name */}
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Slot Name *</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Slot 1, Slot A"
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
              </div>

              {/* Total Quantity */}
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Total Quantity (units)</label>
                <input
                  type="number"
                  min={0}
                  value={form.total_quantity || ""}
                  onChange={(e) => setForm({ ...form, total_quantity: Number(e.target.value) || 0 })}
                  placeholder="e.g. 3000"
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary text-right"
                />
              </div>

              {/* Spacer */}
              <div></div>

              {/* Packing Charges */}
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Packing Charges (₹)</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.packing_charges || ""}
                  onChange={(e) => setForm({ ...form, packing_charges: Number(e.target.value) || 0 })}
                  placeholder="0.00"
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary text-right"
                />
              </div>

              {/* Freight Charges */}
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Freight / Purchase Charges (₹)</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.freight_charges || ""}
                  onChange={(e) => setForm({ ...form, freight_charges: Number(e.target.value) || 0 })}
                  placeholder="0.00"
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary text-right"
                />
              </div>

              {/* Other Charges */}
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Other Charges (₹)</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.other_charges || ""}
                  onChange={(e) => setForm({ ...form, other_charges: Number(e.target.value) || 0 })}
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

            {/* Auto-calculation display */}
            <div className="mt-4 p-3 rounded-lg bg-primary/5 border border-primary/20">
              <div className="flex items-center gap-2 mb-2">
                <Calculator className="h-4 w-4 text-primary" />
                <span className="text-xs font-bold text-primary uppercase">Auto Calculation</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-[10px] text-muted-foreground uppercase">Total Charges</span>
                  <div className="font-bold text-foreground">
                    ₹{((Number(form.packing_charges) || 0) + (Number(form.freight_charges) || 0) + (Number(form.other_charges) || 0)).toFixed(2)}
                  </div>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground uppercase">Total Quantity</span>
                  <div className="font-bold text-foreground">{Number(form.total_quantity) || 0} units</div>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground uppercase">Per Unit Charge</span>
                  <div className="font-bold text-primary text-lg">₹{perUnitCharge.toFixed(2)}</div>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground uppercase">Formula</span>
                  <div className="text-xs text-muted-foreground">
                    ₹{((Number(form.packing_charges) || 0) + (Number(form.freight_charges) || 0) + (Number(form.other_charges) || 0)).toFixed(2)} ÷ {Number(form.total_quantity) || 0} = ₹{perUnitCharge.toFixed(2)}/unit
                  </div>
                </div>
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
                onClick={saveSlot}
                disabled={saving || !form.name.trim()}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50 transition"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                {saving ? "Saving…" : editingId ? "Update Slot" : "Add Slot"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Slots Table */}
      {isLoading ? (
        <div className="rounded-xl border border-border bg-white p-12 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto" />
          <p className="text-sm text-muted-foreground mt-2">Loading slots…</p>
        </div>
      ) : filtered.length > 0 ? (
        <div className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted text-[11px] uppercase text-muted-foreground">
              <tr>
                <th className="p-3 text-left w-10">#</th>
                <th className="p-3 text-left">Slot Name</th>
                <th className="p-3 text-right">Packing (₹)</th>
                <th className="p-3 text-right">Freight (₹)</th>
                <th className="p-3 text-right">Other (₹)</th>
                <th className="p-3 text-right">Total (₹)</th>
                <th className="p-3 text-center">Quantity</th>
                <th className="p-3 text-right">Per Unit (₹)</th>
                <th className="p-3 text-right w-20">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s, i) => {
                const totalCharges = (s.packing_charges ?? 0) + (s.freight_charges ?? 0) + (s.other_charges ?? 0);
                const qty = s.total_quantity ?? 0;
                const perUnit = qty > 0 ? Math.round((totalCharges / qty) * 100) / 100 : 0;
                return (
                  <tr key={s.id} className="border-t border-border hover:bg-secondary-soft/30 transition">
                    <td className="p-3 text-xs font-semibold text-muted-foreground">{i + 1}</td>
                    <td className="p-3 font-medium text-sm">{s.name}</td>
                    <td className="p-3 text-xs text-right">{(s.packing_charges ?? 0).toFixed(2)}</td>
                    <td className="p-3 text-xs text-right">{(s.freight_charges ?? 0).toFixed(2)}</td>
                    <td className="p-3 text-xs text-right">{(s.other_charges ?? 0).toFixed(2)}</td>
                    <td className="p-3 text-xs text-right font-semibold">{totalCharges.toFixed(2)}</td>
                    <td className="p-3 text-xs text-center">{qty}</td>
                    <td className="p-3 text-xs text-right font-bold text-primary">₹{perUnit.toFixed(2)}</td>
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
                          onClick={() => deleteSlot(s.id)}
                          className="rounded p-1 hover:bg-rose-50 transition"
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-white/50 py-12 text-center">
          <Box className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            {search ? "No slots match your search." : "No slots created yet."}
          </p>
          {!search && (
            <p className="text-xs text-muted-foreground/70 mt-1">
              Click <strong>+ Add Slot</strong> to create your first slot.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
