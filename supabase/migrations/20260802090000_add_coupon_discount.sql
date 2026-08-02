-- =========== COUPON DISCOUNT ON PLACE_ORDER ===========
-- The storefront applies coupon codes (e.g. BLOOM20) at checkout. This adds an
-- optional _discount argument to place_order so the stored total reflects the
-- discounted price the customer actually pays. No discount = existing behaviour.

CREATE OR REPLACE FUNCTION public.place_order(
  _channel public.order_channel,
  _payment_method public.payment_method,
  _delivery_type public.delivery_type,
  _address_id UUID,
  _items JSONB, -- [{product_id, quantity}]
  _notes TEXT DEFAULT NULL,
  _discount NUMERIC(10,2) DEFAULT 0
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _order_id UUID;
  _uid UUID := auth.uid();
  _item JSONB;
  _product RECORD;
  _qty INTEGER;
  _price NUMERIC(10,2);
  _subtotal NUMERIC(10,2) := 0;
  _delivery_fee NUMERIC(10,2) := 0;
  _address_snapshot JSONB := NULL;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- staff/admin required for in-store
  IF _channel = 'IN_STORE' AND NOT (public.has_role(_uid, 'staff') OR public.has_role(_uid, 'admin')) THEN
    RAISE EXCEPTION 'Not authorized for in-store sale';
  END IF;

  IF _delivery_type = 'DELIVERY' AND _address_id IS NOT NULL THEN
    SELECT to_jsonb(a) INTO _address_snapshot FROM public.addresses a WHERE a.id = _address_id AND a.user_id = _uid;
    _delivery_fee := 40;
  END IF;

  INSERT INTO public.orders (user_id, channel, payment_method, delivery_type, address_id, address_snapshot, created_by, subtotal, delivery_fee, total, status, payment_status)
  VALUES (
    CASE WHEN _channel = 'ONLINE' THEN _uid ELSE NULL END,
    _channel, _payment_method, _delivery_type, _address_id, _address_snapshot, _uid, 0, _delivery_fee, 0, 'NEW',
    -- POS sales are paid at the counter; online orders start PENDING and are
    -- marked PAID once the customer confirms their UPI payment (UTR).
    CASE WHEN _channel = 'IN_STORE' AND _payment_method IN ('CASH','CARD','UPI') THEN 'PAID'
         ELSE 'PENDING' END
  )
  RETURNING id INTO _order_id;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _qty := (_item->>'quantity')::INTEGER;
    SELECT * INTO _product FROM public.products WHERE id = (_item->>'product_id')::UUID FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Product not found'; END IF;
    IF _product.stock < _qty THEN RAISE EXCEPTION 'Insufficient stock for %', _product.name; END IF;
    _price := COALESCE(_product.discount_price, _product.price);
    _subtotal := _subtotal + (_price * _qty);

    INSERT INTO public.order_items (order_id, product_id, product_name, unit_price, quantity, line_total)
    VALUES (_order_id, _product.id, _product.name, _price, _qty, _price * _qty);

    UPDATE public.products
      SET stock = stock - _qty,
          is_available = CASE WHEN (stock - _qty) <= 0 THEN false ELSE is_available END
      WHERE id = _product.id;
  END LOOP;

  _discount := LEAST(_discount, _subtotal);
  UPDATE public.orders
    SET subtotal = _subtotal,
        discount = _discount,
        total = _subtotal - _discount + _delivery_fee,
        notes = _notes
    WHERE id = _order_id;

  INSERT INTO public.order_status_events (order_id, status, note) VALUES (_order_id, 'NEW', 'Order placed');

  -- Clear cart for online orders
  IF _channel = 'ONLINE' THEN
    DELETE FROM public.carts WHERE user_id = _uid;
  END IF;

  RETURN _order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_order(public.order_channel, public.payment_method, public.delivery_type, UUID, JSONB, TEXT, NUMERIC) TO authenticated;
