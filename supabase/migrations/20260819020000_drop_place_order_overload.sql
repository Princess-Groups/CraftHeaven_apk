-- ============================================================================
-- 2026-08-19 — Drop stale place_order overload
-- ----------------------------------------------------------------------------
-- The units migration replaced place_order with a 10-arg version (__tax_type,
-- _shipping, _state added). An older 7-arg overload from add_coupon_discount
-- still exists in the DB, so PostgREST reports "Could not choose the best
-- candidate function" when callers use the older argument set (the online
-- checkout sends 7 args; the new POS sends 10). Dropping the stale overload
-- leaves exactly one signature — the new one, whose extra args all have
-- defaults — so BOTH the online checkout and POS resolve cleanly.
-- ============================================================================

DROP FUNCTION IF EXISTS public.place_order(
  public.order_channel,
  public.payment_method,
  public.delivery_type,
  UUID,
  JSONB,
  TEXT,
  NUMERIC
);