-- Add material column to products table
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS material TEXT;

-- Add material parameter to match_or_create_product
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
  _color_variations JSONB DEFAULT NULL,
  _unit TEXT DEFAULT NULL,
  _material TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _id UUID;
  _slug TEXT;
  _base TEXT;
  _i INT;
  _u TEXT;
BEGIN
  _u := NULLIF(btrim(COALESCE(_unit, '')), '');
  _u := CASE lower(_u)
        WHEN 'kilogram' THEN 'KG' WHEN 'kilograms' THEN 'KG' WHEN 'kg' THEN 'KG'
        WHEN 'gram' THEN 'G' WHEN 'grams' THEN 'G' WHEN 'g' THEN 'G'
        WHEN 'litre' THEN 'L' WHEN 'litres' THEN 'L' WHEN 'liter' THEN 'L' WHEN 'l' THEN 'L'
        WHEN 'millilitre' THEN 'ML' WHEN 'millilitres' THEN 'ML' WHEN 'milliliter' THEN 'ML' WHEN 'ml' THEN 'ML'
        WHEN 'meter' THEN 'M' WHEN 'metre' THEN 'M' WHEN 'metres' THEN 'M' WHEN 'm' THEN 'M'
        WHEN 'centimeter' THEN 'CM' WHEN 'centimetre' THEN 'CM' WHEN 'centimetres' THEN 'CM' WHEN 'cm' THEN 'CM'
        WHEN 'nos' THEN 'Nos' WHEN 'number' THEN 'Nos' WHEN 'pieces' THEN 'Nos' WHEN 'pcs' THEN 'Nos'
        ELSE _u END;

  IF _sku IS NOT NULL AND btrim(_sku) <> '' THEN
    SELECT id INTO _id FROM public.products
      WHERE sku = btrim(_sku) OR barcode = btrim(_sku)
      LIMIT 1;
    IF FOUND THEN
      UPDATE public.products
        SET name           = COALESCE(NULLIF(btrim(_name), ''), name),
            category_id    = COALESCE(_category_id, category_id),
            brand_id       = COALESCE(_brand_id, brand_id),
            color          = COALESCE(NULLIF(btrim(_color), ''), color),
            size           = COALESCE(NULLIF(btrim(_size), ''), size),
            unit           = COALESCE(_u, unit),
            purchase_price = COALESCE(NULLIF(_purchase_price, 0), purchase_price),
            price          = COALESCE(NULLIF(_selling_price, 0), price),
            gst_rate       = COALESCE(NULLIF(_cgst_rate + _sgst_rate, 0), gst_rate),
            cgst_rate      = COALESCE(NULLIF(_cgst_rate, 0), cgst_rate),
            sgst_rate      = COALESCE(NULLIF(_sgst_rate, 0), sgst_rate),
            igst_rate      = COALESCE(NULLIF(_igst_rate, 0), igst_rate),
            material       = COALESCE(NULLIF(btrim(_material), ''), material)
        WHERE id = _id;

      IF _image_url IS NOT NULL AND btrim(_image_url) <> ''
        AND NOT (_id IN (
            SELECT p2.id FROM public.products p2
            WHERE p2.id = _id AND ARRAY[btrim(_image_url)] <@ COALESCE(p2.image_urls, '{}')
        )) THEN
        UPDATE public.products
          SET image_urls = array_append(COALESCE(image_urls, '{}'), btrim(_image_url))
          WHERE id = _id;
      END IF;

      IF _color_variations IS NOT NULL THEN
        UPDATE public.products
          SET color_variations = public.merge_color_variations(color_variations, _color_variations)
          WHERE id = _id;
      END IF;

      RETURN _id;
    END IF;
  END IF;

  _base := lower(regexp_replace(btrim(COALESCE(_name, 'product')), '[^a-z0-9]+', '-', 'g'));
  _base := btrim(_base, '-');
  IF _base = '' THEN _base := 'product'; END IF;
  _slug := _base;
  _i := 1;
  WHILE EXISTS (SELECT 1 FROM public.products WHERE slug = _slug) LOOP
    _i := _i + 1;
    _slug := _base || '-' || _i;
  END LOOP;

  INSERT INTO public.products (
    name, slug, sku, barcode, category_id, brand_id, color, size,
    purchase_price, price, unit, image_urls, gst_rate, cgst_rate, sgst_rate, igst_rate,
    color_variations, material
  ) VALUES (
    btrim(_name), _slug,
    NULLIF(btrim(_sku), ''), NULLIF(btrim(_sku), ''),
    _category_id, _brand_id,
    NULLIF(btrim(_color), ''), NULLIF(btrim(_size), ''),
    GREATEST(0, COALESCE(_purchase_price, 0)),
    GREATEST(0, COALESCE(_selling_price, 0)),
    COALESCE(_u, 'Nos'),
    CASE WHEN _image_url IS NOT NULL AND btrim(_image_url) <> '' THEN ARRAY[btrim(_image_url)] ELSE '{}' END,
    COALESCE(_cgst_rate, 0) + COALESCE(_sgst_rate, 0),
    COALESCE(_cgst_rate, 0), COALESCE(_sgst_rate, 0), COALESCE(_igst_rate, 0),
    COALESCE(_color_variations, '[]'::jsonb),
    NULLIF(btrim(_material), '')
  ) RETURNING id INTO _id;

  RETURN _id;
END; $$;

GRANT EXECUTE ON FUNCTION public.match_or_create_product(TEXT, TEXT, UUID, UUID, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC, NUMERIC, JSONB, TEXT, TEXT) TO authenticated;

-- Update create_purchase_with_products to pass material to match_or_create_product
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
      NULL, -- image_url
      NULL, -- cgst_rate
      NULL, -- sgst_rate
      NULL, -- igst_rate
      NULL, -- color_variations
      NULL, -- unit
      COALESCE(_item->>'material', '')::TEXT
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

-- Update update_purchase_with_products to pass material
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
            material       = COALESCE(NULLIF(btrim(COALESCE(_item->>'material','')), ''), material)
        WHERE id = _linked_pid;
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
              purchase_price = COALESCE(NULLIF((_item->>'unit_cost')::NUMERIC, 0), purchase_price),
              price          = COALESCE(NULLIF((_item->>'selling_price')::NUMERIC, 0), price),
              material       = COALESCE(NULLIF(btrim(COALESCE(_item->>'material','')), ''), material)
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
          COALESCE((_item->>'selling_price')::NUMERIC, 0),
          NULL, NULL, NULL, NULL, NULL, NULL,
          COALESCE(_item->>'material', '')::TEXT
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
