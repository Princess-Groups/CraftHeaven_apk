-- ============================================================
-- CLEAN FIX: Label Printing — drop & recreate everything
-- Migration: 20260915020000_label_printing_fix_all.sql
-- Run this single migration to fix all label printing issues.
-- ============================================================

-- ---------- Drop old objects ----------
DROP POLICY IF EXISTS "label_batches_admin_all" ON public.label_batches;
DROP POLICY IF EXISTS "label_batches_auth_all" ON public.label_batches;
DROP POLICY IF EXISTS "label_batch_items_admin_all" ON public.label_batch_items;
DROP POLICY IF EXISTS "label_batch_items_auth_all" ON public.label_batch_items;
DROP POLICY IF EXISTS "label_print_history_admin_all" ON public.label_print_history;
DROP POLICY IF EXISTS "label_print_history_auth_all" ON public.label_print_history;
DROP FUNCTION IF EXISTS public.create_label_batch_for_slot(UUID);
DROP FUNCTION IF EXISTS public.update_label_item_quantity(UUID, INTEGER);
DROP FUNCTION IF EXISTS public.mark_labels_printed(UUID, UUID[], INTEGER[]);
DROP FUNCTION IF EXISTS public.get_slot_label_summary(UUID);
DROP TABLE IF EXISTS public.label_print_history;
DROP TABLE IF EXISTS public.label_batch_items;
DROP TABLE IF EXISTS public.label_batches;

-- ---------- 1) label_batches ----------
CREATE TABLE public.label_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id UUID NOT NULL REFERENCES public.slots(id) ON DELETE CASCADE,
  slot_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_printed',
  total_labels_required INTEGER NOT NULL DEFAULT 0,
  total_labels_printed INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- 2) label_batch_items ----------
CREATE TABLE public.label_batch_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.label_batches(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  barcode TEXT,
  purchase_quantity INTEGER NOT NULL DEFAULT 0,
  labels_to_print INTEGER NOT NULL DEFAULT 0,
  labels_printed INTEGER NOT NULL DEFAULT 0,
  unit_price NUMERIC(12,2) DEFAULT 0,
  selling_price NUMERIC(12,2) DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- 3) label_print_history ----------
CREATE TABLE public.label_print_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.label_batches(id) ON DELETE CASCADE,
  item_id UUID REFERENCES public.label_batch_items(id) ON DELETE SET NULL,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  barcode TEXT,
  quantity_printed INTEGER NOT NULL DEFAULT 0,
  printed_by UUID REFERENCES auth.users(id),
  printed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT
);

-- ---------- 4) RLS — wide open for authenticated ----------
ALTER TABLE public.label_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.label_batch_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.label_print_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lbl_batch_open" ON public.label_batches FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "lbl_items_open" ON public.label_batch_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "lbl_history_open" ON public.label_print_history FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---------- 5) RPC: create_label_batch_for_slot ----------
CREATE OR REPLACE FUNCTION public.create_label_batch_for_slot(
  _slot_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _batch_id UUID;
  _slot_name TEXT;
  _rec RECORD;
  _total INTEGER := 0;
  _ord INTEGER := 0;
BEGIN
  -- Get slot name
  SELECT s.name INTO _slot_name FROM public.slots s WHERE s.id = _slot_id;
  IF _slot_name IS NULL THEN
    RAISE EXCEPTION 'Slot not found';
  END IF;

  -- Return existing non-printed batch if one exists
  SELECT lb.id INTO _batch_id
  FROM public.label_batches lb
  WHERE lb.slot_id = _slot_id AND lb.status <> 'printed'
  ORDER BY lb.created_at DESC LIMIT 1;

  IF _batch_id IS NOT NULL THEN
    RETURN _batch_id;
  END IF;

  -- Create batch
  INSERT INTO public.label_batches (slot_id, slot_name, status)
  VALUES (_slot_id, _slot_name, 'not_printed')
  RETURNING id INTO _batch_id;

  -- Find products in purchase_items whose slot_number matches the slot UUID (stored as text)
  FOR _rec IN
    SELECT
      pi.product_id,
      p.name AS pname,
      p.barcode AS pbarcode,
      pi.quantity AS qty,
      pi.unit_cost AS uc,
      p.price AS sp
    FROM public.purchase_items pi
    LEFT JOIN public.products p ON p.id = pi.product_id
    WHERE pi.slot_number = _slot_id::text
      AND pi.quantity > 0
  LOOP
    _ord := _ord + 1;
    INSERT INTO public.label_batch_items (
      batch_id, product_id, product_name, barcode,
      purchase_quantity, labels_to_print, labels_printed,
      unit_price, selling_price, sort_order
    ) VALUES (
      _batch_id,
      _rec.product_id,
      COALESCE(_rec.pname, 'Unknown'),
      _rec.pbarcode,
      _rec.qty,
      _rec.qty,
      0,
      COALESCE(_rec.uc, 0),
      COALESCE(_rec.sp, 0),
      _ord
    );
    _total := _total + _rec.qty;
  END LOOP;

  UPDATE public.label_batches
  SET total_labels_required = _total, updated_at = now()
  WHERE id = _batch_id;

  RETURN _batch_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_label_batch_for_slot(UUID) TO authenticated;

-- ---------- 6) RPC: update_label_item_quantity ----------
CREATE OR REPLACE FUNCTION public.update_label_item_quantity(
  _item_id UUID,
  _labels_to_print INTEGER
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _bid UUID;
BEGIN
  UPDATE public.label_batch_items
  SET labels_to_print = GREATEST(_labels_to_print, 0), updated_at = now()
  WHERE id = _item_id
  RETURNING batch_id INTO _bid;

  IF _bid IS NOT NULL THEN
    UPDATE public.label_batches lb
    SET
      total_labels_required = COALESCE((SELECT SUM(labels_to_print) FROM public.label_batch_items WHERE batch_id = _bid), 0),
      status = CASE
        WHEN COALESCE((SELECT SUM(labels_printed) FROM public.label_batch_items WHERE batch_id = _bid), 0) = 0 THEN 'not_printed'
        WHEN COALESCE((SELECT SUM(labels_printed) FROM public.label_batch_items WHERE batch_id = _bid), 0)
           >= COALESCE((SELECT SUM(labels_to_print) FROM public.label_batch_items WHERE batch_id = _bid), 0) THEN 'printed'
        ELSE 'partially_printed'
      END,
      updated_at = now()
    WHERE id = _bid;
  END IF;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_label_item_quantity(UUID, INTEGER) TO authenticated;

-- ---------- 7) RPC: mark_labels_printed ----------
CREATE OR REPLACE FUNCTION public.mark_labels_printed(
  _batch_id UUID,
  _item_ids UUID[] DEFAULT NULL,
  _quantities INTEGER[] DEFAULT NULL
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid UUID := auth.uid();
  _total INTEGER := 0;
  _i INTEGER;
  _rec RECORD;
  _qty INTEGER;
BEGIN
  IF _item_ids IS NULL THEN
    -- Print ALL remaining labels in the batch
    FOR _rec IN
      SELECT * FROM public.label_batch_items
      WHERE batch_id = _batch_id AND labels_printed < labels_to_print
    LOOP
      _qty := _rec.labels_to_print - _rec.labels_printed;
      UPDATE public.label_batch_items SET labels_printed = labels_to_print, updated_at = now() WHERE id = _rec.id;
      INSERT INTO public.label_print_history (batch_id, item_id, product_id, product_name, barcode, quantity_printed, printed_by)
      VALUES (_batch_id, _rec.id, _rec.product_id, _rec.product_name, _rec.barcode, _qty, _uid);
      _total := _total + _qty;
    END LOOP;
  ELSE
    FOR _i IN 1..array_length(_item_ids, 1) LOOP
      SELECT * INTO _rec FROM public.label_batch_items WHERE id = _item_ids[_i] AND batch_id = _batch_id;
      IF FOUND THEN
        _qty := COALESCE(_quantities[_i], _rec.labels_to_print - _rec.labels_printed);
        _qty := LEAST(_qty, _rec.labels_to_print - _rec.labels_printed);
        _qty := GREATEST(_qty, 0);
        IF _qty > 0 THEN
          UPDATE public.label_batch_items SET labels_printed = labels_printed + _qty, updated_at = now() WHERE id = _item_ids[_i];
          INSERT INTO public.label_print_history (batch_id, item_id, product_id, product_name, barcode, quantity_printed, printed_by)
          VALUES (_batch_id, _item_ids[_i], _rec.product_id, _rec.product_name, _rec.barcode, _qty, _uid);
          _total := _total + _qty;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- Update batch totals
  UPDATE public.label_batches lb
  SET
    total_labels_printed = COALESCE((SELECT SUM(labels_printed) FROM public.label_batch_items WHERE batch_id = _batch_id), 0),
    status = CASE
      WHEN COALESCE((SELECT SUM(labels_printed) FROM public.label_batch_items WHERE batch_id = _batch_id), 0) = 0 THEN 'not_printed'
      WHEN COALESCE((SELECT SUM(labels_printed) FROM public.label_batch_items WHERE batch_id = _batch_id), 0)
         >= COALESCE((SELECT SUM(labels_to_print) FROM public.label_batch_items WHERE batch_id = _batch_id), 0) THEN 'printed'
      ELSE 'partially_printed'
    END,
    updated_at = now()
  WHERE id = _batch_id;

  RETURN _total;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_labels_printed(UUID, UUID[], INTEGER[]) TO authenticated;
