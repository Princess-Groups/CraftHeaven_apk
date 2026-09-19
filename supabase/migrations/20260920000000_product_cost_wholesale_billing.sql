-- ============================================================================
-- 2026-09-20 — Single product cost + retail/wholesale billing
-- ----------------------------------------------------------------------------
-- 1. Adds `products.wholesale_price` so the billing screen can charge a product
--    at either its RETAIL (products.price / discount_price) or WHOLESALE value.
--    New wholesale_price defaults to the current price so existing products
--    keep working until a wholesale price is entered (purchase form saves it).
-- 2. Extends `place_order` so each line item can opt into wholesale pricing via
--    `_item->>'price_type'` = 'WHOLESALE' (falls back to discount/price).
-- ============================================================================

-- +++++++++++ 1) Products — wholesale price +++++++++++
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS wholesale_price NUMERIC(10,2);

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS retail_profit_pct NUMERIC(6,2) NOT NULL DEFAULT 0;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS wholesale_profit_pct NUMERIC(6,2) NOT NULL DEFAULT 0;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS total_unit_cost NUMERIC(10,2) NOT NULL DEFAULT 0;

-- Backfill wholesale price from the current retail price where it is missing.
UPDATE public.products SET wholesale_price = price WHERE wholesale_price IS NULL OR wholesale_price <= 0;

-- +++++++++++ 3) Purchase RPCs — persist wholesale/profit pricing ++++++++++++
-- re-run of the (same-signature) create/update purchase functions so that the
-- products they create/update also store wholesale_price, profit percentages
-- and the single-product unit cost. These fields are read by the billing screen.
CREATE OR REPLACE FUNCTION public.create_purchase_with_products(
  _supplier_id UUID,
  _invoice_no TEXT,
  _purchase_date DATE,
  _notes TEXT,
  _items JSONB,
  _purchase_packing_freight_charge NUMERIC DEFAULT 0
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid UUID := auth.uid();
  _purchase_id UUID;
  _item JSONB;
  _product_id UUID;
  _qty INTEGER;
  _cost NUMERIC(10,2);
  _subtotal NUMERIC(12,2) := 0;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (public.has_role(_uid, 'admin') OR public.has_role(_uid, 'staff')) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  INSERT INTO public.purchases (supplier_id, invoice_no, purchase_date, notes, created_by, purchase_packing_freight_charge)
  VALUES (_supplier_id, NULLIF(btrim(_invoice_no), ''), COALESCE(_purchase_date, CURRENT_DATE), _notes, _uid, COALESCE(_purchase_packing_freight_charge, 0))
  RETURNING id INTO _purchase_id;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _product_id := public.match_or_create_product(
      COALESCE(_item->>'name', '')::TEXT,
      _item->>'sku'::TEXT,
      NULLIF(_item->>'category_id', '')::UUID,
      NULLIF(_item->>'brand_id', '')::UUID,
      COALESCE(_item->>'color', '')::TEXT,
      COALESCE(_item->>'size', '')::TEXT,
      COALESCE((_item->>'unit_cost')::NUMERIC, 0),
      COALESCE((_item->>'selling_price')::NUMERIC, 0),
      NULLIF(btrim(COALESCE(_item->>'image_url', '')), ''),
      COALESCE((_item->>'cgst_rate')::NUMERIC, 0),
      COALESCE((_item->>'sgst_rate')::NUMERIC, 0),
      COALESCE((_item->>'igst_rate')::NUMERIC, 0),
      CASE WHEN jsonb_typeof(_item->'color_variations') = 'array' THEN _item->'color_variations' ELSE '[]'::jsonb END,
      COALESCE(_item->>'unit', 'Nos'),
      COALESCE(_item->>'material', '')::TEXT
    );

    UPDATE public.products
      SET wholesale_price = GREATEST(COALESCE(wholesale_price, 0), COALESCE((_item->>'wholesale_price')::NUMERIC, 0)),
          retail_profit_pct = COALESCE((_item->>'retail_profit_pct')::NUMERIC, retail_profit_pct),
          wholesale_profit_pct = COALESCE((_item->>'wholesale_profit_pct')::NUMERIC, wholesale_profit_pct),
          total_unit_cost = GREATEST(0, COALESCE((_item->>'total_unit_cost')::NUMERIC, total_unit_cost))
      WHERE id = _product_id;

    _qty := GREATEST(1, COALESCE((_item->>'quantity')::INTEGER, 1));
    _cost := GREATEST(0, COALESCE((_item->>'unit_cost')::NUMERIC, 0));

    INSERT INTO public.purchase_items (purchase_id, product_id, quantity, unit_cost, line_total, unit, slot_number, slot_charge_per_product)
    VALUES (_purchase_id, _product_id, _qty, _cost, _qty * _cost,
            COALESCE(NULLIF(btrim(COALESCE(_item->>'unit', '')), ''), 'Nos'),
            NULLIF(_item->>'slot_number', ''),
            GREATEST(0, COALESCE((_item->>'slot_charge_per_product')::NUMERIC, 0)));

    _subtotal := _subtotal + (_qty * _cost);
  END LOOP;

  UPDATE public.purchases SET subtotal = _subtotal, tax = 0, total = _subtotal WHERE id = _purchase_id;
  RETURN _purchase_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.create_purchase_with_products(UUID, TEXT, DATE, TEXT, JSONB, NUMERIC) TO authenticated;

-- +++++++++++ 2) place_order — per-line wholesale price override +++++++++++
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

    -- Wholesale lines bill at wholesale_price; everything else uses the
    -- standard discount/price value, falling back to the purchase unit cost
    -- when the retail price has not been set yet (avoids ₹0 lines).
    IF COALESCE(_item->>'price_type', '') = 'WHOLESALE' AND COALESCE(_product.wholesale_price, 0) > 0 THEN
      _price := _product.wholesale_price;
    ELSE
      _price := COALESCE(_product.discount_price, _product.price);
    END IF;
    IF _price IS NULL OR _price <= 0 THEN
      _price := COALESCE(NULLIF(_product.total_unit_cost, 0), NULLIF(_product.purchase_price, 0), 0);
    END IF;
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