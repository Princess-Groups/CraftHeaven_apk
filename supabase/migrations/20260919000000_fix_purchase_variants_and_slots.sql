-- ============================================================
-- Fix purchase color/variant + slot persistence
-- Migration: 20260919000000_fix_purchase_variants_and_slots.sql
-- ============================================================
-- 0) Schema + trigger hardening for purchase_items slots
-- ============================================================
-- purchase_items was created WITHOUT a created_at column, but the
-- trigger function update_slot_calculations() (20260906000000) orders
-- slot items by purchase_items.created_at to decide which item gets the
-- rounding remainder. Any UPDATE on a slotted purchase_items row (e.g. the
-- backfill below, or re-saving a purchase) therefore failed with
-- 42703: column "created_at" does not exist.
--
-- The function also re-ran UPDATEs on purchase_items from inside its own
-- AFTER ROW trigger, so as soon as it had to actually redistribute charges
-- (slot row already present) it recursed infinitely until the statement
-- errored. Those UPDATEs are now guarded with IS DISTINCT FROM so that
-- once a row's charge is already correct nothing re-triggers, which makes
-- the recalculation self-terminating. Target values depend only on
-- (total_slot_charge, product_count), so they are fixed points and cannot
-- oscillate.
ALTER TABLE public.purchase_items
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.update_slot_calculations()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _purchase_id UUID;
  _slot_number TEXT;
  _total_charge NUMERIC(12,2);
  _product_count INTEGER;
  _per_product NUMERIC(12,2);
  _remainder NUMERIC(12,2);
BEGIN
  -- Get the purchase_id and slot from the affected row
  IF TG_OP = 'DELETE' THEN
    _purchase_id := OLD.purchase_id;
    _slot_number := OLD.slot_number;
  ELSE
    _purchase_id := NEW.purchase_id;
    _slot_number := NEW.slot_number;
  END IF;

  IF _slot_number IS NULL OR _slot_number = '' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  -- Get the total slot charge from the purchase_slots table
  SELECT total_slot_charge INTO _total_charge
  FROM public.purchase_slots
  WHERE purchase_id = _purchase_id AND slot_number = _slot_number;

  IF NOT FOUND OR _total_charge IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  -- Count products in this slot
  SELECT COUNT(*) INTO _product_count
  FROM public.purchase_items
  WHERE purchase_id = _purchase_id AND slot_number = _slot_number;

  IF _product_count = 0 THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  -- Calculate per-product charge with proper rounding
  _per_product := ROUND(_total_charge / _product_count, 2);
  _remainder := _total_charge - (_per_product * (_product_count - 1));

  -- Update the purchase_slots record
  UPDATE public.purchase_slots
  SET product_count = _product_count,
      per_product_charge = _per_product,
      updated_at = now()
  WHERE purchase_id = _purchase_id AND slot_number = _slot_number;

  -- Update all purchase_items in this slot with the new per-product charge.
  -- The last item gets the remainder to preserve exact total.
  -- IS DISTINCT FROM guards stop re-triggering once values are settled.
  UPDATE public.purchase_items
  SET slot_charge_per_product = _per_product
  WHERE purchase_id = _purchase_id
    AND slot_number = _slot_number
    AND id NOT IN (
      SELECT id FROM public.purchase_items
      WHERE purchase_id = _purchase_id AND slot_number = _slot_number
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    )
    AND slot_charge_per_product IS DISTINCT FROM _per_product;

  -- Last item gets the remainder
  UPDATE public.purchase_items
  SET slot_charge_per_product = _remainder
  WHERE purchase_id = _purchase_id
    AND slot_number = _slot_number
    AND id = (
      SELECT id FROM public.purchase_items
      WHERE purchase_id = _purchase_id AND slot_number = _slot_number
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    )
    AND slot_charge_per_product IS DISTINCT FROM _remainder;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;
GRANT EXECUTE ON FUNCTION public.update_slot_calculations() TO authenticated;

-- ============================================================
-- 1) merge_color_variations now keeps color_code, quantity, sold, remaining
-- 2) create_purchase_with_products stores color_variations, unit,
--    slot_number and slot_charge_per_product
-- 3) update_purchase_with_products does the same
-- ============================================================

-- ---------- 1) Smarter merge_color_variations ----------
-- Repeated purchases must not lose variant quantities, colour codes or photos.
CREATE OR REPLACE FUNCTION public.merge_color_variations(_current JSONB, _incoming JSONB)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  _out JSONB := COALESCE(_current, '[]'::jsonb);
  _v JSONB;
  _color TEXT;
  _i INT;
  _found BOOLEAN;
  _n NUMERIC;
BEGIN
  FOR _v IN SELECT * FROM jsonb_array_elements(COALESCE(_incoming, '[]'::jsonb)) LOOP
    _color := COALESCE(_v->>'color', '');
    IF _color = '' THEN CONTINUE; END IF;
    _i := 0;
    _found := false;
    WHILE _i < jsonb_array_length(_out) LOOP
      IF COALESCE(_out->_i->>'color', '') = _color THEN
        IF NULLIF(btrim(COALESCE(_v->>'image_url', '')), '') IS NOT NULL THEN
          _out := jsonb_set(_out, ARRAY[_i::text, 'image_url'], to_jsonb(_v->>'image_url'));
        END IF;
        IF NULLIF(btrim(COALESCE(_v->>'color_code', '')), '') IS NOT NULL THEN
          _out := jsonb_set(_out, ARRAY[_i::text, 'color_code'], to_jsonb(_v->>'color_code'));
        END IF;
        IF (_v->>'quantity') IS NOT NULL THEN
          _n := COALESCE((_v->>'quantity')::NUMERIC, 0);
          _out := jsonb_set(_out, ARRAY[_i::text, 'quantity'], to_jsonb(_n));
        END IF;
        -- sold is preserved unless an explicitly positive value arrives
        IF COALESCE((_v->>'sold')::NUMERIC, 0) > 0 THEN
          _out := jsonb_set(_out, ARRAY[_i::text, 'sold'], to_jsonb(COALESCE((_v->>'sold')::NUMERIC, 0)));
        END IF;
        IF (_v->>'remaining') IS NOT NULL THEN
          _out := jsonb_set(_out, ARRAY[_i::text, 'remaining'], to_jsonb(COALESCE((_v->>'remaining')::NUMERIC, 0)));
        END IF;
        _found := true;
        EXIT;
      END IF;
      _i := _i + 1;
    END LOOP;
    IF NOT _found THEN
      _out := _out || jsonb_build_array(jsonb_build_object(
        'color', _color,
        'color_code', COALESCE(_v->>'color_code', ''),
        'image_url', COALESCE(_v->>'image_url', ''),
        'quantity', COALESCE((_v->>'quantity')::NUMERIC, 0),
        'sold', COALESCE((_v->>'sold')::NUMERIC, 0),
        'remaining', COALESCE((_v->>'remaining')::NUMERIC, 0)
      ));
    END IF;
  END LOOP;
  RETURN _out;
END;
$$;
GRANT EXECUTE ON FUNCTION public.merge_color_variations(JSONB, JSONB) TO authenticated;
-- match_or_create_product stays as-is: it already merges via merge_color_variations.

-- ---------- 2) Fixed create_purchase_with_products ----------
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

-- ---------- 3) Fixed update_purchase_with_products ----------
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
  _unitv TEXT;
  _vars JSONB;
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

  DELETE FROM public.purchase_items WHERE purchase_id = _purchase_id;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _linked_pid := CASE
      WHEN _item->>'product_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN (_item->>'product_id')::UUID
      ELSE NULL END;

    _unitv := COALESCE(NULLIF(btrim(COALESCE(_item->>'unit', '')), ''), 'Nos');
    _vars := CASE WHEN jsonb_typeof(_item->'color_variations') = 'array' THEN _item->'color_variations' ELSE NULL END;

    IF _linked_pid IS NOT NULL AND EXISTS (SELECT 1 FROM public.products WHERE id = _linked_pid) THEN
      _product_id := _linked_pid;
      UPDATE public.products
        SET name           = COALESCE(NULLIF(btrim(COALESCE(_item->>'name','')), ''), name),
            sku            = COALESCE(NULLIF(btrim(COALESCE(_item->>'sku','')), ''), sku),
            category_id    = COALESCE(NULLIF(_item->>'category_id','')::UUID, category_id),
            brand_id       = COALESCE(NULLIF(_item->>'brand_id','')::UUID, brand_id),
            color          = COALESCE(NULLIF(btrim(COALESCE(_item->>'color','')), ''), color),
            size           = COALESCE(NULLIF(btrim(COALESCE(_item->>'size','')), ''), size),
            unit           = COALESCE(_unitv, unit),
            purchase_price = COALESCE(NULLIF((_item->>'unit_cost')::NUMERIC, 0), purchase_price),
            price          = COALESCE(NULLIF((_item->>'selling_price')::NUMERIC, 0), price),
            material       = COALESCE(NULLIF(btrim(COALESCE(_item->>'material','')), ''), material)
        WHERE id = _linked_pid;
      IF _vars IS NOT NULL THEN
        UPDATE public.products SET color_variations = public.merge_color_variations(color_variations, _vars) WHERE id = _linked_pid;
      END IF;
    ELSE
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
              unit           = COALESCE(_unitv, unit),
              purchase_price = COALESCE(NULLIF((_item->>'unit_cost')::NUMERIC, 0), purchase_price),
              price          = COALESCE(NULLIF((_item->>'selling_price')::NUMERIC, 0), price),
              material       = COALESCE(NULLIF(btrim(COALESCE(_item->>'material','')), ''), material)
          WHERE id = _linked_pid;
        IF _vars IS NOT NULL THEN
          UPDATE public.products SET color_variations = public.merge_color_variations(color_variations, _vars) WHERE id = _linked_pid;
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
          _vars,
          _unitv,
          COALESCE(_item->>'material', '')::TEXT
        );
      END IF;
    END IF;

    _qty := GREATEST(1, COALESCE((_item->>'quantity')::INTEGER, 1));
    _cost := GREATEST(0, COALESCE((_item->>'unit_cost')::NUMERIC, 0));

    INSERT INTO public.purchase_items (purchase_id, product_id, quantity, unit_cost, line_total, unit, slot_number, slot_charge_per_product)
    VALUES (_purchase_id, _product_id, _qty, _cost, _qty * _cost, _unitv,
            NULLIF(_item->>'slot_number', ''),
            GREATEST(0, COALESCE((_item->>'slot_charge_per_product')::NUMERIC, 0)));

    _subtotal := _subtotal + (_qty * _cost);
  END LOOP;

  UPDATE public.purchases SET subtotal = _subtotal, tax = 0, total = _subtotal WHERE id = _purchase_id;
  RETURN TRUE;
END; $$;
GRANT EXECUTE ON FUNCTION public.update_purchase_with_products(UUID, UUID, TEXT, DATE, TEXT, JSONB, NUMERIC) TO authenticated;

-- Backfill: tag existing purchase_items with the slot UUIDs recorded on purchase_slots
-- (old rows were written with NULL slot_number, which breaks label batches).
UPDATE public.purchase_items pi
SET slot_number = ps.slot_number::text
FROM public.purchase_slots ps
WHERE pi.purchase_id = ps.purchase_id
  AND pi.slot_number IS NULL;