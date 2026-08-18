  -- ============================================================================
  -- 2026-08-19 — Quantity units, decimal inventory, WhatsApp API settings
  -- ----------------------------------------------------------------------------
  -- Builds on the existing billing/inventory model. No data is destroyed:
  --   • products.unit          — one canonical unit per product (Nos/KG/G/L/ML/M/CM)
  --   • products.stock         — widened INTEGER → NUMERIC(12,3) so decimal
  --                              quantities (0.25 KG, 0.5 L, 1.5 M) are supported.
  --   • carts/order_items/purchase_items.quantity — widened to NUMERIC(12,3).
  --   • purchase_items.unit / order_items.unit     — unit snapshot at purchase/sale.
  --   • convert_unit()         — same-metric conversions: 1 KG=1000 G, 1 L=1000 ML,
  --                              1 M=100 CM. Never mixes metric families.
  --   • whatsapp_settings      — admin-configurable WhatsApp Business API settings.
  --   • RPCs (match_or_create_product, create/update_purchase_with_products,
  --      place_order, apply_purchase_stock, revert_purchase_stock) upgraded to
  --      unit + decimal arithmetic.
  --
  -- Safe to re-run: ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE everywhere.
  -- ============================================================================

  -- +++++++++++ 1) PRODUCTS — unit + decimal stock +++++++++++
  ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS unit TEXT NOT NULL DEFAULT 'Nos';

  -- The notify_low_stock trigger depends on the stock column, which blocks a
  -- column type change. Drop it first, widen stock, then recreate it exactly.
  DROP TRIGGER IF EXISTS trg_notify_low_stock ON public.products;

  -- Widen stock INTEGER → NUMERIC. Preserves all existing stock values.
  ALTER TABLE public.products
    ALTER COLUMN stock TYPE NUMERIC(12,3) USING stock::NUMERIC(12,3);
  ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_stock_check;
  ALTER TABLE public.products
    ADD CONSTRAINT products_stock_check CHECK (stock >= 0);

  CREATE TRIGGER trg_notify_low_stock AFTER UPDATE OF stock ON public.products
    FOR EACH ROW EXECUTE FUNCTION public.notify_low_stock();

  -- +++++++++++ 2) CARTS — decimal quantity +++++++++++
  ALTER TABLE public.carts DROP CONSTRAINT IF EXISTS carts_quantity_check;
  ALTER TABLE public.carts
    ALTER COLUMN quantity TYPE NUMERIC(12,3) USING quantity::NUMERIC(12,3);
  ALTER TABLE public.carts
    ADD CONSTRAINT carts_quantity_check CHECK (quantity > 0);

  -- +++++++++++ 3) PURCHASE ITEMS — decimal quantity + unit snapshot +++++++++++
  ALTER TABLE public.purchase_items DROP CONSTRAINT IF EXISTS purchase_items_quantity_check;
  ALTER TABLE public.purchase_items
    ALTER COLUMN quantity TYPE NUMERIC(12,3) USING quantity::NUMERIC(12,3);
  ALTER TABLE public.purchase_items
    ADD CONSTRAINT purchase_items_quantity_check CHECK (quantity > 0);
  ALTER TABLE public.purchase_items
    ADD COLUMN IF NOT EXISTS unit TEXT NOT NULL DEFAULT 'Nos';

  -- +++++++++++ 4) ORDER ITEMS — decimal quantity + unit snapshot +++++++++++
  ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_quantity_check;
  ALTER TABLE public.order_items
    ALTER COLUMN quantity TYPE NUMERIC(12,3) USING quantity::NUMERIC(12,3);
  ALTER TABLE public.order_items
    ADD CONSTRAINT order_items_quantity_check CHECK (quantity > 0);
  ALTER TABLE public.order_items
    ADD COLUMN IF NOT EXISTS unit TEXT NOT NULL DEFAULT 'Nos';

  -- +++++++++++ 5) UNIT CONVERSION (same-metric only) +++++++++++
  -- Returns the amount expressed in the "to" unit, or 0 when the units belong to
  -- different metric families (KG ↔ G | L ↔ ML | M ↔ CM are convertible; anything
  -- else is not and the caller should treat it as an invalid conversion).
  CREATE OR REPLACE FUNCTION public.convert_unit(_amount NUMERIC, _from TEXT, _to TEXT)
  RETURNS NUMERIC(12,3)
  LANGUAGE plpgsql IMMUTABLE AS $$
  DECLARE
    _f TEXT := lower(btrim(COALESCE(_from, '')));
    _t TEXT := lower(btrim(COALESCE(_to, '')));
  BEGIN
    IF _f = _t THEN RETURN COALESCE(_amount, 0);
    END IF;
    -- KG family
    IF    _f IN ('kg','kilogram','kilograms')  AND _t IN ('g','gram','grams')  THEN RETURN COALESCE(_amount, 0) * 1000;
    ELSIF _f IN ('g','gram','grams')           AND _t IN ('kg','kilogram','kilograms') THEN RETURN COALESCE(_amount, 0) / 1000;
    -- Litre family
    ELSIF _f IN ('l','litre','litres','liter') AND _t IN ('ml','millilitre','millilitres','milliliter') THEN RETURN COALESCE(_amount, 0) * 1000;
    ELSIF _f IN ('ml','millilitre','millilitres','milliliter') AND _t IN ('l','litre','litres','liter') THEN RETURN COALESCE(_amount, 0) / 1000;
    -- Metre family
    ELSIF _f IN ('m','meter','metre','metres') AND _t IN ('cm','centimeter','centimetre','centimetres') THEN RETURN COALESCE(_amount, 0) * 100;
    ELSIF _f IN ('cm','centimeter','centimetre','centimetres') AND _t IN ('m','meter','metre','metres')  THEN RETURN COALESCE(_amount, 0) / 100;
    END IF;
    RETURN 0;
  END; $$;
  GRANT EXECUTE ON FUNCTION public.convert_unit(NUMERIC, TEXT, TEXT) TO authenticated;

  -- +++++++++++ 6) WHATSAPP SETTINGS (single row, admin-configurable) +++++++++++
  CREATE TABLE IF NOT EXISTS public.whatsapp_settings (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    phone_number_id TEXT,
    business_account_id TEXT,
    access_token TEXT,
    webhook_verify_token TEXT,
    api_version TEXT NOT NULL DEFAULT 'v20.0',
    webhook_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  GRANT SELECT, INSERT, UPDATE ON public.whatsapp_settings TO authenticated;
  GRANT ALL ON public.whatsapp_settings TO service_role;
  ALTER TABLE public.whatsapp_settings ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "whatsapp_settings admin read" ON public.whatsapp_settings;
  CREATE POLICY "whatsapp_settings admin read" ON public.whatsapp_settings
    FOR SELECT TO authenticated
    USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));
  DROP POLICY IF EXISTS "whatsapp_settings admin write" ON public.whatsapp_settings;
  CREATE POLICY "whatsapp_settings admin write" ON public.whatsapp_settings
    FOR ALL TO authenticated
    USING (public.has_role(auth.uid(), 'admin'))
    WITH CHECK (public.has_role(auth.uid(), 'admin'));
  -- Seed the single row so the admin config page can always upsert against it.
  INSERT INTO public.whatsapp_settings (id)
  VALUES (1)
  ON CONFLICT (id) DO NOTHING;

  -- +++++++++++ 7) apply_purchase_stock — decimal + unit-aware +++++++++++
  -- Adds a purchased quantity (in the product's unit) to stock. When the purchase
  -- line carries a unit different from the product's current unit but within the
  -- same metric family, the quantity is converted first (e.g. buy 500 g into a KG
  -- product → +0.5 KG).
  CREATE OR REPLACE FUNCTION public.apply_purchase_stock() RETURNS TRIGGER
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
  DECLARE
    _qty NUMERIC(12,3);
  BEGIN
    _qty := NEW.quantity;
    IF btrim(NEW.unit) IS NOT NULL AND NEW.unit <> '' AND NEW.unit IS DISTINCT FROM (SELECT COALESCE(unit,'Nos') FROM public.products WHERE id = NEW.product_id) THEN
      _qty := public.convert_unit(NEW.quantity, NEW.unit,
                (SELECT COALESCE(unit,'Nos') FROM public.products WHERE id = NEW.product_id));
      IF _qty IS NULL OR _qty = 0 THEN _qty := NEW.quantity; END IF; -- non-convertible → treat as same unit
    END IF;
    UPDATE public.products
      SET stock = COALESCE(stock,0) + COALESCE(_qty, NEW.quantity),
          is_available = COALESCE(stock,0) + COALESCE(_qty, NEW.quantity) > 0,
          unit = NEW.unit,
          purchase_price = COALESCE(NEW.unit_cost, purchase_price)
      WHERE id = NEW.product_id;
    RETURN NEW;
  END; $$;
  DROP TRIGGER IF EXISTS trg_apply_purchase_stock ON public.purchase_items;
  CREATE TRIGGER trg_apply_purchase_stock AFTER INSERT ON public.purchase_items
    FOR EACH ROW EXECUTE FUNCTION public.apply_purchase_stock();

  -- +++++++++++ 8) revert_purchase_stock — decimal reversal +++++++++++
  CREATE OR REPLACE FUNCTION public.revert_purchase_stock() RETURNS TRIGGER
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
  DECLARE
    _new_stock NUMERIC(12,3);
    _qty NUMERIC(12,3);
  BEGIN
    _qty := OLD.quantity;
    IF btrim(OLD.unit) IS NOT NULL AND OLD.unit <> '' AND OLD.unit IS DISTINCT FROM (SELECT COALESCE(unit,'Nos') FROM public.products WHERE id = OLD.product_id) THEN
      _qty := public.convert_unit(OLD.quantity, OLD.unit,
                (SELECT COALESCE(unit,'Nos') FROM public.products WHERE id = OLD.product_id));
      IF _qty IS NULL OR _qty = 0 THEN _qty := OLD.quantity; END IF;
    END IF;
    SELECT GREATEST(0, COALESCE(stock,0) - COALESCE(_qty, OLD.quantity)) INTO _new_stock FROM public.products WHERE id = OLD.product_id;
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

  -- +++++++++++ 9) match_or_create_product — unit-aware +++++++++++
  -- Adds a `_unit` argument. Products keep purchase (cost) and selling prices
  -- independent; photo/variations/GST merging logic is unchanged.
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
    _unit TEXT DEFAULT NULL
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
              igst_rate      = COALESCE(NULLIF(_igst_rate, 0), igst_rate)
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
      _slug := _base || '-' || _i;
      _i := _i + 1;
    END LOOP;

    INSERT INTO public.products (
      name, slug, sku, category_id, brand_id, color, size,
      price, purchase_price, stock, is_available, description,
      image_urls, color_variations,
      gst_rate, cgst_rate, sgst_rate, igst_rate,
      unit
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
      COALESCE(_cgst_rate, 0), COALESCE(_sgst_rate, 0), COALESCE(_igst_rate, 0),
      COALESCE(_u, 'Nos')
    )
    RETURNING id INTO _id;

    RETURN _id;
  END; $$;
  GRANT EXECUTE ON FUNCTION public.match_or_create_product(TEXT, TEXT, UUID, UUID, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC, NUMERIC, JSONB, TEXT) TO authenticated;

  -- +++++++++++ 10) create_purchase_with_products — unit + decimal +++++++++++
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
    _qty NUMERIC(12,3);
    _cost NUMERIC(10,2);
    _cgst NUMERIC(10,2);
    _sgst NUMERIC(10,2);
    _igst NUMERIC(10,2);
    _line_tax NUMERIC(10,2);
    _subtotal NUMERIC(12,2) := 0;
    _tax_total NUMERIC(12,2) := 0;
    _unit TEXT;
  BEGIN
    IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
    IF NOT (public.has_role(_uid, 'admin') OR public.has_role(_uid, 'staff')) THEN
      RAISE EXCEPTION 'Not authorized';
    END IF;

    INSERT INTO public.purchases (supplier_id, invoice_no, purchase_date, notes, created_by)
    VALUES (_supplier_id, NULLIF(btrim(_invoice_no), ''), COALESCE(_purchase_date, CURRENT_DATE), _notes, _uid)
    RETURNING id INTO _purchase_id;

    FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
      _unit := NULLIF(btrim(COALESCE(_item->>'unit', '')), '');
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
        COALESCE(_item->'color_variations', '[]'::jsonb),
        _unit
      );
      _qty := GREATEST(0.001, COALESCE((_item->>'quantity')::NUMERIC, 1));
      _cost := GREATEST(0, COALESCE((_item->>'unit_cost')::NUMERIC, 0));
      _cgst := COALESCE((_item->>'cgst_rate')::NUMERIC, 0);
      _sgst := COALESCE((_item->>'sgst_rate')::NUMERIC, 0);
      _igst := COALESCE((_item->>'igst_rate')::NUMERIC, 0);
      _line_tax := _qty * _cost * (CASE WHEN _igst > 0 THEN _igst ELSE _cgst + _sgst END) / 100;
      _tax_total := _tax_total + _line_tax;

      INSERT INTO public.purchase_items (purchase_id, product_id, quantity, unit_cost, line_total, unit)
      VALUES (_purchase_id, _product_id, _qty, _cost, _qty * _cost, COALESCE(_unit, 'Nos'));

      _subtotal := _subtotal + (_qty * _cost);
    END LOOP;

    UPDATE public.purchases SET subtotal = _subtotal, tax = _tax_total, total = _subtotal + _tax_total WHERE id = _purchase_id;
    RETURN _purchase_id;
  END; $$;
  GRANT EXECUTE ON FUNCTION public.create_purchase_with_products(UUID, TEXT, DATE, TEXT, JSONB) TO authenticated;

  -- +++++++++++ 11) update_purchase_with_products — unit + decimal +++++++++++
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
    _qty NUMERIC(12,3);
    _cost NUMERIC(10,2);
    _cgst NUMERIC(10,2);
    _sgst NUMERIC(10,2);
    _igst NUMERIC(10,2);
    _line_tax NUMERIC(10,2);
    _subtotal NUMERIC(12,2) := 0;
    _tax_total NUMERIC(12,2) := 0;
    _unit TEXT;
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

    DELETE FROM public.purchase_items WHERE purchase_id = _purchase_id;

    FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
      _linked_pid := CASE
        WHEN _item->>'product_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        THEN (_item->>'product_id')::UUID
        ELSE NULL END;

      _unit := NULLIF(btrim(COALESCE(_item->>'unit', '')), '');

      IF _linked_pid IS NOT NULL AND EXISTS (SELECT 1 FROM public.products WHERE id = _linked_pid) THEN
        _product_id := _linked_pid;
        UPDATE public.products
          SET name           = COALESCE(NULLIF(btrim(COALESCE(_item->>'name','')), ''), name),
              sku            = COALESCE(NULLIF(btrim(COALESCE(_item->>'sku','')), ''), sku),
              category_id    = COALESCE(NULLIF(_item->>'category_id','')::UUID, category_id),
              brand_id       = COALESCE(NULLIF(_item->>'brand_id','')::UUID, brand_id),
              color          = COALESCE(NULLIF(btrim(COALESCE(_item->>'color','')), ''), color),
              size           = COALESCE(NULLIF(btrim(COALESCE(_item->>'size','')), ''), size),
              unit           = COALESCE(_unit, unit),
              purchase_price = COALESCE(NULLIF((_item->>'unit_cost')::NUMERIC, 0), purchase_price),
              price          = COALESCE(NULLIF((_item->>'selling_price')::NUMERIC, 0), price),
              gst_rate       = COALESCE(NULLIF(COALESCE((_item->>'cgst_rate')::NUMERIC,0) + COALESCE((_item->>'sgst_rate')::NUMERIC,0), 0), gst_rate),
              cgst_rate      = COALESCE(NULLIF(COALESCE((_item->>'cgst_rate')::NUMERIC,0), 0), cgst_rate),
              sgst_rate      = COALESCE(NULLIF(COALESCE((_item->>'sgst_rate')::NUMERIC,0), 0), sgst_rate),
              igst_rate      = COALESCE(NULLIF(COALESCE((_item->>'igst_rate')::NUMERIC,0), 0), igst_rate)
          WHERE id = _linked_pid;
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
                unit           = COALESCE(_unit, unit),
                purchase_price = COALESCE(NULLIF((_item->>'unit_cost')::NUMERIC, 0), purchase_price),
                price          = COALESCE(NULLIF((_item->>'selling_price')::NUMERIC, 0), price),
                gst_rate       = COALESCE(NULLIF(COALESCE((_item->>'cgst_rate')::NUMERIC,0) + COALESCE((_item->>'sgst_rate')::NUMERIC,0), 0), gst_rate),
                cgst_rate      = COALESCE(NULLIF(COALESCE((_item->>'cgst_rate')::NUMERIC,0), 0), cgst_rate),
                sgst_rate      = COALESCE(NULLIF(COALESCE((_item->>'sgst_rate')::NUMERIC,0), 0), sgst_rate),
                igst_rate      = COALESCE(NULLIF(COALESCE((_item->>'igst_rate')::NUMERIC,0), 0), igst_rate)
            WHERE id = _linked_pid;
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
            COALESCE(_item->'color_variations', '[]'::jsonb),
            _unit
          );
        END IF;
      END IF;

      _qty := GREATEST(0.001, COALESCE((_item->>'quantity')::NUMERIC, 1));
      _cost := GREATEST(0, COALESCE((_item->>'unit_cost')::NUMERIC, 0));
      _cgst := COALESCE((_item->>'cgst_rate')::NUMERIC, 0);
      _sgst := COALESCE((_item->>'sgst_rate')::NUMERIC, 0);
      _igst := COALESCE((_item->>'igst_rate')::NUMERIC, 0);
      _line_tax := _qty * _cost * (CASE WHEN _igst > 0 THEN _igst ELSE _cgst + _sgst END) / 100;
      _tax_total := _tax_total + _line_tax;

      INSERT INTO public.purchase_items (purchase_id, product_id, quantity, unit_cost, line_total, unit)
      VALUES (_purchase_id, _product_id, _qty, _cost, _qty * _cost, COALESCE(_unit, 'Nos'));

      _subtotal := _subtotal + (_qty * _cost);
    END LOOP;

    UPDATE public.purchases SET subtotal = _subtotal, tax = _tax_total, total = _subtotal + _tax_total WHERE id = _purchase_id;
    RETURN TRUE;
  END; $$;
  GRANT EXECUTE ON FUNCTION public.update_purchase_with_products(UUID, UUID, TEXT, DATE, TEXT, JSONB) TO authenticated;

  -- +++++++++++ 12) place_order — decimal quantities + unit snapshot +++++++++++
  -- Quantities are numeric (decimal) and recorded with the product's unit. The
  -- stock deduction is decimal and unit-consistent.
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
      CASE WHEN _channel = 'IN_STORE' AND _payment_method IN ('CASH','CARD','UPI') THEN 'PAID' ELSE 'PENDING' END
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