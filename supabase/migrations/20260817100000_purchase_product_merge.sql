-- ============================================================================
-- 2026-08-17 — Purchase ⇄ Product merged workflow
-- ----------------------------------------------------------------------------
-- Adds:
--   1. `color` / `size` variant columns on products (for the merged purchase
--      form: Color + Size/Variant fields).
--   2. `revert_purchase_stock` AFTER DELETE trigger on purchase_items so that
--      deleting (or editing, via replace) a purchase reverses stock correctly.
--   3. `match_or_create_product` helper — matches an existing product by SKU
--      (never duplicates) or creates a new product from the purchase line.
--   4. `create_purchase_with_products` / `update_purchase_with_products` RPCs —
--      a single atomic call that records the purchase, auto-creates/updates the
--      product and adds stock in one transaction.
--   5. `delete_purchase_with_stock_reversal` RPC — deletes a purchase and its
--      lines; the DELETE trigger reverses the stock.
--
-- The S.No. serial numbers are display-only (row_number in the UI) and are NOT
-- stored in the database — the database record IDs are used internally.
-- ============================================================================

-- ---------- 1) Product variant columns ----------
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS color TEXT,
  ADD COLUMN IF NOT EXISTS size TEXT;

-- ---------- 2) Revert stock when a purchase item is removed ----------
-- Uses GREATEST(0, …) because products.stock has a CHECK (stock >= 0)
-- constraint — if part of the purchased quantity has since been sold, the
-- reversal clamps at 0 instead of violating the constraint.
CREATE OR REPLACE FUNCTION public.revert_purchase_stock() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _new_stock INTEGER;
BEGIN
  SELECT GREATEST(0, stock - OLD.quantity) INTO _new_stock FROM public.products WHERE id = OLD.product_id;
  IF FOUND THEN
    UPDATE public.products
      SET stock = _new_stock,
          is_available = CASE WHEN _new_stock > 0 THEN is_available ELSE false END
      WHERE id = OLD.product_id;
  END IF;
  RETURN OLD;
END; $$;
DROP TRIGGER IF EXISTS trg_revert_purchase_stock ON public.purchase_items;
CREATE TRIGGER trg_revert_purchase_stock AFTER DELETE ON public.purchase_items
  FOR EACH ROW EXECUTE FUNCTION public.revert_purchase_stock();

-- ---------- 3) Match existing product by SKU, or create a new one ----------
CREATE OR REPLACE FUNCTION public.match_or_create_product(
  _name TEXT,
  _sku TEXT,
  _category_id UUID,
  _brand_id UUID,
  _color TEXT,
  _size TEXT,
  _purchase_price NUMERIC,
  _selling_price NUMERIC
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _id UUID;
  _slug TEXT;
  _base TEXT;
  _i INT;
BEGIN
  -- Match by SKU first — repeated purchases of the same SKU must never
  -- create a duplicate product. Also fall back to barcode (some legacy products
  -- only carry a barcode, carrying e.g. "CS1001"). The purchase "Product Code /
  -- SKU" field is matched against both.
  IF _sku IS NOT NULL AND btrim(_sku) <> '' THEN
    SELECT id INTO _id FROM public.products
      WHERE sku = btrim(_sku) OR barcode = btrim(_sku)
      LIMIT 1;
    IF FOUND THEN
      UPDATE public.products
        SET name          = COALESCE(NULLIF(btrim(_name), ''), name),
            category_id   = COALESCE(_category_id, category_id),
            brand_id      = COALESCE(_brand_id, brand_id),
            color         = COALESCE(NULLIF(btrim(_color), ''), color),
            size          = COALESCE(NULLIF(btrim(_size), ''), size),
            purchase_price = COALESCE(NULLIF(_purchase_price, 0), purchase_price),
            price         = COALESCE(NULLIF(_selling_price, 0), price)
        WHERE id = _id;
      RETURN _id;
    END IF;
  END IF;

  -- No SKU match — create a brand-new product with a unique slug.
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
    price, purchase_price, stock, is_available,
    description
  ) VALUES (
    COALESCE(NULLIF(btrim(_name), ''), 'Untitled product'),
    _slug,
    NULLIF(btrim(_sku), ''),
    _category_id, _brand_id,
    NULLIF(btrim(_color), ''), NULLIF(btrim(_size), ''),
    COALESCE(NULLIF(_selling_price, 0), _purchase_price, 0),
    COALESCE(NULLIF(_purchase_price, 0), NULL),
    0, true,
    'Created automatically from a purchase entry.'
  )
  RETURNING id INTO _id;

  -- Stock is added by trg_apply_purchase_stock when the purchase line is
  -- inserted, so we leave stock = 0 here.
  RETURN _id;
END; $$;
GRANT EXECUTE ON FUNCTION public.match_or_create_product(TEXT, TEXT, UUID, UUID, TEXT, TEXT, NUMERIC, NUMERIC) TO authenticated;

-- ---------- 4) Create purchase + auto-create/update product + add stock ------
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
  _subtotal NUMERIC(12,2) := 0;
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
GRANT EXECUTE ON FUNCTION public.create_purchase_with_products(UUID, TEXT, DATE, TEXT, JSONB) TO authenticated;

-- ---------- 5) Edit purchase (same record) + recalc stock -------------------
-- Each item may carry an optional `product_id` — the product currently linked
-- to that purchase line. When present we reuse that exact product (updating its
-- fields) so that products created without a SKU are never duplicated on edit.
-- New lines (no product_id) fall back to SKU match-or-create.
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
        notes = _notes
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
GRANT EXECUTE ON FUNCTION public.update_purchase_with_products(UUID, UUID, TEXT, DATE, TEXT, JSONB) TO authenticated;

-- ---------- 6) Delete purchase + reverse stock ------------------------------
CREATE OR REPLACE FUNCTION public.delete_purchase_with_stock_reversal(_purchase_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid UUID := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (public.has_role(_uid, 'admin') OR public.has_role(_uid, 'staff')) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Cascade deletes purchase_items, which fires trg_revert_purchase_stock and
  -- subtracts the purchased quantity back out of stock.
  DELETE FROM public.purchases WHERE id = _purchase_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase not found'; END IF;
  RETURN TRUE;
END; $$;
GRANT EXECUTE ON FUNCTION public.delete_purchase_with_stock_reversal(UUID) TO authenticated;