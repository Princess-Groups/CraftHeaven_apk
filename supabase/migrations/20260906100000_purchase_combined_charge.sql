-- ============================================================
-- Purchase Combined Packing & Freight Charge
-- Migration: 20260906100000_purchase_combined_charge.sql
-- ============================================================
-- Adds:
--   1. `purchase_packing_freight_charge` column on purchases table
--   2. Updates create/update purchase RPCs to accept combined charge
-- ============================================================

-- ---------- 1) Add combined charge column to purchases ----------
ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS purchase_packing_freight_charge NUMERIC(12,2) NOT NULL DEFAULT 0;

-- ---------- 2) Update create_purchase_with_products to accept combined charge ----------
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
      COALESCE((_item->>'selling_price')::NUMERIC, 0)
    );
    _qty := GREATEST(1, COALESCE((_item->>'quantity')::INTEGER, 1));
    _cost := GREATEST(0, COALESCE((_item->>'unit_cost')::NUMERIC, 0));

    INSERT INTO public.purchase_items (purchase_id, product_id, quantity, unit_cost, line_total)
    VALUES (_purchase_id, _product_id, _qty, _cost, _qty * _cost);

    _subtotal := _subtotal + (_qty * _cost);
  END LOOP;

  UPDATE public.purchases SET subtotal = _subtotal, tax = 0, total = _subtotal WHERE id = _purchase_id;
  RETURN _purchase_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.create_purchase_with_products(UUID, TEXT, DATE, TEXT, JSONB, NUMERIC) TO authenticated;

-- ---------- 3) Update update_purchase_with_products to accept combined charge ----------
CREATE OR REPLACE FUNCTION public.update_purchase_with_products(
  _purchase_id UUID,
  _supplier_id UUID,
  _invoice_no TEXT,
  _purchase_date DATE,
  _notes TEXT,
  _items JSONB,
  _purchase_packing_freight_charge NUMERIC DEFAULT 0
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid UUID := auth.uid();
  _item JSONB;
  _linked_pid UUID;
  _product_id UUID;
  _qty INTEGER;
  _cost NUMERIC(10,2);
  _subtotal NUMERIC(12,2) := 0;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (public.has_role(_uid, 'admin') OR public.has_role(_uid, 'staff')) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.purchases
    SET supplier_id = _supplier_id,
        invoice_no = NULLIF(btrim(_invoice_no), ''),
        purchase_date = COALESCE(_purchase_date, CURRENT_DATE),
        notes = _notes,
        purchase_packing_freight_charge = COALESCE(_purchase_packing_freight_charge, 0)
    WHERE id = _purchase_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase not found'; END IF;

  -- Remove old lines first — the AFTER DELETE trigger reverses the previously
  -- added stock for those lines in the same transaction.
  DELETE FROM public.purchase_items WHERE purchase_id = _purchase_id;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    -- Only treat product_id as linked when it is a well-formed UUID.
    _linked_pid := CASE
      WHEN _item->>'product_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN (_item->>'product_id')::UUID
      ELSE NULL END;

    -- Reuse the linked product when the line came from an existing purchase.
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
            price          = COALESCE(NULLIF((_item->>'selling_price')::NUMERIC, 0), price)
        WHERE id = _linked_pid;
    ELSE
      -- Safety net for legacy clients that don't send product_id: when the line
      -- has no SKU, fall back to the newest product with the same name instead of
      -- blindly creating a duplicate.
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
              price          = COALESCE(NULLIF((_item->>'selling_price')::NUMERIC, 0), price)
          WHERE id = _linked_pid;
      ELSE
        _product_id := public.match_or_create_product(
          COALESCE(_item->>'name', '')::TEXT,
          COALESCE(_item->>'sku', '')::TEXT,
          NULLIF(_item->>'category_id', '')::UUID,
          NULLIF(_item->>'brand_id', '')::UUID,
          COALESCE(_item->>'color', '')::TEXT,
          COALESCE(_item->>'size', '')::TEXT,
          COALESCE((_item->>'unit_cost')::NUMERIC, 0),
          COALESCE((_item->>'selling_price')::NUMERIC, 0)
        );
      END IF;
    END IF;

    _qty := GREATEST(1, COALESCE((_item->>'quantity')::INTEGER, 1));
    _cost := GREATEST(0, COALESCE((_item->>'unit_cost')::NUMERIC, 0));

    INSERT INTO public.purchase_items (purchase_id, product_id, quantity, unit_cost, line_total)
    VALUES (_purchase_id, _product_id, _qty, _cost, _qty * _cost);

    _subtotal := _subtotal + (_qty * _cost);
  END LOOP;

  UPDATE public.purchases SET subtotal = _subtotal, tax = 0, total = _subtotal WHERE id = _purchase_id;
  RETURN TRUE;
END; $$;
GRANT EXECUTE ON FUNCTION public.update_purchase_with_products(UUID, UUID, TEXT, DATE, TEXT, JSONB, NUMERIC) TO authenticated;
