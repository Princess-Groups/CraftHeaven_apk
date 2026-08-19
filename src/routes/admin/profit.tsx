import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Percent, Banknote, Loader2 } from "lucide-react";

export const Route = createFileRoute("/admin/profit")({
  head: () => ({ meta: [{ title: "Profit Percentage — ACH Admin" }] }),
  component: ProfitDashboard,
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type RangeKey = "today" | "week" | "month" | "custom";

type OrderItemRow = {
  product_id: string;
  product_name: string;
  quantity: number;
  line_total: number;
  unit_price: number;
  products: { purchase_price: number | null } | null;
};

type OrderRow = {
  id: string;
  total: number;
  channel: "ONLINE" | "IN_STORE";
  status: string;
  created_at: string;
  delivery_fee: number;
  shipping_charges: number;
  gst_total: number;
  tax_type: string;
  order_items: OrderItemRow[];
};

type CalcRow = {
  order_id: string;
  purchase_amount: number;
  purchase_shipping: number;
  customer_delivery: number;
  gst_amount: number;
  loan_amount: number;
  loan_percent: number;
  loan_cost: number;
  total_cost: number;
  net_profit: number;
  profit_percent: number;
  revenue: number;
};

type Inputs = {
  purchase_amount: number;
  purchase_shipping: number;
  gst_amount: number;
  loan_amount: number;
  loan_percent: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfWeek(): Date {
  const d = startOfToday();
  // Monday as the first day of the week.
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d;
}

function startOfMonth(): Date {
  const d = startOfToday();
  d.setDate(1);
  return d;
}

// Same formula as the database RPC — used for instant client-side recalc.
function derive(inputs: Inputs, revenue: number, customerDelivery: number) {
  const loan_cost = round2(
    (Number(inputs.loan_amount || 0) * Number(inputs.loan_percent || 0)) / 100,
  );
  const total_cost = round2(
    Number(inputs.purchase_amount || 0) +
      Number(inputs.purchase_shipping || 0) +
      customerDelivery +
      Number(inputs.gst_amount || 0) +
      loan_cost,
  );
  const net_profit = round2(revenue - total_cost);
  const profit_percent = revenue !== 0 ? round2((net_profit * 100) / revenue) : 0;
  return { loan_cost, total_cost, net_profit, profit_percent };
}

function fmt(n: number): string {
  return "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function inpCls(extra?: string): string {
  return (
    "w-full rounded-lg border border-border bg-white px-2.5 py-1.5 text-sm outline-none focus:border-secondary " +
    (extra ?? "")
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
function ProfitDashboard() {
  const qc = useQueryClient();
  const [range, setRange] = useState<RangeKey>("week");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [settings, setSettings] = useState({ business_loan_amount: 0, loan_percent_default: 0 });
  const [savingSettings, setSavingSettings] = useState(false);

  // Editable values per order (only manual fields). Keyed by order id.
  const [inputs, setInputs] = useState<Record<string, Inputs>>({});
  const inputsRef = useRef(inputs);
  inputsRef.current = inputs;
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const { isAdmin } = Route.useRouteContext();

  // Date range --------------------------------------------------------------
  const { fromIso, toIso, label } = useMemo(() => {
    const now = startOfToday();
    let from: Date;
    let to = new Date();
    if (range === "today") {
      from = startOfToday();
    } else if (range === "week") {
      from = startOfWeek();
    } else if (range === "month") {
      from = startOfMonth();
    } else {
      // custom — fall back to all time when dates aren't provided.
      from = customFrom ? new Date(customFrom + "T00:00:00") : new Date(0);
      if (customTo) to = new Date(customTo + "T23:59:59.999");
    }
    return {
      fromIso: from.toISOString(),
      toIso: to.toISOString(),
      label:
        range === "today"
          ? "Today"
          : range === "week"
            ? "This Week"
            : range === "month"
              ? "This Month"
              : "Custom Range",
    };
  }, [range, customFrom, customTo]);

  // Queries -----------------------------------------------------------------
  const { data: orders, isFetching: ordersFetching } = useQuery({
    queryKey: ["profit-orders", fromIso, toIso],
    queryFn: async () => {
      const { data } = await supabase
        .from("orders")
        .select(
          "id,total,channel,status,created_at,delivery_fee,shipping_charges,gst_total,tax_type,order_items(product_id,product_name,quantity,line_total,unit_price,products(purchase_price))",
        )
        .gte("created_at", fromIso)
        .lte("created_at", toIso)
        .order("created_at", { ascending: false })
        .limit(200);
      return (data ?? []) as unknown as OrderRow[];
    },
  });

  const orderIds = useMemo(() => (orders ?? []).map((o) => o.id).filter(Boolean), [orders]);

  const { data: calcs } = useQuery({
    queryKey: ["profit-calcs", fromIso, toIso],
    queryFn: async () => {
      if (!orderIds.length) return [] as CalcRow[];
      const { data } = await supabase
        .from("order_profit_calculations")
        .select("*")
        .in("order_id", orderIds);
      return (data ?? []) as unknown as CalcRow[];
    },
    enabled: orderIds.length > 0,
  });

  // Global loan settings (pre-fill defaults for new/unsaved rows).
  useQuery({
    queryKey: ["profit-settings"],
    queryFn: async () => {
      const { data } = await supabase.rpc("get_profit_settings");
      const s =
        (data as unknown as {
          business_loan_amount?: number;
          loan_percent_default?: number;
        } | null) ?? null;
      if (s) {
        setSettings({
          business_loan_amount: Number(s.business_loan_amount ?? 0),
          loan_percent_default: Number(s.loan_percent_default ?? 0),
        });
      }
      return s;
    },
    staleTime: Infinity,
  });

  const calcByOrder = useMemo(() => {
    const m = new Map<string, CalcRow>();
    (calcs ?? []).forEach((c) => m.set(c.order_id, c));
    return m;
  }, [calcs]);

  // Build merged rows — saved value wins; otherwise sensible defaults.
  const rows = useMemo(() => {
    const byOrder = new Map<string, OrderRow>();
    (orders ?? []).forEach((o) => byOrder.set(o.id, o));
    return (orders ?? [])
      .filter((o) => o.status !== "CANCELLED")
      .map((o) => {
        const saved = calcByOrder.get(o.id);
        const defaultPurchase = (o.order_items ?? []).reduce(
          (s, it) => s + Number(it.products?.purchase_price ?? 0) * Number(it.quantity || 0),
          0,
        );
        const revenue = Number(o.total ?? 0);
        const customerDelivery = Number(o.delivery_fee ?? 0) + Number(o.shipping_charges ?? 0);
        const manual: Inputs = inputs[o.id] ?? {
          purchase_amount: saved ? Number(saved.purchase_amount) : round2(defaultPurchase),
          purchase_shipping: saved ? Number(saved.purchase_shipping) : 0,
          gst_amount: saved ? Number(saved.gst_amount) : Number(o.gst_total ?? 0),
          loan_amount: saved
            ? Number(saved.loan_amount)
            : Number(settings.business_loan_amount || 0),
          loan_percent: saved
            ? Number(saved.loan_percent)
            : Number(settings.loan_percent_default || 0),
        };
        const d = derive(manual, revenue, customerDelivery);
        return {
          order: o,
          revenue,
          customerDelivery,
          manual,
          d,
          saved,
        };
      });
  }, [orders, calcByOrder, inputs, settings]);

  // Totals across the filtered range -----------------------------------------
  const totals = useMemo(() => {
    let revenue = 0,
      purchase = 0,
      purchaseShipping = 0,
      delivery = 0,
      gst = 0,
      loan = 0,
      totalCost = 0,
      netProfit = 0;
    rows.forEach((r) => {
      revenue += r.revenue;
      purchase += Number(r.manual.purchase_amount || 0);
      purchaseShipping += Number(r.manual.purchase_shipping || 0);
      delivery += r.customerDelivery;
      gst += Number(r.manual.gst_amount || 0);
      loan += r.d.loan_cost;
      totalCost += r.d.total_cost;
      netProfit += r.d.net_profit;
    });
    const overallPct = revenue !== 0 ? round2((netProfit * 100) / revenue) : 0;
    return {
      revenue,
      purchase,
      purchaseShipping,
      delivery,
      gst,
      loan,
      totalCost,
      netProfit,
      overallPct,
    };
  }, [rows]);

  // Persistence — debounced upsert per order ---------------------------------
  function onEdit(orderId: string, field: keyof Inputs, raw: string) {
    const next = {
      ...(inputs[orderId] ?? inputsRef.current[orderId] ?? blankInputs()),
      [field]: Number(raw) || 0,
    };
    setInputs((prev) => ({ ...prev, [orderId]: next }));
    clearTimeout(timers.current[orderId]);
    timers.current[orderId] = setTimeout(() => saveRow(orderId), 700);
  }

  function blankInputs(): Inputs {
    return {
      purchase_amount: 0,
      purchase_shipping: 0,
      gst_amount: 0,
      loan_amount: 0,
      loan_percent: 0,
    };
  }

  async function saveRow(orderId: string) {
    const i = inputsRef.current[orderId] ?? blankInputs();
    const { data, error } = await supabase.rpc("upsert_order_profit_calculation", {
      _order_id: orderId,
      _purchase_amount: Number(i.purchase_amount) || 0,
      _purchase_shipping: Number(i.purchase_shipping) || 0,
      _gst_amount: Number(i.gst_amount) || 0,
      _loan_amount: Number(i.loan_amount) || 0,
      _loan_percent: Number(i.loan_percent) || 0,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    // Patch the calcs cache with the authoritative row returned by the RPC so
    // a refetch never renders a stale default over the edited value.
    const row = data as unknown as CalcRow;
    if (row?.order_id) {
      qc.setQueryData<CalcRow[]>(["profit-calcs", fromIso, toIso], (old) => {
        const rest = (old ?? []).filter((c) => c.order_id !== row.order_id);
        return [...rest, row];
      });
    }
  }

  async function saveSettings() {
    setSavingSettings(true);
    try {
      const { error } = await supabase.rpc("save_profit_settings", {
        _business_loan_amount: Number(settings.business_loan_amount) || 0,
        _loan_percent_default: Number(settings.loan_percent_default) || 0,
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Loan settings saved — new orders will pre-fill these defaults");
      qc.invalidateQueries({ queryKey: ["profit-settings"] });
    } finally {
      setSavingSettings(false);
    }
  }

  const card = [
    { label: "Total Revenue / Selling Amount", value: totals.revenue, tone: "" },
    { label: "Product Purchase Cost", value: totals.purchase, tone: "" },
    { label: "Purchase Shipping Cost", value: totals.purchaseShipping, tone: "" },
    { label: "Customer Delivery Cost", value: totals.delivery, tone: "" },
    { label: "GST Amount", value: totals.gst, tone: "" },
    { label: "Loan Cost", value: totals.loan, tone: "" },
    {
      label: "Total Cost / Deductions",
      value: totals.totalCost,
      tone: "text-rose-600",
    },
    {
      label: "Net Profit",
      value: totals.netProfit,
      tone: totals.netProfit >= 0 ? "text-emerald-600" : "text-rose-600",
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2 text-xl font-bold text-foreground">
          <Percent className="h-5 w-5 text-secondary" /> Profit Percentage
        </h1>
        <span className="rounded-full bg-secondary-soft px-3 py-1 text-[11px] font-semibold text-muted-foreground">
          {label}
          {ordersFetching ? " · loading…" : ""}
        </span>
      </div>

      {/* ================= Date filters ================= */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-border bg-white p-1">
          {(
            [
              ["today", "Today"],
              ["week", "This Week"],
              ["month", "This Month"],
              ["custom", "Custom"],
            ] as [RangeKey, string][]
          ).map(([k, lab]) => (
            <button
              key={k}
              onClick={() => setRange(k)}
              className={`px-4 py-1.5 text-xs font-semibold rounded ${range === k ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground"}`}
            >
              {lab}
            </button>
          ))}
        </div>
        {range === "custom" && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-white p-2">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="rounded border border-border px-2 py-1 text-xs"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="rounded border border-border px-2 py-1 text-xs"
            />
            <button
              onClick={() => setRange("custom")}
              className="rounded bg-primary px-3 py-1 text-xs font-semibold text-white"
            >
              Apply
            </button>
          </div>
        )}
      </div>

      {/* ================= Global loan settings (admin) ================= */}
      <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary-soft">
            <Banknote className="h-5 w-5 text-primary" />
          </div>
          <div className="mr-2 min-w-0 flex-1">
            <div className="text-sm font-bold text-foreground">Business Loan Settings</div>
            <div className="text-[11px] text-muted-foreground">
              Used to pre-fill each order's Loan Amount &amp; rate. Loan Cost = Loan Amount × %.
            </div>
          </div>
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold text-muted-foreground">
              Business Loan (₹)
            </span>
            <input
              type="number"
              min={0}
              value={settings.business_loan_amount}
              onChange={(e) =>
                setSettings((s) => ({ ...s, business_loan_amount: Number(e.target.value) || 0 }))
              }
              className={inpCls("w-36")}
              placeholder="e.g. 100000"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold text-muted-foreground">
              Loan / GST Rate (%)
            </span>
            <input
              type="number"
              min={0}
              step="0.01"
              value={settings.loan_percent_default}
              onChange={(e) =>
                setSettings((s) => ({ ...s, loan_percent_default: Number(e.target.value) || 0 }))
              }
              className={inpCls("w-28")}
              placeholder="e.g. 0.5"
            />
          </label>
          {isAdmin ? (
            <button
              onClick={saveSettings}
              disabled={savingSettings}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-60"
            >
              {savingSettings ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {savingSettings ? "Saving…" : "Save Defaults"}
            </button>
          ) : (
            <span className="rounded-lg border border-border bg-muted px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
              Read-only — admin sets loan defaults
            </span>
          )}
        </div>
      </div>

      {/* ================= Summary cards ================= */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {card.map((c) => (
          <div key={c.label} className="rounded-xl border border-border bg-white p-4 shadow-sm">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {c.label}
            </div>
            <div className={`mt-1 text-xl font-bold ${c.tone}`}>{fmt(c.value)}</div>
          </div>
        ))}
        <div className="rounded-xl border-2 border-secondary bg-secondary-soft/60 p-4 shadow-sm">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Overall Profit %
          </div>
          <div
            className={`mt-1 text-2xl font-extrabold ${
              totals.netProfit >= 0 ? "text-emerald-700" : "text-rose-600"
            }`}
          >
            {totals.overallPct.toFixed(2)}%
          </div>
        </div>
      </div>

      {/* ================= Order-wise profit table ================= */}
      <div className="overflow-x-auto rounded-xl border border-border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-muted text-[11px] uppercase text-muted-foreground">
            <tr>
              <th className="p-3 text-left">Order</th>
              <th className="p-3 text-left">Product</th>
              <th className="p-3 text-right">Selling Amt</th>
              <th className="p-3 text-right">Purchase Amt</th>
              <th className="p-3 text-right">Purchase Ship</th>
              <th className="p-3 text-right">Customer Delivery</th>
              <th className="p-3 text-right">GST</th>
              <th className="p-3 text-right">Loan Amt</th>
              <th className="p-3 text-right">Loan %</th>
              <th className="p-3 text-right">Loan Cost</th>
              <th className="p-3 text-right">Total Cost</th>
              <th className="p-3 text-right">Net Profit</th>
              <th className="p-3 text-right">Profit %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.order.id}
                className="border-t border-border align-middle hover:bg-muted/40"
              >
                <td className="p-3 font-mono text-xs whitespace-nowrap">
                  #{r.order.id.slice(0, 8).toUpperCase()}
                  <div className="text-[10px] text-muted-foreground">
                    {new Date(r.order.created_at).toLocaleDateString()}
                  </div>
                </td>
                <td className="p-3 max-w-[180px]">
                  <div className="truncate text-xs font-semibold text-foreground">
                    {productSummary(r.order)}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {r.order.channel === "IN_STORE" ? "POS" : "Online"} ·{" "}
                    {r.order.tax_type || "NONE"}
                  </div>
                </td>
                <td className="p-3 text-right font-semibold whitespace-nowrap">{fmt(r.revenue)}</td>
                <td className="p-3">
                  <Input
                    value={r.manual.purchase_amount}
                    onChange={(v) => onEdit(r.order.id, "purchase_amount", v)}
                    title="Product Purchase Amount"
                  />
                </td>
                <td className="p-3">
                  <Input
                    value={r.manual.purchase_shipping}
                    onChange={(v) => onEdit(r.order.id, "purchase_shipping", v)}
                    title="Purchase Shipping Cost"
                  />
                </td>
                <td className="p-3 text-right text-xs font-semibold whitespace-nowrap text-muted-foreground">
                  {fmt(r.customerDelivery)}
                  <div className="text-[9px] font-normal uppercase text-muted-foreground/60">
                    from app
                  </div>
                </td>
                <td className="p-3">
                  <Input
                    value={r.manual.gst_amount}
                    onChange={(v) => onEdit(r.order.id, "gst_amount", v)}
                    title="GST Amount (manual)"
                  />
                </td>
                <td className="p-3">
                  <Input
                    value={r.manual.loan_amount}
                    onChange={(v) => onEdit(r.order.id, "loan_amount", v)}
                    title="Loan Amount"
                  />
                </td>
                <td className="p-3">
                  <Input
                    value={r.manual.loan_percent}
                    onChange={(v) => onEdit(r.order.id, "loan_percent", v)}
                    title="Loan / GST %"
                  />
                </td>
                <td className="p-3 text-right text-xs whitespace-nowrap">{fmt(r.d.loan_cost)}</td>
                <td className="p-3 text-right font-semibold whitespace-nowrap">
                  {fmt(r.d.total_cost)}
                </td>
                <td
                  className={`p-3 text-right font-bold whitespace-nowrap ${
                    r.d.net_profit >= 0 ? "text-emerald-600" : "text-rose-600"
                  }`}
                >
                  {fmt(r.d.net_profit)}
                </td>
                <td className="p-3 text-right font-bold whitespace-nowrap">
                  {r.d.profit_percent.toFixed(2)}%
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={13} className="p-8 text-center text-xs text-muted-foreground/70">
                  No orders in this range yet — place a sale in Billing (POS) or await online
                  orders.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Net Profit = Selling Amount − (Product Purchase Amount + Purchase Shipping + Customer
        Delivery from App + GST + Loan Cost). Profit % = Net Profit ÷ Selling Amount × 100. The
        Customer Delivery amount syncs automatically from each order (delivery fee + shipping
        charges) and updates if the app changes it. Manual fields are saved automatically as you
        type (≈0.7s debounce) — no refresh needed.
      </p>
    </div>
  );
}

function productSummary(order: OrderRow): string {
  const items = order.order_items ?? [];
  if (!items.length) return "—";
  const first = items[0].product_name;
  return items.length > 1 ? `${first} +${items.length - 1}` : first;
}

function Input({
  value,
  onChange,
  title,
}: {
  value: number;
  onChange: (raw: string) => void;
  title: string;
}) {
  return (
    <input
      type="number"
      step="0.01"
      min="0"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title={title}
      className="w-24 rounded-lg border border-border bg-white px-2 py-1 text-right text-xs outline-none focus:border-secondary"
    />
  );
}
