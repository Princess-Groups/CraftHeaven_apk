-- =========== ENUM-UPDATE FIXES ===========
-- PostgREST cannot cast a text value to an enum column on a direct .update().
-- It errors with: column "payment_status" is of type payment_status but
-- expression is of type text. The fix is to go through typed RPC functions,
-- which declare their parameters as the enum types (PL/pgSQL casts the literal
-- against the column type automatically).

-- 1) Customer confirms their UPI payment after entering the UTR.
CREATE OR REPLACE FUNCTION public.confirm_upi_payment(_order_id UUID, _utr TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid UUID := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.orders
  SET payment_status = 'PAID',
      notes = CASE
        WHEN notes IS NULL OR notes = '' THEN 'UPI paid · UTR ' || _utr
        ELSE notes || ' · UPI paid · UTR ' || _utr
      END
  WHERE id = _order_id AND user_id = _uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found or not yours';
  END IF;

  RETURN TRUE;
END;
$$;
GRANT EXECUTE ON FUNCTION public.confirm_upi_payment(UUID, TEXT) TO authenticated;

-- 2) Admin/staff update an order's status pipeline (also inserts the event row).
CREATE OR REPLACE FUNCTION public.update_order_status(
  _order_id UUID,
  _status public.order_status,
  _note TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid UUID := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (public.has_role(_uid, 'admin') OR public.has_role(_uid, 'staff')) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.orders SET status = _status, updated_at = now() WHERE id = _order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  INSERT INTO public.order_status_events (order_id, status, note)
  VALUES (_order_id, _status, COALESCE(_note, 'Status updated from admin'));

  RETURN TRUE;
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_order_status(UUID, public.order_status, TEXT) TO authenticated;
