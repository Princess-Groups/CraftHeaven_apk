-- ============================================================================
-- 2026-08-19 — Billing: GST (CGST/SGST/IGST), shipping, color variations, photos
-- ----------------------------------------------------------------------------
-- Builds on the purchase ⇄ product merge work. Adds, without touching existing
-- data:
--   1. products  → cgst_rate / sgst_rate / igst_rate + color_variations JSONB
--                  (each variation { color, image_url }) so a product can carry
--                  multiple colour variants, each with its own photo.
--   2. orders    → tax_type, cgst_amount, sgst_amount, igst_amount, gst_total,
--                  shipping_charges (manual courier), transaction_state.
--   3. order_items → per-line gst rates/amounts + a `variation` label so the
--                  bill can show the selected colour / variant.
--   4. match_or_create_product / create_purchase_with_products /
--                  update_purchase_with_products — accept photo, colour
--                  variations, split-GST rates; keep purchase_price & price
--                  (selling) independent; preserve existing image/variation
--                  data on update (merge, never clobber).
--   5. place_order — computes GST from the selected tax_type (CGST_SGST intra /
--                  IGST inter) and applies a manual shipping charge. Defaults
--                  keep the old online-store behaviour (no split tax, no manual
--                  shipping) so nothing is double-charged.
--
-- Safe to re-run: CREATE OR REPLACE / IF NOT EXISTS everywhere.
-- ============================================================================

-- +++++++++++ 1) PRODUCTS — split GST + colour variations +++++++++++
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS cgst_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sgst_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS igst_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS color_variations JSONB NOT NULL DEFAULT '[]'::jsonb;

-- +++++++++++ 2) ORDERS — tax & shipping +++++++++++
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS tax_type TEXT NOT NULL DEFAULT 'NONE', -- NONE | CGST_SGST | IGST
  ADD COLUMN IF NOT EXISTS cgst_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sgst_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS igst_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gst_total NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipping_charges NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transaction_state TEXT;

-- +++++++++++ 3) ORDER ITEMS — per-line tax + variation label +++++++++++
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS cgst_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sgst_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS igst_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cgst_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sgst_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS igst_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS variation TEXT;

-- +++++++++++ 4) Colour-variation merge helper +++++++++++
-- Merges incoming variations into the existing set by colour so repeated
-- purchases never create duplicate variation rows or drop existing photos.
CREATE OR REPLACE FUNCTION public.merge_color_variations(_current JSONB, _incoming JSONB)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  _out JSONB := COALESCE(_current, '[]'::jsonb);
  _v JSONB;
  _color TEXT;
  _img TEXT;
  _i INT;
  _found BOOLEAN;
BEGIN
  FOR _v IN SELECT * FROM jsonb_array_elements(COALESCE(_incoming, '[]'::jsonb)) LOOP
    _color := COALESCE(_v->>'color', '');
    IF _color = '' THEN CONTINUE; END IF;
    _i := 0;
    _found := false;
    WHILE _i < jsonb_array_length(_out) LOOP
      IF COALESCE(_out->_i->>'color', '') = _color THEN
        _img := COALESCE(_v->>'image_url', '');
        IF _img <> '' THEN
          _out := jsonb_set(_out, ARRAY[_i::text, 'image_url'], to_jsonb(_img));
        END IF;
        _found := true;
        EXIT;
      END IF;
      _i := _i + 1;
    END LOOP;
    IF NOT _found THEN
      _out := _out || jsonb_build_array(jsonb_build_object('color', _color, 'image_url', COALESCE(_v->>'image_url', '')));
    END IF;
  END LOOP;
  RETURN _out;
END;
$$;
GRANT EXECUTE ON FUNCTION public.merge_color_variations(JSONB, JSONB) TO authenticated;

-- +++++++++++ 5) match_or_create_product — photo, variations, split GST +++++++++++
-- purchase_price (what we paid) and price (what we sell for) stay independent.
-- On update: image is APPENDED (never replaces existing photos), variations are
-- merged by colour, rates are updated when a non-zero value is supplied.
CREATE OR REPLACE FUNCTION public.match_or_create_product(
  _name TEXT,
  _sku TEXT,
  _category_id UUID,
  _brand_id UUID,
  _color TEXT,
  _size TEXT,
  _purchase_price NUMERIC,
  _selling_price NUMERIC,
  _image_url TEXT DEFAULT NULL,
  _cgst_rate NUMERIC DEFAULT NULL,
  _sgst_rate NUMERIC DEFAULT NULL,
  _igst_rate NUMERIC DEFAULT NULL,
  _color_variations JSONB DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _id UUID;
  _slug TEXT;
  _base TEXT;
  _i INT;
BEGIN
  -- Match by SKU first (fall back to barcode) so repeated purchases of the
  -- same code never duplicate the product.
  IF _sku IS NOT NULL AND btrim(_sku) <> '' THEN
    SELECT id INTO _id FROM public.products
      WHERE sku = btrim(_sku) OR barcode = btrim(_sku)
      LIMIT 1;
    IF FOUND THEN
      -- Core product fields.
      UPDATE public.products
        SET name           = COALESCE(NULLIF(btrim(_name), ''), name),
            category_id    = COALESCE(_category_id, category_id),
            brand_id       = COALESCE(_brand_id, brand_id),
            color          = COALESCE(NULLIF(btrim(_color), ''), color),
            size           = COALESCE(NULLIF(btrim(_size), ''), size),
            purchase_price = COALESCE(NULLIF(_purchase_price, 0), purchase_price),
            price          = COALESCE(NULLIF(_selling_price, 0), price),
            gst_rate       = COALESCE(NULLIF(_cgst_rate + _sgst_rate, 0), gst_rate),
            cgst_rate      = COALESCE(NULLIF(_cgst_rate, 0), cgst_rate),
            sgst_rate      = COALESCE(NULLIF(_sgst_rate, 0), sgst_rate),
            igst_rate      = COALESCE(NULLIF(_igst_rate, 0), igst_rate)
        WHERE id = _id;

      -- Append the new photo without removing existing ones.
      IF _image_url IS NOT NULL AND btrim(_image_url) <> ''
         AND NOT (_id IN (
            SELECT p2.id FROM public.products p2
            WHERE p2.id = _id AND ARRAY[btrim(_image_url)] <@ COALESCE(p2.image_urls, '{}')
         )) THEN
        UPDATE public.products
          SET image_urls = array_append(COALESCE(image_urls, '{}'), btrim(_image_url))
          WHERE id = _id;
      END IF;

      -- Merge colour variations by colour (keeps existing variation photos).
      IF _color_variations IS NOT NULL THEN
        UPDATE public.products
          SET color_variations = public.merge_color_variations(color_variations, _color_variations)
          WHERE id = _id;
      END IF;

      RETURN _id;
    END IF;
  END IF;

  -- No match — create a brand-new product with a unique slug.
  _base := lower(regexp_replace(btrim(COALESCE(_name, 'product')), '[^a-z0-9]+', '-', 'g'));
  _base := btrim(_base, '-');
  IF _base = '' THEN _base := 'product'; END IF;
  _slug := _base;
  _i := 1;
  WHILE EXISTS (SELECT 1 FROM public.products WHERE slug = _slug) LOOP
    _slug := _base || '-' || _i;
    _i := _i + 1;
  END LOOP;

  INSERT INTO public.products (
    name, slug, sku, category_id, brand_id, color, size,
    price, purchase_price, stock, is_available, description,
    image_urls, color_variations,
    gst_rate, cgst_rate, sgst_rate, igst_rate
  ) VALUES (
    COALESCE(NULLIF(btrim(_name), ''), 'Untitled product'),
    _slug,
    NULLIF(btrim(_sku), ''),
    _category_id, _brand_id,
    NULLIF(btrim(_color), ''), NULLIF(btrim(_size), ''),
    COALESCE(NULLIF(_selling_price, 0), _purchase_price, 0),
    COALESCE(NULLIF(_purchase_price, 0), NULL),
    0, true,
    'Created automatically from a purchase entry.',
    CASE WHEN _image_url IS NOT NULL AND btrim(_image_url) <> ''
         THEN ARRAY[btrim(_image_url)]
         ELSE '{}'::text[] END,
    COALESCE(_color_variations, '[]'::jsonb),
    COALESCE(NULLIF(_cgst_rate + _sgst_rate, 0), 0),
    COALESCE(_cgst_rate, 0), COALESCE(_sgst_rate, 0), COALESCE(_igst_rate, 0)
  )
  RETURNING id INTO _id;

  RETURN _id;
END; $$;
GRANT EXECUTE ON FUNCTION public.match_or_create_product(TEXT, TEXT, UUID, UUID, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC, NUMERIC, JSONB) TO authenticated;

-- +++++++++++ 6) Create purchase — photo/variations/GST + stock + purchase tax +++++++++++
CREATE OR REPLACE FUNCTION public.create_purchase_with_products(
  _supplier_id UUID,
  _invoice_no TEXT,
  _purchase_date DATE,
  _notes TEXT,
  _items JSONB
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid UUID := auth.uid();
  _purchase_id UUID;
  _item JSONB;
  _product_id UUID;
  _qty INTEGER;
  _cost NUMERIC(10,2);
  _cgst NUMERIC(10,2);
  _sgst NUMERIC(10,2);
  _igst NUMERIC(10,2);
  _line_tax NUMERIC(10,2);
  _subtotal NUMERIC(12,2) := 0;
  _tax_total NUMERIC(12,2) := 0;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (public.has_role(_uid, 'admin') OR public.has_role(_uid, 'staff')) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  INSERT INTO public.purchases (supplier_id, invoice_no, purchase_date, notes, created_by)
  VALUES (_supplier_id, NULLIF(btrim(_invoice_no), ''), COALESCE(_purchase_date, CURRENT_DATE), _notes, _uid)
  RETURNING id INTO _purchase_id;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _product_id := public.match_or_create_product(
      COALESCE(_item->>'name', '')::TEXT,
      COALESCE(_item->>'sku', '')::TEXT,
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
      COALESCE(_item->'color_variations', '[]'::jsonb)
    );
    _qty := GREATEST(1, COALESCE((_item->>'quantity')::INTEGER, 1));
    _cost := GREATEST(0, COALESCE((_item->>'unit_cost')::NUMERIC, 0));
    _cgst := COALESCE((_item->>'cgst_rate')::NUMERIC, 0);
    _sgst := COALESCE((_item->>'sgst_rate')::NUMERIC, 0);
    _igst := COALESCE((_item->>'igst_rate')::NUMERIC, 0);
    -- Input GST on the purchase cost (IGST when inter-state, else CGST+SGST).
    _line_tax := _qty * _cost * (CASE WHEN _igst > 0 THEN _igst ELSE _cgst + _sgst END) / 100;
    _tax_total := _tax_total + _line_tax;

    INSERT INTO public.purchase_items (purchase_id, product_id, quantity, unit_cost, line_total)
    VALUES (_purchase_id, _product_id, _qty, _cost, _qty * _cost);

    _subtotal := _subtotal + (_qty * _cost);
  END LOOP;

  UPDATE public.purchases SET subtotal = _subtotal, tax = _tax_total, total = _subtotal + _tax_total WHERE id = _purchase_id;
  RETURN _purchase_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.create_purchase_with_products(UUID, TEXT, DATE, TEXT, JSONB) TO authenticated;

-- +++++++++++ 7) Edit purchase (same record) + recalc stock/tax +++++++++++
-- product_id is passed back for existing lines so they update the very same
-- product instead of creating a duplicate.
CREATE OR REPLACE FUNCTION public.update_purchase_with_products(
  _purchase_id UUID,
  _supplier_id UUID,
  _invoice_no TEXT,
  _purchase_date DATE,
  _notes TEXT,
  _items JSONB
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid UUID := auth.uid();
  _item JSONB;
  _linked_pid UUID;
  _product_id UUID;
  _qty INTEGER;
  _cost NUMERIC(10,2);
  _cgst NUMERIC(10,2);
  _sgst NUMERIC(10,2);
  _igst NUMERIC(10,2);
  _line_tax NUMERIC(10,2);
  _subtotal NUMERIC(12,2) := 0;
  _tax_total NUMERIC(12,2) := 0;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (public.has_role(_uid, 'admin') OR public.has_role(_uid, 'staff')) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.purchases
    SET supplier_id = _supplier_id,
        invoice_no = NULLIF(btrim(_invoice_no), ''),
        purchase_date = COALESCE(_purchase_date, CURRENT_DATE),
        notes = _notes
    WHERE id = _purchase_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase not found'; END IF;

  -- Remove old lines first — the AFTER DELETE trigger reverses stock in the
  -- same transaction.
  DELETE FROM public.purchase_items WHERE purchase_id = _purchase_id;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _linked_pid := CASE
      WHEN _item->>'product_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN (_item->>'product_id')::UUID
      ELSE NULL END;

    IF _linked_pid IS NOT NULL AND EXISTS (SELECT 1 FROM public.products WHERE id = _linked_pid) THEN
      _product_id := _linked_pid;
      UPDATE public.products
        SET name           = COALESCE(NULLIF(btrim(COALESCE(_item->>'name','')), ''), name),
            sku            = COALESCE(NULLIF(btrim(COALESCE(_item->>'sku','')), ''), sku),
            category_id    = COALESCE(NULLIF(_item->>'category_id','')::UUID, category_id),
            brand_id       = COALESCE(NULLIF(_item->>'brand_id','')::UUID, brand_id),
            color          = COALESCE(NULLIF(btrim(COALESCE(_item->>'color','')), ''), color),
            size           = COALESCE(NULLIF(btrim(COALESCE(_item->>'size','')), ''), size),
            purchase_price = COALESCE(NULLIF((_item->>'unit_cost')::NUMERIC, 0), purchase_price),
            price          = COALESCE(NULLIF((_item->>'selling_price')::NUMERIC, 0), price),
            gst_rate       = COALESCE(NULLIF(COALESCE((_item->>'cgst_rate')::NUMERIC,0) + COALESCE((_item->>'sgst_rate')::NUMERIC,0), 0), gst_rate),
            cgst_rate      = COALESCE(NULLIF(COALESCE((_item->>'cgst_rate')::NUMERIC,0), 0), cgst_rate),
            sgst_rate      = COALESCE(NULLIF(COALESCE((_item->>'sgst_rate')::NUMERIC,0), 0), sgst_rate),
            igst_rate      = COALESCE(NULLIF(COALESCE((_item->>'igst_rate')::NUMERIC,0), 0), igst_rate)
        WHERE id = _linked_pid;
      -- Append new photo, merge variations.
      IF NULLIF(btrim(COALESCE(_item->>'image_url','')), '') IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.products p2 WHERE p2.id = _linked_pid
                         AND ARRAY[btrim(COALESCE(_item->>'image_url',''))] <@ COALESCE(p2.image_urls, '{}')) THEN
        UPDATE public.products
          SET image_urls = array_append(COALESCE(image_urls, '{}'), btrim(COALESCE(_item->>'image_url','')))
          WHERE id = _linked_pid;
      END IF;
      IF _item->'color_variations' IS NOT NULL THEN
        UPDATE public.products
          SET color_variations = public.merge_color_variations(color_variations, _item->'color_variations')
          WHERE id = _linked_pid;
      END IF;
    ELSE
      -- Legacy safety net: no SKU → match the newest product with the same name.
      IF NULLIF(btrim(COALESCE(_item->>'sku','')), '') IS NULL THEN
        SELECT id INTO _linked_pid FROM public.products
          WHERE name = COALESCE(NULLIF(btrim(COALESCE(_item->>'name','')), ''), '')
          ORDER BY created_at DESC, id DESC
          LIMIT 1;
      END IF;
      IF _linked_pid IS NOT NULL THEN
        _product_id := _linked_pid;
        UPDATE public.products
          SET name           = COALESCE(NULLIF(btrim(COALESCE(_item->>'name','')), ''), name),
              sku            = COALESCE(NULLIF(btrim(COALESCE(_item->>'sku','')), ''), sku),
              category_id    = COALESCE(NULLIF(_item->>'category_id','')::UUID, category_id),
              brand_id       = COALESCE(NULLIF(_item->>'brand_id','')::UUID, brand_id),
              color          = COALESCE(NULLIF(btrim(COALESCE(_item->>'color','')), ''), color),
              size           = COALESCE(NULLIF(btrim(COALESCE(_item->>'size','')), ''), size),
              purchase_price = COALESCE(NULLIF((_item->>'unit_cost')::NUMERIC, 0), purchase_price),
              price          = COALESCE(NULLIF((_item->>'selling_price')::NUMERIC, 0), price),
              gst_rate       = COALESCE(NULLIF(COALESCE((_item->>'cgst_rate')::NUMERIC,0) + COALESCE((_item->>'sgst_rate')::NUMERIC,0), 0), gst_rate),
              cgst_rate      = COALESCE(NULLIF(COALESCE((_item->>'cgst_rate')::NUMERIC,0), 0), cgst_rate),
              sgst_rate      = COALESCE(NULLIF(COALESCE((_item->>'sgst_rate')::NUMERIC,0), 0), sgst_rate),
              igst_rate      = COALESCE(NULLIF(COALESCE((_item->>'igst_rate')::NUMERIC,0), 0), igst_rate)
          WHERE id = _linked_pid;
        -- Append new photo, merge variations (same as the linked path above).
        IF NULLIF(btrim(COALESCE(_item->>'image_url','')), '') IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM public.products p2 WHERE p2.id = _linked_pid
                           AND ARRAY[btrim(COALESCE(_item->>'image_url',''))] <@ COALESCE(p2.image_urls, '{}')) THEN
          UPDATE public.products
            SET image_urls = array_append(COALESCE(image_urls, '{}'), btrim(COALESCE(_item->>'image_url','')))
            WHERE id = _linked_pid;
        END IF;
        IF _item->'color_variations' IS NOT NULL THEN
          UPDATE public.products
            SET color_variations = public.merge_color_variations(color_variations, _item->'color_variations')
            WHERE id = _linked_pid;
        END IF;
      ELSE
        _product_id := public.match_or_create_product(
          COALESCE(_item->>'name', '')::TEXT,
          COALESCE(_item->>'sku', '')::TEXT,
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
          COALESCE(_item->'color_variations', '[]'::jsonb)
        );
      END IF;
    END IF;

    _qty := GREATEST(1, COALESCE((_item->>'quantity')::INTEGER, 1));
    _cost := GREATEST(0, COALESCE((_item->>'unit_cost')::NUMERIC, 0));
    _cgst := COALESCE((_item->>'cgst_rate')::NUMERIC, 0);
    _sgst := COALESCE((_item->>'sgst_rate')::NUMERIC, 0);
    _igst := COALESCE((_item->>'igst_rate')::NUMERIC, 0);
    _line_tax := _qty * _cost * (CASE WHEN _igst > 0 THEN _igst ELSE _cgst + _sgst END) / 100;
    _tax_total := _tax_total + _line_tax;

    INSERT INTO public.purchase_items (purchase_id, product_id, quantity, unit_cost, line_total)
    VALUES (_purchase_id, _product_id, _qty, _cost, _qty * _cost);

    _subtotal := _subtotal + (_qty * _cost);
  END LOOP;

  UPDATE public.purchases SET subtotal = _subtotal, tax = _tax_total, total = _subtotal + _tax_total WHERE id = _purchase_id;
  RETURN TRUE;
END; $$;
GRANT EXECUTE ON FUNCTION public.update_purchase_with_products(UUID, UUID, TEXT, DATE, TEXT, JSONB) TO authenticated;

-- +++++++++++ 8) place_order — intra/inter-state GST + manual shipping + variation +++++++++++
-- _tax_type: 'NONE' (default — keeps legacy inclusive-pricing behaviour),
--            'CGST_SGST' (intra-state → product cgst + sgst),
--            'IGST' (inter-state → product igst, or cgst+sgst fallback).
-- _shipping: manual courier charge (entered at billing time).
-- Each item may carry `variation` (the colour/variant sold) which is recorded
-- on order_items and shown on the bill.
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
  _qty INTEGER;
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
    CASE WHEN _channel = 'IN_STORE' AND _payment_method IN ('CASH','CARD','UPI') THEN 'PAID' ELSE 'PENDING' END
  )
  RETURNING id INTO _order_id;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _qty := (_item->>'quantity')::INTEGER;
    SELECT * INTO _product FROM public.products WHERE id = (_item->>'product_id')::UUID FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Product not found'; END IF;
    IF _product.stock < _qty THEN RAISE EXCEPTION 'Insufficient stock for %', _product.name; END IF;

    _price := COALESCE(_product.discount_price, _product.price);
    _line := _price * _qty;

    -- Per-line GST depends on the transaction tax type.
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
      order_id, product_id, product_name, unit_price, quantity, line_total,
      cgst_rate, sgst_rate, igst_rate, cgst_amount, sgst_amount, igst_amount, variation
    ) VALUES (
      _order_id, _product.id, _product.name, _price, _qty, _line,
      _cgst_rate, _sgst_rate, _igst_rate, _item_cgst, _item_sgst, _item_igst,
      NULLIF(btrim(COALESCE(_item->>'variation', '')), '')
    );

    UPDATE public.products
      SET stock = stock - _qty,
          is_available = CASE WHEN (stock - _qty) <= 0 THEN false ELSE is_available END
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
END;
$$;
GRANT EXECUTE ON FUNCTION public.place_order(public.order_channel, public.payment_method, public.delivery_type, UUID, JSONB, TEXT, NUMERIC, TEXT, NUMERIC, TEXT) TO authenticated;