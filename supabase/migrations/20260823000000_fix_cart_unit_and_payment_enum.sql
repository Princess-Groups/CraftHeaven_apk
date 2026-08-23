-- ============================================================================
-- 2026-08-23 — Fix carts.unit missing column + payment_status enum casts
-- ============================================================================
-- 1) carts table was created without a `unit` column but the app upserts with
--    unit. Add it with a safe default.
-- 2) place_order and mark_order_paid_by_gateway assign plain text ('PAID',
--    'PENDING') to the `payment_status` enum column. PostgreSQL requires an
--    explicit cast. Fix both functions.
-- ============================================================================

-- +++++++++++ 1) ADD carts.unit column +++++++++++
ALTER TABLE public.carts
  ADD COLUMN IF NOT EXISTS unit TEXT NOT NULL DEFAULT 'Nos';

-- +++++++++++ 2) FIX place_order — cast enum literals +++++++++++
CREATE OR REPLACE FUNCTION public.place_order(
  _channel public.order_channel,
  _payment_method public.payment_method,
  _delivery_type public.delivery_type,
  _address_id UUID,
  _items JSONB,
  _notes TEXT DEFAULT NULL,
  _discount NUMERIC(10,2) DEFAULT 0,
  _tax_type TEXT DEFAULT 'NONE',
  _shipping NUMERIC(10,2) DEFAULT 0,
  _state TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _order_id UUID;
  _uid UUID := auth.uid();
  _item JSONB;
  _product RECORD;
  _qty NUMERIC(12,3);
  _price NUMERIC(10,2);
  _line NUMERIC(10,2);
  _cgst_rate NUMERIC(5,2);
  _sgst_rate NUMERIC(5,2);
  _igst_rate NUMERIC(5,2);
  _item_cgst NUMERIC(10,2);
  _item_sgst NUMERIC(10,2);
  _item_igst NUMERIC(10,2);
  _subtotal NUMERIC(10,2) := 0;
  _cgst_total NUMERIC(10,2) := 0;
  _sgst_total NUMERIC(10,2) := 0;
  _igst_total NUMERIC(10,2) := 0;
  _gst_total NUMERIC(10,2) := 0;
  _delivery_fee NUMERIC(10,2) := 0;
  _shipping_total NUMERIC(10,2) := GREATEST(0, COALESCE(_shipping, 0));
  _address_snapshot JSONB := NULL;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _channel = 'IN_STORE' AND NOT (public.has_role(_uid,'staff') OR public.has_role(_uid,'admin')) THEN
    RAISE EXCEPTION 'Not authorized for in-store sale';
  END IF;
  IF _delivery_type = 'DELIVERY' AND _address_id IS NOT NULL THEN
    SELECT to_jsonb(a) INTO _address_snapshot FROM public.addresses a WHERE a.id = _address_id AND a.user_id = _uid;
    _delivery_fee := 40;
  END IF;

  INSERT INTO public.orders (user_id, channel, payment_method, delivery_type, address_id, address_snapshot, created_by, subtotal, delivery_fee, shipping_charges, tax_type, transaction_state, total, status, payment_status)
  VALUES (
    CASE WHEN _channel = 'ONLINE' THEN _uid ELSE NULL END,
    _channel, _payment_method, _delivery_type, _address_id, _address_snapshot, _uid, 0, _delivery_fee, _shipping_total, _tax_type, _state, 0, 'NEW',
    CASE WHEN _channel = 'IN_STORE' AND _payment_method IN ('CASH','CARD','UPI') THEN 'PAID'::public.payment_status ELSE 'PENDING'::public.payment_status END
  )
  RETURNING id INTO _order_id;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _qty := GREATEST(0.001, COALESCE((_item->>'quantity')::NUMERIC, 1));
    SELECT * INTO _product FROM public.products WHERE id = (_item->>'product_id')::UUID FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Product not found'; END IF;
    IF COALESCE(_product.stock,0) < _qty THEN RAISE EXCEPTION 'Insufficient stock for % (stock: % %)', _product.name, _product.stock, COALESCE(_product.unit,'Nos'); END IF;

    _price := COALESCE(_product.discount_price, _product.price);
    _line := _price * _qty;

    _cgst_rate := COALESCE(_product.cgst_rate, 0);
    _sgst_rate := COALESCE(_product.sgst_rate, 0);
    _igst_rate := COALESCE(_product.igst_rate, 0);
    IF _igst_rate = 0 THEN _igst_rate := _cgst_rate + _sgst_rate; END IF;

    _item_cgst := 0; _item_sgst := 0; _item_igst := 0;
    IF _tax_type = 'CGST_SGST' THEN
      _item_cgst := round(_line * _cgst_rate / 100, 2);
      _item_sgst := round(_line * _sgst_rate / 100, 2);
    ELSIF _tax_type = 'IGST' THEN
      _item_igst := round(_line * _igst_rate / 100, 2);
    END IF;

    _subtotal := _subtotal + _line;
    _cgst_total := _cgst_total + _item_cgst;
    _sgst_total := _sgst_total + _item_sgst;
    _igst_total := _igst_total + _item_igst;

    INSERT INTO public.order_items (
      order_id, product_id, product_name, unit_price, quantity, line_total, unit,
      cgst_rate, sgst_rate, igst_rate, cgst_amount, sgst_amount, igst_amount, variation
    ) VALUES (
      _order_id, _product.id, _product.name, _price, _qty, _line, COALESCE(_product.unit,'Nos'),
      _cgst_rate, _sgst_rate, _igst_rate, _item_cgst, _item_sgst, _item_igst,
      NULLIF(btrim(COALESCE(_item->>'variation', '')), '')
    );

    UPDATE public.products
      SET stock = GREATEST(0, COALESCE(stock,0) - _qty),
          is_available = CASE WHEN (COALESCE(stock,0) - _qty) <= 0 THEN false ELSE is_available END
      WHERE id = _product.id;
  END LOOP;

  _gst_total := _cgst_total + _sgst_total + _igst_total;
  _discount := LEAST(_discount, _subtotal);

  UPDATE public.orders
    SET subtotal = _subtotal,
        discount = _discount,
        cgst_amount = _cgst_total,
        sgst_amount = _sgst_total,
        igst_amount = _igst_total,
        gst_total = _gst_total,
        total = _subtotal - _discount + _gst_total + _delivery_fee + _shipping_total,
        notes = _notes
    WHERE id = _order_id;

  INSERT INTO public.order_status_events (order_id, status, note) VALUES (_order_id, 'NEW', 'Order placed');
  IF _channel = 'ONLINE' THEN
    DELETE FROM public.carts WHERE user_id = _uid;
  END IF;
  RETURN _order_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.place_order(public.order_channel, public.payment_method, public.delivery_type, UUID, JSONB, TEXT, NUMERIC, TEXT, NUMERIC, TEXT) TO authenticated;

-- +++++++++++ 3) FIX mark_order_paid_by_gateway — cast enum literal +++++++++++
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
    SET payment_status = 'PAID'::public.payment_status,
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
