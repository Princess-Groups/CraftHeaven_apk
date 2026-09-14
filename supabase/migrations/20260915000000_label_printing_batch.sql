-- ============================================================
-- Label Printing Batch System
-- Migration: 20260915000000_label_printing_batch.sql
-- ============================================================
-- Adds:
--   1. `label_batches` — one per slot, tracks print status
--   2. `label_batch_items` — per-product label counts in a batch
--   3. `label_print_history` — audit trail for every print action
--   4. RPC: create_label_batch_for_slot
--   5. RPC: update_label_item_quantity
--   6. RPC: mark_labels_printed
--   7. RPC: get_slot_label_summary
-- ============================================================

-- ---------- 1) label_batches ----------
CREATE TABLE IF NOT EXISTS public.label_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id UUID NOT NULL REFERENCES public.slots(id) ON DELETE CASCADE,
  slot_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_printed'
    CHECK (status IN ('not_printed', 'partially_printed', 'printed')),
  total_labels_required INTEGER NOT NULL DEFAULT 0,
  total_labels_printed INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_label_batches_slot_id ON public.label_batches(slot_id);
CREATE INDEX IF NOT EXISTS idx_label_batches_status ON public.label_batches(status);

-- ---------- 2) label_batch_items ----------
CREATE TABLE IF NOT EXISTS public.label_batch_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.label_batches(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  barcode TEXT,
  purchase_quantity INTEGER NOT NULL DEFAULT 0,
  labels_to_print INTEGER NOT NULL DEFAULT 0,
  labels_printed INTEGER NOT NULL DEFAULT 0,
  labels_remaining INTEGER GENERATED ALWAYS AS (labels_to_print - labels_printed) STORED,
  unit_price NUMERIC(12,2) DEFAULT 0,
  selling_price NUMERIC(12,2) DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_label_batch_items_batch_id ON public.label_batch_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_label_batch_items_product_id ON public.label_batch_items(product_id);

-- ---------- 3) label_print_history ----------
CREATE TABLE IF NOT EXISTS public.label_print_history (
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

CREATE INDEX IF NOT EXISTS idx_label_print_history_batch_id ON public.label_print_history(batch_id);

-- ---------- 4) RLS Policies ----------
ALTER TABLE public.label_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.label_batch_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.label_print_history ENABLE ROW LEVEL SECURITY;

-- Admin/Staff can do everything on label_batches
CREATE POLICY "label_batches_admin_all" ON public.label_batches
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('admin', 'staff')
    )
  );

-- Admin/Staff can do everything on label_batch_items
CREATE POLICY "label_batch_items_admin_all" ON public.label_batch_items
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('admin', 'staff')
    )
  );

-- Admin/Staff can do everything on label_print_history
CREATE POLICY "label_print_history_admin_all" ON public.label_print_history
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('admin', 'staff')
    )
  );

-- ---------- 5) RPC: Create label batch for a slot ----------
CREATE OR REPLACE FUNCTION public.create_label_batch_for_slot(
  _slot_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid UUID := auth.uid();
  _batch_id UUID;
  _slot_name TEXT;
  _item RECORD;
  _total_labels INTEGER := 0;
  _sort_order INTEGER := 0;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (public.has_role(_uid, 'admin') OR public.has_role(_uid, 'staff')) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Get slot name
  SELECT name INTO _slot_name FROM public.slots WHERE id = _slot_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Slot not found'; END IF;

  -- Check if an active (non-printed) batch already exists for this slot
  SELECT id INTO _batch_id
  FROM public.label_batches
  WHERE slot_id = _slot_id AND status != 'printed'
  ORDER BY created_at DESC LIMIT 1;

  IF FOUND THEN
    -- Return existing batch
    RETURN _batch_id;
  END IF;

  -- Create new batch
  INSERT INTO public.label_batches (slot_id, slot_name, status)
  VALUES (_slot_id, _slot_name, 'not_printed')
  RETURNING id INTO _batch_id;

  -- Collect all products from purchase_items that reference this slot
  -- Join with products to get barcode, name, price
  FOR _item IN
    SELECT
      pi.product_id,
      COALESCE(p.name, pi.product_name, 'Unknown') AS pname,
      COALESCE(p.barcode, pi.sku) AS pbarcode,
      COALESCE(pi.quantity, 0) AS qty,
      COALESCE(pi.unit_cost, 0) AS uc,
      COALESCE(pi.selling_price, p.price, 0) AS sp
    FROM public.purchase_items pi
    LEFT JOIN public.products p ON p.id = pi.product_id
    WHERE pi.slot_number = _slot_id::text
      OR pi.slot_number = (SELECT name FROM public.slots WHERE id = _slot_id)
  LOOP
    IF _item.qty > 0 THEN
      _sort_order := _sort_order + 1;
      INSERT INTO public.label_batch_items (
        batch_id, product_id, product_name, barcode,
        purchase_quantity, labels_to_print, labels_printed,
        unit_price, selling_price, sort_order
      ) VALUES (
        _batch_id, _item.product_id, _item.pname, _item.pbarcode,
        _item.qty, _item.qty, 0,
        _item.uc, _item.sp, _sort_order
      );
      _total_labels := _total_labels + _item.qty;
    END IF;
  END LOOP;

  -- Update total labels required on the batch
  UPDATE public.label_batches
  SET total_labels_required = _total_labels, updated_at = now()
  WHERE id = _batch_id;

  RETURN _batch_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.create_label_batch_for_slot(UUID) TO authenticated;

-- ---------- 6) RPC: Update label item quantity ----------
CREATE OR REPLACE FUNCTION public.update_label_item_quantity(
  _item_id UUID,
  _labels_to_print INTEGER
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid UUID := auth.uid();
  _batch_id UUID;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (public.has_role(_uid, 'admin') OR public.has_role(_uid, 'staff')) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.label_batch_items
  SET labels_to_print = GREATEST(_labels_to_print, 0),
      updated_at = now()
  WHERE id = _item_id
  RETURNING batch_id INTO _batch_id;

  -- Recalculate batch totals
  IF _batch_id IS NOT NULL THEN
    UPDATE public.label_batches
    SET total_labels_required = (
      SELECT COALESCE(SUM(labels_to_print), 0)
      FROM public.label_batch_items WHERE batch_id = _batch_id
    ),
    status = CASE
      WHEN (SELECT SUM(labels_printed) FROM public.label_batch_items WHERE batch_id = _batch_id) = 0 THEN 'not_printed'
      WHEN (SELECT SUM(labels_printed) FROM public.label_batch_items WHERE batch_id = _batch_id) >=
           (SELECT SUM(labels_to_print) FROM public.label_batch_items WHERE batch_id = _batch_id) THEN 'printed'
      ELSE 'partially_printed'
    END,
    updated_at = now()
    WHERE id = _batch_id;
  END IF;

  RETURN TRUE;
END; $$;
GRANT EXECUTE ON FUNCTION public.update_label_item_quantity(UUID, INTEGER) TO authenticated;

-- ---------- 7) RPC: Mark labels as printed (batch or selected items) ----------
CREATE OR REPLACE FUNCTION public.mark_labels_printed(
  _batch_id UUID,
  _item_ids UUID[] DEFAULT NULL,
  _quantities INTEGER[] DEFAULT NULL
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid UUID := auth.uid();
  _total_printed INTEGER := 0;
  _i INTEGER;
  _item RECORD;
  _qty INTEGER;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (public.has_role(_uid, 'admin') OR public.has_role(_uid, 'staff')) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF _item_ids IS NULL THEN
    -- Print ALL items in the batch
    FOR _item IN
      SELECT * FROM public.label_batch_items
      WHERE batch_id = _batch_id AND labels_printed < labels_to_print
    LOOP
      _qty := _item.labels_to_print - _item.labels_printed;
      IF _qty > 0 THEN
        UPDATE public.label_batch_items
        SET labels_printed = labels_to_print, updated_at = now()
        WHERE id = _item.id;

        INSERT INTO public.label_print_history (batch_id, item_id, product_id, product_name, barcode, quantity_printed, printed_by)
        VALUES (_batch_id, _item.id, _item.product_id, _item.product_name, _item.barcode, _qty, _uid);

        _total_printed := _total_printed + _qty;
      END IF;
    END LOOP;
  ELSE
    -- Print selected items with specified quantities
    FOR _i IN 1..array_length(_item_ids, 1) LOOP
      SELECT * INTO _item FROM public.label_batch_items WHERE id = _item_ids[_i] AND batch_id = _batch_id;
      IF FOUND THEN
        _qty := COALESCE(_quantities[_i], _item.labels_to_print - _item.labels_printed);
        _qty := LEAST(_qty, _item.labels_to_print - _item.labels_printed);
        _qty := GREATEST(_qty, 0);
        IF _qty > 0 THEN
          UPDATE public.label_batch_items
          SET labels_printed = labels_printed + _qty, updated_at = now()
          WHERE id = _item_ids[_i];

          INSERT INTO public.label_print_history (batch_id, item_id, product_id, product_name, barcode, quantity_printed, printed_by)
          VALUES (_batch_id, _item_ids[_i], _item.product_id, _item.product_name, _item.barcode, _qty, _uid);

          _total_printed := _total_printed + _qty;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- Update batch totals and status
  UPDATE public.label_batches
  SET total_labels_printed = (
    SELECT COALESCE(SUM(labels_printed), 0)
    FROM public.label_batch_items WHERE batch_id = _batch_id
  ),
  status = CASE
    WHEN (SELECT SUM(labels_printed) FROM public.label_batch_items WHERE batch_id = _batch_id) = 0 THEN 'not_printed'
    WHEN (SELECT SUM(labels_printed) FROM public.label_batch_items WHERE batch_id = _batch_id) >=
         (SELECT SUM(labels_to_print) FROM public.label_batch_items WHERE batch_id = _batch_id) THEN 'printed'
    ELSE 'partially_printed'
  END,
  updated_at = now()
  WHERE id = _batch_id;

  RETURN _total_printed;
END; $$;
GRANT EXECUTE ON FUNCTION public.mark_labels_printed(UUID, UUID[], INTEGER[]) TO authenticated;

-- ---------- 8) RPC: Get slot label summary ----------
CREATE OR REPLACE FUNCTION public.get_slot_label_summary(_slot_id UUID)
RETURNS TABLE (
  batch_id UUID,
  batch_status TEXT,
  total_labels_required INTEGER,
  total_labels_printed INTEGER,
  product_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT
    lb.id AS batch_id,
    lb.status AS batch_status,
    lb.total_labels_required,
    lb.total_labels_printed,
    (SELECT COUNT(*) FROM public.label_batch_items WHERE batch_id = lb.id) AS product_count
  FROM public.label_batches lb
  WHERE lb.slot_id = _slot_id
  ORDER BY lb.created_at DESC
  LIMIT 1;
END; $$;
GRANT EXECUTE ON FUNCTION public.get_slot_label_summary(UUID) TO authenticated;
