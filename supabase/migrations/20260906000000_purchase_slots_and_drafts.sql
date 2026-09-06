-- ============================================================
-- Purchase Slots & Draft Entries
-- Migration: 20260906000000_purchase_slots_and_drafts.sql
-- ============================================================
-- Adds:
--   1. `status` column on purchases table for draft/completed tracking
--   2. `purchase_slots` table for slot-wise charge grouping
--   3. RPC functions for slot charge calculation
-- ============================================================

-- ---------- 1) Add status column to purchases ----------
ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed'
  CHECK (status IN ('draft', 'completed'));

-- ---------- 2) Create purchase_slots table ----------
CREATE TABLE IF NOT EXISTS public.purchase_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id UUID NOT NULL REFERENCES public.purchases(id) ON DELETE CASCADE,
  slot_number TEXT NOT NULL,
  total_slot_charge NUMERIC(12,2) NOT NULL DEFAULT 0,
  product_count INTEGER NOT NULL DEFAULT 0,
  per_product_charge NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(purchase_id, slot_number)
);

-- Index for fast lookups by purchase_id
CREATE INDEX IF NOT EXISTS idx_purchase_slots_purchase_id ON public.purchase_slots(purchase_id);

-- ---------- 3) Add slot columns to purchase_items ----------
ALTER TABLE public.purchase_items
  ADD COLUMN IF NOT EXISTS slot_number TEXT,
  ADD COLUMN IF NOT EXISTS slot_charge_per_product NUMERIC(12,2) NOT NULL DEFAULT 0;

-- ---------- 4) Auto-update slot product counts and per-product charges ----------
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

  -- Update the purchase_slots record
  UPDATE public.purchase_slots
  SET product_count = _product_count,
      per_product_charge = _per_product,
      updated_at = now()
  WHERE purchase_id = _purchase_id AND slot_number = _slot_number;

  -- Update all purchase_items in this slot with the new per-product charge
  -- The last item gets the remainder to preserve exact total
  UPDATE public.purchase_items
  SET slot_charge_per_product = _per_product
  WHERE purchase_id = _purchase_id
    AND slot_number = _slot_number
    AND id NOT IN (
      SELECT id FROM public.purchase_items
      WHERE purchase_id = _purchase_id AND slot_number = _slot_number
      ORDER BY created_at DESC
      LIMIT 1
    );

  -- Last item gets the remainder
  UPDATE public.purchase_items
  SET slot_charge_per_product = _total_charge - (_per_product * (_product_count - 1))
  WHERE purchase_id = _purchase_id
    AND slot_number = _slot_number
    AND id = (
      SELECT id FROM public.purchase_items
      WHERE purchase_id = _purchase_id AND slot_number = _slot_number
      ORDER BY created_at DESC
      LIMIT 1
    );

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;

-- Create trigger for purchase_items slot recalculation
DROP TRIGGER IF EXISTS trg_update_slot_calculations ON public.purchase_items;
CREATE TRIGGER trg_update_slot_calculations
  AFTER INSERT OR UPDATE OR DELETE ON public.purchase_items
  FOR EACH ROW EXECUTE FUNCTION public.update_slot_calculations();

-- ---------- 5) Create/Update purchase slot RPC ----------
CREATE OR REPLACE FUNCTION public.upsert_purchase_slot(
  _purchase_id UUID,
  _slot_number TEXT,
  _total_slot_charge NUMERIC
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid UUID := auth.uid();
  _slot_id UUID;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (public.has_role(_uid, 'admin') OR public.has_role(_uid, 'staff')) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  INSERT INTO public.purchase_slots (purchase_id, slot_number, total_slot_charge)
  VALUES (_purchase_id, _slot_number, COALESCE(_total_slot_charge, 0))
  ON CONFLICT (purchase_id, slot_number)
  DO UPDATE SET
    total_slot_charge = EXCLUDED.total_slot_charge,
    updated_at = now()
  RETURNING id INTO _slot_id;

  RETURN _slot_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.upsert_purchase_slot(UUID, TEXT, NUMERIC) TO authenticated;

-- ---------- 6) Get slot summary for a purchase ----------
CREATE OR REPLACE FUNCTION public.get_purchase_slot_summary(_purchase_id UUID)
RETURNS TABLE (
  slot_number TEXT,
  total_slot_charge NUMERIC,
  product_count INTEGER,
  per_product_charge NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT
    ps.slot_number,
    ps.total_slot_charge,
    ps.product_count,
    ps.per_product_charge
  FROM public.purchase_slots ps
  WHERE ps.purchase_id = _purchase_id
  ORDER BY ps.slot_number;
END; $$;
GRANT EXECUTE ON FUNCTION public.get_purchase_slot_summary(UUID) TO authenticated;

-- ---------- 7) Update Supabase types for new columns ----------
-- Note: This is a reference. The actual types.ts update should be done via
-- Supabase CLI or manually in src/integrations/supabase/types.ts
