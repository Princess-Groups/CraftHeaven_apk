-- ============================================================================
-- INDUSIND BANK PAYMENT GATEWAY — run this in the Supabase Dashboard → SQL Editor
-- ============================================================================
-- Adds a payments table + gateway tracking columns on orders, plus the RPC the
-- webhook handler calls to mark an order PAID after a genuine gateway callback.
-- Everything is idempotent (IF NOT EXISTS / OR REPLACE).
-- ============================================================================

-- ---------- 1) Orders: track the gateway order id ----------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS indusind_order_id TEXT;

-- ---------- 2) Payments table (one row per gateway attempt) ----------
CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  gateway TEXT NOT NULL DEFAULT 'indusind',
  gateway_order_id TEXT,
  txn_id TEXT,
  amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'INITIATED', -- INITIATED | PAID | FAILED
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payments self read" ON public.payments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = payments.order_id
    AND (o.user_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff'))));

-- ---------- 3) Webhook RPC: mark order PAID from a verified gateway callback ----------
-- Called by the server-side webhook handler with the service_role key, so it is
-- not exposed to the browser. It also persists the gateway txn id + raw response
-- on the latest payments row for the order.
CREATE OR REPLACE FUNCTION public.mark_order_paid_by_gateway(
  _order_id UUID,
  _gateway TEXT DEFAULT 'indusind',
  _gateway_order_id TEXT DEFAULT NULL,
  _txn_id TEXT DEFAULT NULL,
  _response JSONB DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.orders
    SET payment_status = 'PAID',
        updated_at = now(),
        indusind_order_id = COALESCE(_gateway_order_id, indusind_order_id),
        notes = CASE
          WHEN notes IS NULL OR notes = '' THEN 'Paid via ' || _gateway
          ELSE notes || ' · Paid via ' || _gateway
        END
    WHERE id = _order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  UPDATE public.payments
    SET status = 'PAID',
        txn_id = COALESCE(_txn_id, txn_id),
        response = COALESCE(_response, response),
        updated_at = now()
    WHERE id = (
      SELECT id FROM public.payments
      WHERE order_id = _order_id
      ORDER BY created_at DESC
      LIMIT 1
    );

  RETURN TRUE;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mark_order_paid_by_gateway(UUID, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_order_paid_by_gateway(UUID, TEXT, TEXT, TEXT, JSONB) TO service_role;
