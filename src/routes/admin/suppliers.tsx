import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useMemo } from "react";
import { Plus, Trash2, Search, Edit2, X, Loader2, Users, Download } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/suppliers")({
  head: () => ({ meta: [{ title: "Suppliers — ACH Admin" }] }),
  component: Suppliers,
});

type SupplierRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  address: string | null;
  notes: string | null;
  is_active: boolean | null;
  created_at: string;
};

function Suppliers() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    gstin: "",
    address: "",
    notes: "",
  });

  // Fetch suppliers
  const { data: suppliers, isLoading } = useQuery({
    queryKey: ["sup"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("*")
        .order("name");
      if (error) throw error;
      return (data ?? []) as SupplierRow[];
    },
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return suppliers ?? [];
    const q = search.toLowerCase();
    return (suppliers ?? []).filter(
      (s) =>
        s.name?.toLowerCase().includes(q) ||
        s.phone?.toLowerCase().includes(q) ||
        s.email?.toLowerCase().includes(q) ||
        s.gstin?.toLowerCase().includes(q),
    );
  }, [search, suppliers]);

  function resetForm() {
    setForm({ name: "", phone: "", email: "", gstin: "", address: "", notes: "" });
    setEditingId(null);
    setFormOpen(false);
  }

  function startEdit(s: SupplierRow) {
    setForm({
      name: s.name ?? "",
      phone: s.phone ?? "",
      email: s.email ?? "",
      gstin: s.gstin ?? "",
      address: s.address ?? "",
      notes: s.notes ?? "",
    });
    setEditingId(s.id);
    setFormOpen(true);
  }

  async function saveSupplier() {
    if (!form.name.trim()) return toast.error("Supplier name is required");
    // Check for duplicate (only when adding, not editing)
    if (!editingId) {
      const existing = (suppliers ?? []).find(
        (s) => s.name?.toLowerCase() === form.name.trim().toLowerCase()
      );
      if (existing) return toast.error("A supplier with this name already exists");
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        gstin: form.gstin.trim() || null,
        address: form.address.trim() || null,
        notes: form.notes.trim() || null,
      };

      if (editingId) {
        const { data, error } = await supabase.from("suppliers").update(payload).eq("id", editingId).select();
        if (error) {
          console.error("[Suppliers] Update error:", error);
          throw error;
        }
        if (!data || data.length === 0) {
          console.error("[Suppliers] Update returned no rows — possible RLS issue");
          throw new Error("Update failed — no rows affected. Check your permissions.");
        }
        toast.success("Supplier updated");
      } else {
        const { data, error } = await supabase.from("suppliers").insert(payload).select();
        if (error) {
          console.error("[Suppliers] Insert error:", error);
          throw error;
        }
        if (!data || data.length === 0) {
          console.error("[Suppliers] Insert returned no data — possible RLS issue");
          throw new Error("Insert failed — no data returned. Check your permissions.");
        }
        toast.success("Supplier added");
      }
      resetForm();
      qc.invalidateQueries({ queryKey: ["sup"] });
      qc.invalidateQueries({ queryKey: ["suppliers-lite"] });
    } catch (err) {
      console.error("[Suppliers] Save failed:", err);
      toast.error(err instanceof Error ? err.message : "Failed to save supplier");
    } finally {
      setSaving(false);
    }
  }

  async function deleteSupplier(id: string) {
    const { error } = await supabase.from("suppliers").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["sup"] });
    qc.invalidateQueries({ queryKey: ["suppliers-lite"] });
    toast.success("Supplier deleted");
  }

  function exportCSV() {
    const headers = ["S.No", "Name", "Phone", "Email", "GSTIN", "Address", "Notes"];
    const csvRows = filtered.map((s, i) => [
      i + 1, s.name, s.phone ?? "", s.email ?? "", s.gstin ?? "", s.address ?? "", s.notes ?? "",
    ]);
    const csv = [headers.join(","), ...csvRows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `suppliers-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Exported to CSV");
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          Supplier Management
        </h1>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-1.5 shadow-sm flex-1 max-w-sm">
          <Search className="h-4 w-4 text-muted-foreground/70" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search suppliers…"
            className="bg-transparent text-sm outline-none w-full"
          />
        </div>
        <button
          onClick={() => { resetForm(); setFormOpen(true); }}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary/90 transition"
        >
          <Plus className="h-3.5 w-3.5" /> Add Supplier
        </button>
        <button
          onClick={exportCSV}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-secondary-soft transition"
        >
          <Download className="h-3.5 w-3.5" /> Export CSV
        </button>
      </div>

      {/* Add/Edit Form */}
      {formOpen && (
        <div className="rounded-xl border-2 border-primary/30 bg-white shadow-card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-primary/5 border-b border-border">
            <h2 className="text-sm font-bold text-primary">
              {editingId ? "Edit Supplier" : "Add New Supplier"}
            </h2>
            <button onClick={resetForm} className="rounded-lg p-1 hover:bg-secondary-soft transition">
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {/* Supplier Name */}
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Supplier Name *</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. ABC Traders"
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
              </div>

              {/* Phone */}
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Contact Number</label>
                <input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="e.g. 9876543210"
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
              </div>

              {/* Email */}
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="e.g. abc@example.com"
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
              </div>

              {/* GSTIN */}
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">GST Number</label>
                <input
                  value={form.gstin}
                  onChange={(e) => setForm({ ...form, gstin: e.target.value })}
                  placeholder="e.g. 27AABCU9603R1ZM"
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
              </div>

              {/* Address */}
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Address</label>
                <input
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  placeholder="e.g. 123 Main St, City"
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
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
                onClick={saveSupplier}
                disabled={saving || !form.name.trim()}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50 transition"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                {saving ? "Saving…" : editingId ? "Update Supplier" : "Add Supplier"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Suppliers Table */}
      {isLoading ? (
        <div className="rounded-xl border border-border bg-white p-12 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto" />
          <p className="text-sm text-muted-foreground mt-2">Loading suppliers…</p>
        </div>
      ) : filtered.length > 0 ? (
        <div className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted text-[11px] uppercase text-muted-foreground">
              <tr>
                <th className="p-3 text-left w-10">#</th>
                <th className="p-3 text-left">Name</th>
                <th className="p-3 text-center">Phone</th>
                <th className="p-3 text-center">Email</th>
                <th className="p-3 text-center">GSTIN</th>
                <th className="p-3 text-left">Address</th>
                <th className="p-3 text-right w-20">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s, i) => (
                <tr key={s.id} className="border-t border-border hover:bg-secondary-soft/30 transition">
                  <td className="p-3 text-xs font-semibold text-muted-foreground">{i + 1}</td>
                  <td className="p-3 font-medium text-sm">{s.name}</td>
                  <td className="p-3 text-xs text-center">{s.phone ?? "—"}</td>
                  <td className="p-3 text-xs text-center">{s.email ?? "—"}</td>
                  <td className="p-3 text-xs text-center">{s.gstin ?? "—"}</td>
                  <td className="p-3 text-xs text-muted-foreground truncate max-w-[150px]">{s.address ?? "—"}</td>
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
                        onClick={() => deleteSupplier(s.id)}
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
          <Users className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            {search ? "No suppliers match your search." : "No suppliers added yet."}
          </p>
          {!search && (
            <p className="text-xs text-muted-foreground/70 mt-1">
              Click <strong>+ Add Supplier</strong> to create your first supplier.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
