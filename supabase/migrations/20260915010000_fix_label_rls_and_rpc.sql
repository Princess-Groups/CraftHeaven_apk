-- ============================================================
-- Fix Label Printing RLS and RPC
-- Migration: 20260915010000_fix_label_rls_and_rpc.sql
-- ============================================================
-- Fixes:
--   1. Simplify RLS policies (allow all authenticated users)
--   2. Fix create_label_batch_for_slot to handle text slot_number properly
-- ============================================================

-- ---------- 1) Drop and recreate RLS policies ----------
-- Drop old restrictive policies
DROP POLICY IF EXISTS "label_batches_admin_all" ON public.label_batches;
DROP POLICY IF EXISTS "label_batch_items_admin_all" ON public.label_batch_items;
DROP POLICY IF EXISTS "label_print_history_admin_all" ON public.label_print_history;

-- Simple policies: all authenticated users can read/write
CREATE POLICY "label_batches_auth_all" ON public.label_batches
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "label_batch_items_auth_all" ON public.label_batch_items
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "label_print_history_auth_all" ON public.label_print_history
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- ---------- 2) Fix create_label_batch_for_slot RPC ----------
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
  _slot_name_text TEXT;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- Get slot name
  SELECT name INTO _slot_name FROM public.slots WHERE id = _slot_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Slot not found'; END IF;

  -- Check if an active (non-printed) batch already exists for this slot
  SELECT id INTO _batch_id
  FROM public.label_batches
  WHERE slot_id = _slot_id AND status != 'printed'
  ORDER BY created_at DESC LIMIT 1;

  IF FOUND THEN
    RETURN _batch_id;
  END IF;

  -- Create new batch
  INSERT INTO public.label_batches (slot_id, slot_name, status)
  VALUES (_slot_id, _slot_name, 'not_printed')
  RETURNING id INTO _batch_id;

  -- Collect products from purchase_items that reference this slot
  -- purchase_items.slot_number stores the slot UUID as text
  FOR _item IN
    SELECT
      pi.product_id,
      COALESCE(p.name, 'Unknown Product') AS pname,
      p.barcode AS pbarcode,
      COALESCE(pi.quantity, 0) AS qty,
      COALESCE(pi.unit_cost, 0) AS uc,
      COALESCE(p.price, 0) AS sp
    FROM public.purchase_items pi
    LEFT JOIN public.products p ON p.id = pi.product_id
    WHERE pi.slot_number = _slot_id::text
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
