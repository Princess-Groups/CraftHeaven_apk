-- ============================================================================
-- 2026-08-19 — Profit Percentage Dashboard
-- ----------------------------------------------------------------------------
-- Additive only. Does NOT alter orders/products/purchases/sales/billing flow.
--   1. order_profit_calculations — one row per existing order holding the
--      manual cost inputs (purchase amount, purchase shipping, GST, loan) +
--      a customer-delivery snapshot auto-synced from the order's
--      delivery_fee + shipping_charges, plus the computed totals.
--   2. profit_settings — single global row (id=1) with business loan amount and
--      the default loan % used to pre-fill new order entries.
--   3. upsert_order_profit_calculation / get_profit_settings / save_profit_settings —
--      SECURITY DEFINER RPCs with auth/role checks (staff or admin can capture
--      costs; only admin can edit global settings).
--   4. Optional orders AFTER UPDATE trigger that re-syncs customer_delivery and
--      recomputes totals for any existing profit row when the order's
--      delivery_fee / shipping_charges / total change (app updates the shipping
--      amount → dashboard reflects it automatically).
-- Safe to re-run: CREATE TABLE IF NOT EXISTS / CREATE OR REPLACE everywhere.
-- ============================================================================

-- +++++++++++ 1) ORDER PROFIT CALCULATIONS (one row per order) +++++++++++
CREATE TABLE IF NOT EXISTS public.order_profit_calculations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           UUID NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
  -- snapshot of orders.total (what the customer paid: goods + GST + delivery)
  revenue            NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- manual inputs (user-editable)
  purchase_amount    NUMERIC(12,2) NOT NULL DEFAULT 0,   -- what we paid for the goods
  purchase_shipping  NUMERIC(12,2) NOT NULL DEFAULT 0,   -- freight/courier in to us
  customer_delivery  NUMERIC(12,2) NOT NULL DEFAULT 0,   -- AUTO: orders.delivery_fee + shipping_charges
  gst_amount         NUMERIC(12,2) NOT NULL DEFAULT 0,   -- manual; defaulted from orders.gst_total
  loan_amount        NUMERIC(12,2) NOT NULL DEFAULT 0,   -- share of business loan attributable
  loan_percent       NUMERIC(5,2)  NOT NULL DEFAULT 0,   -- % of loan_amount charged on this order (e.g. 0.5)
  -- computed totals (recomputed by the RPC / trigger, never hand-typed)
  loan_cost          NUMERIC(12,2) NOT NULL DEFAULT 0,   -- round(loan_amount * loan_percent / 100, 2)
  total_cost         NUMERIC(12,2) NOT NULL DEFAULT 0,   -- purchase_amount + purchase_shipping + customer_delivery + gst_amount + loan_cost
  net_profit         NUMERIC(12,2) NOT NULL DEFAULT 0,   -- revenue - total_cost
  profit_percent     NUMERIC(12,2) NOT NULL DEFAULT 0,   -- net_profit / revenue * 100 (0 when revenue = 0)
  created_by         UUID,
  updated_by         UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_profit_calculations_order_id_idx
  ON public.order_profit_calculations(order_id);
CREATE INDEX IF NOT EXISTS order_profit_calculations_created_at_idx
  ON public.order_profit_calculations(created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.order_profit_calculations TO authenticated;
GRANT ALL ON public.order_profit_calculations TO service_role;
ALTER TABLE public.order_profit_calculations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "order_profit_calculations read" ON public.order_profit_calculations;
CREATE POLICY "order_profit_calculations read"
  ON public.order_profit_calculations FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

DROP POLICY IF EXISTS "order_profit_calculations write" ON public.order_profit_calculations;
CREATE POLICY "order_profit_calculations write"
  ON public.order_profit_calculations FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

-- +++++++++++ 2) PROFIT SETTINGS (single global row) +++++++++++
CREATE TABLE IF NOT EXISTS public.profit_settings (
  id                   INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  business_loan_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  loan_percent_default NUMERIC(5,2)  NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.profit_settings TO authenticated;
GRANT ALL ON public.profit_settings TO service_role;
ALTER TABLE public.profit_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profit_settings read" ON public.profit_settings;
CREATE POLICY "profit_settings read"
  ON public.profit_settings FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

DROP POLICY IF EXISTS "profit_settings admin write" ON public.profit_settings;
CREATE POLICY "profit_settings admin write"
  ON public.profit_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Seed the single row so get/save always have a target.
INSERT INTO public.profit_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- +++++++++++ 3) RPC: UPSERT one order's profit calculation +++++++++++
-- Recomputes customer_delivery and revenue from the (authoritative) orders row,
-- computes loan_cost / total_cost / net_profit / profit_percent, then upserts
-- the single order_id row. Staff and admin may both capture cost data.
CREATE OR REPLACE FUNCTION public.upsert_order_profit_calculation(
  _order_id          UUID,
  _purchase_amount   NUMERIC,
  _purchase_shipping NUMERIC DEFAULT 0,
  _gst_amount        NUMERIC DEFAULT NULL,  -- NULL => default from orders.gst_total
  _loan_amount       NUMERIC DEFAULT NULL,  -- NULL => default 0
  _loan_percent      NUMERIC DEFAULT NULL   -- NULL => default 0
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid      UUID                    := auth.uid();
  _o        public.orders;
  _pa       NUMERIC(12,2)           := 0;
  _ps       NUMERIC(12,2)           := 0;
  _gst      NUMERIC(12,2)           := 0;
  _loan     NUMERIC(12,2)           := 0;
  _lpc      NUMERIC(5,2)            := 0;
  _delivery NUMERIC(12,2)           := 0;
  _loanc    NUMERIC(12,2)           := 0;
  _tc       NUMERIC(12,2)           := 0;
  _np       NUMERIC(12,2)           := 0;
  _pp       NUMERIC(12,2)           := 0;
  _row      public.order_profit_calculations;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (public.has_role(_uid, 'admin') OR public.has_role(_uid, 'staff')) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO _o FROM public.orders WHERE id = _order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;

  _pa       := GREATEST(0, COALESCE(_purchase_amount, 0));
  _ps       := GREATEST(0, COALESCE(_purchase_shipping, 0));
  _gst      := GREATEST(0, COALESCE(_gst_amount, COALESCE(_o.gst_total, 0)));
  _loan     := GREATEST(0, COALESCE(_loan_amount, 0));
  _lpc      := GREATEST(0, COALESCE(_loan_percent, 0));
  _delivery := GREATEST(0, COALESCE(_o.delivery_fee, 0)) + GREATEST(0, COALESCE(_o.shipping_charges, 0));

  _loanc := round(_loan * _lpc / 100, 2);
  _tc    := round(_pa + _ps + _delivery + _gst + _loanc, 2);
  _np    := round(COALESCE(_o.total, 0) - _tc, 2);
  _pp    := CASE WHEN COALESCE(_o.total, 0) <> 0
                 THEN round(_np * 100.0 / _o.total, 2)
                 ELSE 0 END;

  INSERT INTO public.order_profit_calculations (
    order_id, revenue, purchase_amount, purchase_shipping, customer_delivery,
    gst_amount, loan_amount, loan_percent, loan_cost, total_cost, net_profit, profit_percent,
    created_by, updated_by, updated_at
  ) VALUES (
    _order_id, COALESCE(_o.total, 0), _pa, _ps, _delivery,
    _gst, _loan, _lpc, _loanc, _tc, _np, _pp,
    _uid, _uid, now()
  )
  ON CONFLICT (order_id) DO UPDATE SET
    revenue           = excluded.revenue,
    purchase_amount   = excluded.purchase_amount,
    purchase_shipping = excluded.purchase_shipping,
    customer_delivery = excluded.customer_delivery,
    gst_amount        = excluded.gst_amount,
    loan_amount       = excluded.loan_amount,
    loan_percent      = excluded.loan_percent,
    loan_cost         = excluded.loan_cost,
    total_cost        = excluded.total_cost,
    net_profit        = excluded.net_profit,
    profit_percent    = excluded.profit_percent,
    updated_by        = excluded.updated_by,
    updated_at        = excluded.updated_at
  RETURNING * INTO _row;

  RETURN to_jsonb(_row);
END;
$$;
GRANT EXECUTE ON FUNCTION public.upsert_order_profit_calculation(UUID, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC) TO authenticated;

-- +++++++++++ 4) RPC: READ PROFIT SETTINGS (admin or staff) +++++++++++
CREATE OR REPLACE FUNCTION public.get_profit_settings()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid UUID := auth.uid();
  _row public.profit_settings;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (public.has_role(_uid, 'admin') OR public.has_role(_uid, 'staff')) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  SELECT * INTO _row FROM public.profit_settings WHERE id = 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('business_loan_amount', 0, 'loan_percent_default', 0);
  END IF;
  RETURN to_jsonb(_row);
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_profit_settings() TO authenticated;

-- +++++++++++ 5) RPC: SAVE PROFIT SETTINGS (admin only) +++++++++++
CREATE OR REPLACE FUNCTION public.save_profit_settings(
  _business_loan_amount NUMERIC,
  _loan_percent_default NUMERIC DEFAULT 0
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid UUID := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.has_role(_uid, 'admin') THEN RAISE EXCEPTION 'Admin only'; END IF;
  UPDATE public.profit_settings
    SET business_loan_amount = GREATEST(0, COALESCE(_business_loan_amount, 0)),
        loan_percent_default = GREATEST(0, COALESCE(_loan_percent_default, 0)),
        updated_at           = now()
    WHERE id = 1;
  RETURN TRUE;
END;
$$;
GRANT EXECUTE ON FUNCTION public.save_profit_settings(NUMERIC, NUMERIC) TO authenticated;

-- +++++++++++ 6) Re-sync a profit row when the order's delivery/total changes +++++++++++
-- Additive only: this trigger only writes to order_profit_calculations, never to
-- orders. Keeps customer_delivery / revenue / totals consistent if a shipping
-- charge is updated later (e.g. the app changes the delivery amount) — the
-- dashboard then reflects the updated amount automatically.
CREATE OR REPLACE FUNCTION public.sync_order_profit_delivery() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _delivery NUMERIC(12,2);
  _tc       NUMERIC(12,2);
  _np       NUMERIC(12,2);
  _pp       NUMERIC(12,2);
BEGIN
  _delivery := GREATEST(0, COALESCE(NEW.delivery_fee, 0)) + GREATEST(0, COALESCE(NEW.shipping_charges, 0));
  UPDATE public.order_profit_calculations c
    SET customer_delivery = _delivery,
        revenue           = COALESCE(NEW.total, 0),
        total_cost        = round(c.purchase_amount + c.purchase_shipping + _delivery + c.gst_amount + c.loan_cost, 2),
        net_profit        = round(COALESCE(NEW.total, 0) - (c.purchase_amount + c.purchase_shipping + _delivery + c.gst_amount + c.loan_cost), 2),
        profit_percent    = CASE WHEN COALESCE(NEW.total, 0) <> 0
                                 THEN round((COALESCE(NEW.total, 0) - (c.purchase_amount + c.purchase_shipping + _delivery + c.gst_amount + c.loan_cost)) * 100.0 / COALESCE(NEW.total, 0), 2)
                                 ELSE 0 END,
        updated_at        = now()
    WHERE c.order_id = NEW.id;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_sync_order_profit_delivery ON public.orders;
CREATE TRIGGER trg_sync_order_profit_delivery
  AFTER UPDATE OF delivery_fee, shipping_charges, total ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.sync_order_profit_delivery();