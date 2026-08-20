import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { BadgePercent, Banknote, CheckCircle2, Loader2 } from "lucide-react";
import { UPIS_APPS, orderRef, launchUpiApp, type UpiParams } from "@/lib/upi";
import {
  initiateGatewayPayment,
  initiateCashfreePayment,
  getCashfreeMode,
} from "@/lib/payment.functions";
import { notifyOrderWhatsApp } from "@/lib/whatsapp";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/checkout")({
  component: CheckoutPage,
  // Gateway return: ?orderId=...&status=SUCCESS|FAILED|... (picked up after
  // the customer is redirected back from the bank's hosted page).
  // The fields are optional so plain links to /checkout keep working.
  validateSearch: (s: Record<string, unknown>): { orderId?: string; pgStatus?: string } => ({
    ...(typeof s.orderId === "string" && s.orderId ? { orderId: s.orderId } : {}),
    ...(typeof s.status === "string" && s.status ? { pgStatus: s.status } : {}),
  }),
});

// The merchant UPI ID for Athira's Creative Haven.
const MERCHANT_VPA = "pvsdocuments-7@okaxis";
const MERCHANT_NAME = "Athira's Creative Haven";
// Customer's UPI QR code (also encoded in the deep-links below).
const MERCHANT_QR = "/upi-qr.jpeg";

const COUPONS: Record<string, { pct: number }> = {
  BLOOM20: { pct: 20 },
  CRAFT10: { pct: 10 },
};

// Loads the Cashfree JS SDK once and runs the hosted checkout.
// `mode` must match the environment we created the order in (sandbox/production).
let cashfreeSdkPromise: Promise<void> | null = null;
function loadCashfreeSdk(mode: "sandbox" | "production"): Promise<void> {
  if (!cashfreeSdkPromise) {
    cashfreeSdkPromise = new Promise((resolve, reject) => {
      if (typeof window === "undefined") return resolve();
      if ((window as any).Cashfree) return resolve();
      const s = document.createElement("script");
      s.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Could not load the payment page"));
      document.head.appendChild(s);
    });
  }
  return cashfreeSdkPromise;
}

async function runCashfreeCheckout(orderId: string, paymentSessionId: string) {
  const mode = (await getCashfreeMode().catch(() => "sandbox")) as "sandbox" | "production";
  await loadCashfreeSdk(mode);
  const CashfreeCtor = (window as any).Cashfree;
  if (!CashfreeCtor) throw new Error("Payment page is unavailable");
  const cashfree = new CashfreeCtor({ mode });
  const result = await cashfree.checkout({ paymentSessionId });
  // `result` shape: { redirect: boolean, paymentDetails?: { payment_status } }
  const status = String(
    result?.paymentDetails?.payment_status ??
      result?.order?.order_status ??
      (result?.redirect === false ? "" : ""),
  ).toUpperCase();
  // If the SDK reports success, ensure the order is marked paid before moving on.
  if (status === "PAID" || status === "COMPLETE" || status === "SUCCESS") {
    return status;
  }
  return status || "PENDING";
}

type PayStep =
  | { step: "idle" }
  | { step: "placing" }
  | { step: "pay"; orderId: string; amount: number }
  | { step: "redirecting"; orderId: string; amount: number }
  | { step: "confirming"; orderId: string }
  | { step: "done"; orderId: string };

function CheckoutPage() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [deliveryType, setDeliveryType] = useState<"DELIVERY" | "PICKUP">("DELIVERY");
  const [paymentMethod, setPaymentMethod] = useState<"ONLINE" | "COD">("ONLINE");
  const [addressId, setAddressId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [coupon, setCoupon] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>(null);
  const [payStep, setPayStep] = useState<PayStep>({ step: "idle" });

  const { data: items } = useQuery({
    queryKey: ["cart", user.id],
    queryFn: async () =>
      (
        await supabase
          .from("carts")
          .select("id, quantity, product:products(*)")
          .eq("user_id", user.id)
      ).data ?? [],
  });
  const { data: addresses } = useQuery({
    queryKey: ["addresses", user.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("addresses")
        .select("*")
        .eq("user_id", user.id)
        .order("is_default", { ascending: false });
      if (data && data.length && !addressId) setAddressId(data[0].id);
      return data ?? [];
    },
  });

  const subtotal = (items ?? []).reduce(
    (s, it: any) => s + Number(it.product?.discount_price ?? it.product?.price) * it.quantity,
    0,
  );
  const deliveryFee = deliveryType === "DELIVERY" ? 40 : 0;
  const discount = appliedCoupon
    ? Math.round(subtotal * (COUPONS[appliedCoupon]?.pct ?? 0)) / 100
    : 0;
  const total = Math.max(0, subtotal - discount) + deliveryFee;

  const addAddress = useMutation({
    mutationFn: async (fd: FormData) => {
      const { data, error } = await supabase
        .from("addresses")
        .insert({
          user_id: user.id,
          full_name: String(fd.get("full_name")),
          phone: String(fd.get("phone")),
          line1: String(fd.get("line1")),
          line2: String(fd.get("line2") || ""),
          city: String(fd.get("city")),
          state: String(fd.get("state")),
          pincode: String(fd.get("pincode")),
          is_default: !addresses?.length,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (d) => {
      setAddressId(d.id);
      setShowAddForm(false);
      qc.invalidateQueries({ queryKey: ["addresses"] });
    },
  });

  const applyCoupon = () => {
    const code = coupon.trim().toUpperCase();
    if (!code) return toast.error("Enter a coupon code");
    if (!COUPONS[code]) return toast.error("That coupon isn't valid");
    setAppliedCoupon(code);
    setCoupon("");
    toast.success(`${code} applied — ${COUPONS[code].pct}% off`);
  };

  const placeOrder = useMutation({
    mutationFn: async () => {
      if (deliveryType === "DELIVERY" && !addressId)
        throw new Error("Please add a delivery address");
      const payload = (items ?? []).map((it: any) => ({
        product_id: it.product.id,
        quantity: Number(it.quantity),
      }));
      const args: any = {
        _channel: "ONLINE",
        _payment_method: paymentMethod,
        _delivery_type: deliveryType,
        _address_id: deliveryType === "DELIVERY" ? addressId : null,
        _items: payload,
        _notes: appliedCoupon ? `Coupon ${appliedCoupon}` : null,
        _discount: discount,
      };
      const { data, error } = await supabase.rpc("place_order", args);
      if (error) throw error;
      return data as unknown as string;
    },
    onSuccess: (orderId) => {
      qc.invalidateQueries();
      // Fire-and-forget WhatsApp notification (no-ops when WhatsApp isn't configured).
      notifyOrderWhatsApp({ data: { orderId } }).catch(() => {});
      if (paymentMethod === "ONLINE") {
        const amount = subtotal - discount + deliveryFee;
        setPayStep({ step: "redirecting", orderId, amount });
        // Cashfree is the completed online gateway; IndusInd is kept as a
        // fallback for either gateway being temporarily unavailable.
        cashfreePayment.mutate({ orderId, amount });
      } else {
        toast.success("Order placed — pay on delivery");
        navigate({ to: "/orders/$id", params: { id: orderId } });
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const confirmPayment = useMutation({
    mutationFn: async ({ orderId, utr }: { orderId: string; utr: string }) => {
      // Route through a typed RPC — a direct .update() would send the enum value
      // as text and fail ("payment_status is of type payment_status but expression
      // is of type text").
      const { error } = await supabase.rpc("confirm_upi_payment", {
        _order_id: orderId,
        _utr: utr,
      });
      if (error) throw error;
      return orderId;
    },
    onSuccess: (orderId) => {
      toast.success("Payment confirmed!");
      qc.invalidateQueries();
      setPayStep({ step: "done", orderId });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const gatewayPayment = useMutation({
    mutationFn: async ({ orderId, amount }: { orderId: string; amount: number }) => {
      const { redirectUrl } = await initiateGatewayPayment({
        data: { orderId, amount },
      });
      return redirectUrl;
    },
    onSuccess: (redirectUrl) => {
      window.location.href = redirectUrl;
    },
    onError: (e: Error) => {
      toast.error(`${e.message}. You can still pay via UPI instead.`);
      // Fall back to the manual UPI flow if the gateway can't start the session.
      setPayStep((prev) =>
        prev.step === "redirecting"
          ? { step: "pay", orderId: prev.orderId, amount: prev.amount }
          : prev,
      );
    },
  });

  // Cashfree hosted checkout — creates the order server-side, then hands the
  // payment_session_id to the Cashfree JS SDK which opens the secure page.
  const cashfreePayment = useMutation({
    mutationFn: async ({ orderId, amount }: { orderId: string; amount: number }) => {
      const { paymentSessionId } = await initiateCashfreePayment({
        data: { orderId, amount },
      });
      return { orderId, paymentSessionId };
    },
    onSuccess: async ({ orderId, paymentSessionId }) => {
      const status = await runCashfreeCheckout(orderId, paymentSessionId);
      qc.invalidateQueries();
      if (status === "PAID" || status === "COMPLETE" || status === "SUCCESS") {
        toast.success("Payment successful!");
        setPayStep({ step: "done", orderId });
      } else {
        toast.error(
          status === ""
            ? "Payment was not completed. You can pay via UPI instead."
            : `Payment ${status.toLowerCase()} — you can pay via UPI instead.`,
        );
        setPayStep((prev) =>
          prev.step === "redirecting"
            ? { step: "pay", orderId: prev.orderId, amount: prev.amount }
            : prev,
        );
      }
    },
    onError: (e: Error) => {
      toast.error(`${e.message}. You can still pay via UPI instead.`);
      setPayStep((prev) =>
        prev.step === "redirecting"
          ? { step: "pay", orderId: prev.orderId, amount: prev.amount }
          : prev,
      );
    },
  });

  const search = Route.useSearch();
  const gatewayReturn = search.orderId ? (
    <div className="mx-auto max-w-md px-4 py-16 text-center">
      {search.pgStatus?.toUpperCase() === "SUCCESS" ? (
        <>
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-secondary-soft">
            <CheckCircle2 className="h-8 w-8 text-success" />
          </div>
          <h1 className="mt-4 font-display text-2xl">Payment successful!</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your payment was confirmed. We're packing your craft supplies.
          </p>
          <Button asChild className="mt-6 rounded-full">
            <Link to="/orders/$id" params={{ id: search.orderId }}>
              Track order
            </Link>
          </Button>
        </>
      ) : (
        <>
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-destructive/10">
            <Banknote className="h-8 w-8 text-destructive" />
          </div>
          <h1 className="mt-4 font-display text-2xl">
            Payment {search.pgStatus ? "failed" : "unconfirmed"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            If your money was debited it will be refunded automatically. Check your order for the
            latest status.
          </p>
          <Button asChild className="mt-6 rounded-full">
            <Link to="/orders/$id" params={{ id: search.orderId }}>
              View order
            </Link>
          </Button>
        </>
      )}
    </div>
  ) : null;
  if (gatewayReturn) return gatewayReturn;

  if (payStep.step === "redirecting") {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-secondary" />
        <p className="mt-4 text-sm text-muted-foreground">
          Taking you to the bank's secure payment page…
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          If nothing happens, tap Cancel below to pay via UPI instead.
        </p>
        <button
          onClick={() => {
            gatewayPayment.reset();
            setPayStep({ step: "pay", orderId: payStep.orderId, amount: payStep.amount });
          }}
          className="mt-4 text-xs text-muted-foreground hover:underline"
        >
          Cancel
        </button>
      </div>
    );
  }

  if (payStep.step === "pay") {
    const params: UpiParams = {
      vpa: MERCHANT_VPA,
      name: MERCHANT_NAME,
      amount: payStep.amount,
      note: `Order ${orderRef(payStep.orderId)}`,
    };
    return (
      <div className="mx-auto max-w-md px-4 py-8">
        <div className="rounded-3xl border border-border/60 bg-card p-6 text-center shadow-card">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-secondary-soft">
            <Banknote className="h-7 w-7 text-secondary-foreground" />
          </div>
          <h1 className="mt-4 font-display text-2xl">Pay ₹{payStep.amount.toFixed(0)}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Order {orderRef(payStep.orderId)}</p>

          <div className="mt-6 space-y-2.5 text-left">
            <div className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Choose a UPI app
            </div>
            {UPIS_APPS.map((app) => (
              <button
                key={app.id}
                onClick={() => launchUpiApp(app, params)}
                className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-3 shadow-card transition hover:border-primary"
              >
                <span
                  className={cn(
                    "grid h-10 w-10 place-items-center rounded-full font-bold text-white",
                    app.color,
                  )}
                >
                  {app.name[0]}
                </span>
                <span className="font-medium">{app.name}</span>
                <span className="ml-auto text-xs text-muted-foreground">Open →</span>
              </button>
            ))}
          </div>

          <div className="mt-6 rounded-2xl border border-border/60 bg-card p-4 shadow-card">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Scan to pay
            </div>
            <img
              src={MERCHANT_QR}
              alt="UPI QR code"
              className="mx-auto mt-3 h-44 w-44 rounded-xl border border-border object-cover"
            />
            <div className="mt-3 text-xs text-muted-foreground">
              Or pay UPI ID:{" "}
              <span className="font-mono font-medium text-foreground">{MERCHANT_VPA}</span>
            </div>
          </div>

          <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
            After paying, return to this screen and tap “I've paid” to finish your order.
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const utr = String(fd.get("utr") || "").trim();
              if (!utr)
                return toast.error("Enter the 12-digit UTR / transaction ID from your UPI app");
              setPayStep({ step: "confirming", orderId: payStep.orderId });
              confirmPayment.mutate({ orderId: payStep.orderId, utr });
            }}
            className="mt-6 space-y-3"
          >
            <div className="text-left">
              <Label>UTR / Transaction ID</Label>
              <Input name="utr" placeholder="e.g. 412345678901" className="mt-1" />
            </div>
            <Button
              type="submit"
              className="w-full rounded-full"
              disabled={confirmPayment.isPending}
            >
              {confirmPayment.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Confirming…
                </>
              ) : (
                "I've paid — confirm"
              )}
            </Button>
          </form>

          <button
            onClick={() => setPayStep({ step: "idle" })}
            className="mt-3 text-xs text-muted-foreground hover:underline"
          >
            Payment failed? Cancel this order
          </button>
        </div>
      </div>
    );
  }

  if (payStep.step === "confirming") {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-secondary" />
        <p className="mt-4 text-sm text-muted-foreground">Confirming your payment…</p>
      </div>
    );
  }

  if (payStep.step === "done") {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-secondary-soft">
          <CheckCircle2 className="h-8 w-8 text-success" />
        </div>
        <h1 className="mt-4 font-display text-2xl">Order placed!</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Payment confirmed. We're packing your craft supplies.
        </p>
        <Button asChild className="mt-6 rounded-full">
          <Link to="/orders/$id" params={{ id: payStep.orderId }}>
            Track order
          </Link>
        </Button>
      </div>
    );
  }

  if (!items?.length)
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="font-display text-2xl">Nothing to checkout</h1>
        <Button asChild className="mt-4 rounded-full">
          <Link to="/">Continue shopping</Link>
        </Button>
      </div>
    );

  return (
    <div className="mx-auto grid max-w-5xl gap-8 px-4 py-8 md:grid-cols-[1fr_340px]">
      <div className="space-y-6">
        <h1 className="font-display text-2xl">Checkout</h1>

        <Card className="rounded-2xl p-5">
          <h2 className="font-display text-lg">Delivery</h2>
          <RadioGroup
            value={deliveryType}
            onValueChange={(v) => setDeliveryType(v as any)}
            className="mt-3"
          >
            <label className="flex items-center gap-3 rounded-xl border border-border p-3 cursor-pointer has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
              <RadioGroupItem value="DELIVERY" /> <span className="font-medium">Home delivery</span>
              <span className="ml-auto text-sm text-muted-foreground">₹40</span>
            </label>
            <label className="flex items-center gap-3 rounded-xl border border-border p-3 cursor-pointer has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
              <RadioGroupItem value="PICKUP" /> <span className="font-medium">Store pickup</span>
              <span className="ml-auto text-sm text-success">Free</span>
            </label>
          </RadioGroup>

          {deliveryType === "DELIVERY" ? (
            <div className="mt-4 space-y-2">
              {addresses?.map((a) => (
                <label
                  key={a.id}
                  className="flex gap-3 rounded-xl border border-border p-3 cursor-pointer has-[:checked]:border-primary has-[:checked]:bg-primary-soft"
                >
                  <input
                    type="radio"
                    name="addr"
                    checked={addressId === a.id}
                    onChange={() => setAddressId(a.id)}
                    className="mt-1"
                  />
                  <div className="text-sm">
                    <div className="font-medium">
                      {a.full_name} · {a.phone}
                    </div>
                    <div className="text-muted-foreground">
                      {a.line1}
                      {a.line2 ? `, ${a.line2}` : ""}, {a.city}, {a.state} {a.pincode}
                    </div>
                  </div>
                </label>
              ))}
              {showAddForm ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    addAddress.mutate(new FormData(e.currentTarget));
                  }}
                  className="grid grid-cols-2 gap-2 rounded-xl border border-dashed border-border p-3"
                >
                  <div className="col-span-2">
                    <Label>Full name</Label>
                    <Input name="full_name" required />
                  </div>
                  <div>
                    <Label>Phone</Label>
                    <Input name="phone" required />
                  </div>
                  <div>
                    <Label>Pincode</Label>
                    <Input name="pincode" required />
                  </div>
                  <div className="col-span-2">
                    <Label>Address line 1</Label>
                    <Input name="line1" required />
                  </div>
                  <div className="col-span-2">
                    <Label>Address line 2</Label>
                    <Input name="line2" />
                  </div>
                  <div>
                    <Label>City</Label>
                    <Input name="city" required />
                  </div>
                  <div>
                    <Label>State</Label>
                    <Input name="state" required />
                  </div>
                  <div className="col-span-2 flex justify-end gap-2">
                    <Button type="button" variant="ghost" onClick={() => setShowAddForm(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" className="rounded-full">
                      Save address
                    </Button>
                  </div>
                </form>
              ) : (
                <Button
                  variant="outline"
                  className="w-full rounded-full"
                  onClick={() => setShowAddForm(true)}
                >
                  + Add new address
                </Button>
              )}
            </div>
          ) : null}
        </Card>

        <Card className="rounded-2xl p-5">
          <h2 className="font-display text-lg">Payment</h2>
          <RadioGroup
            value={paymentMethod}
            onValueChange={(v) => setPaymentMethod(v as any)}
            className="mt-3"
          >
            <label className="flex items-center gap-3 rounded-xl border border-border p-3 cursor-pointer has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
              <RadioGroupItem value="ONLINE" />
              <span className="font-medium">UPI / Cards / Netbanking</span>
              <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-semibold text-primary">
                <Banknote className="h-3 w-3" /> Instant
              </span>
            </label>
            <label className="flex items-center gap-3 rounded-xl border border-border p-3 cursor-pointer has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
              <RadioGroupItem value="COD" /> <span className="font-medium">Cash on delivery</span>
            </label>
          </RadioGroup>
          <p className="mt-2 text-xs text-muted-foreground">
            Online payment is processed securely through Cashfree (UPI, cards & netbanking). If the
            gateway isn't available you can pay via GPay / PhonePe / Paytm and confirm your UTR
            instead.
          </p>
        </Card>

        <Card className="rounded-2xl p-5">
          <div className="flex items-center gap-2">
            <BadgePercent className="h-4 w-4 text-secondary" />
            <h2 className="font-display text-lg">Coupon</h2>
          </div>
          {appliedCoupon ? (
            <div className="mt-3 flex items-center justify-between rounded-xl bg-secondary-soft p-3">
              <div className="text-sm">
                <span className="font-semibold">{appliedCoupon}</span>
                <span className="ml-2 text-muted-foreground">
                  –{COUPONS[appliedCoupon]?.pct}% off applied
                </span>
              </div>
              <button
                onClick={() => {
                  setAppliedCoupon(null);
                }}
                className="text-xs text-muted-foreground hover:underline"
              >
                Remove
              </button>
            </div>
          ) : (
            <div className="mt-3 flex gap-2">
              <Input
                value={coupon}
                onChange={(e) => setCoupon(e.target.value)}
                placeholder="Try BLOOM20"
                className="flex-1"
              />
              <Button variant="secondary" className="rounded-full" onClick={applyCoupon}>
                Apply
              </Button>
            </div>
          )}
        </Card>
      </div>

      <aside className="h-fit space-y-4">
        <Card className="rounded-2xl p-5">
          <h2 className="font-display text-lg">Order summary</h2>
          <div className="mt-3 space-y-2 text-sm">
            {items.map((it: any) => (
              <div key={it.id} className="flex justify-between">
                <span className="text-muted-foreground">
                  {it.product?.name} × {it.quantity}
                </span>
                <span>
                  ₹
                  {(Number(it.product?.discount_price ?? it.product?.price) * it.quantity).toFixed(
                    0,
                  )}
                </span>
              </div>
            ))}
            <div className="mt-2 flex justify-between border-t border-border pt-2">
              <span>Subtotal</span>
              <span>₹{subtotal.toFixed(0)}</span>
            </div>
            {discount > 0 ? (
              <div className="flex justify-between text-success">
                <span>Coupon ({appliedCoupon})</span>
                <span>–₹{discount.toFixed(0)}</span>
              </div>
            ) : null}
            <div className="flex justify-between">
              <span>Delivery</span>
              <span>{deliveryType === "PICKUP" ? "Free" : `₹${deliveryFee}`}</span>
            </div>
            <div className="mt-2 flex justify-between border-t border-border pt-2 font-display text-lg font-semibold">
              <span>Total</span>
              <span>₹{total.toFixed(0)}</span>
            </div>
          </div>
          <Button
            className="mt-4 w-full rounded-full"
            size="lg"
            onClick={() => placeOrder.mutate()}
            disabled={placeOrder.isPending}
          >
            {placeOrder.isPending
              ? "Placing…"
              : paymentMethod === "ONLINE"
                ? `Pay ₹${total.toFixed(0)}`
                : "Place order"}
          </Button>
        </Card>
      </aside>
    </div>
  );
}
