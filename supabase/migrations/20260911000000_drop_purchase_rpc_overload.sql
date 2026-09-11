-- ============================================================
-- Drop duplicate create_purchase_with_products overload
-- Migration: 20260911000000_drop_purchase_rpc_overload.sql
-- ============================================================
-- There are two overloaded versions of this function with the same
-- parameter types but in different order, causing PostgREST error
-- PGRST203 ("Could not choose the best candidate function").
--
-- Keep: (UUID, TEXT, DATE, TEXT, JSONB, NUMERIC) — _supplier_id first
-- Drop: (JSONB, UUID, TEXT, DATE, TEXT, NUMERIC) — _items first
-- ============================================================

DROP FUNCTION IF EXISTS public.create_purchase_with_products(JSONB, UUID, TEXT, DATE, TEXT, NUMERIC);

-- Re-grant the correct overload
GRANT EXECUTE ON FUNCTION public.create_purchase_with_products(UUID, TEXT, DATE, TEXT, JSONB, NUMERIC) TO authenticated;
