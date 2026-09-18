-- ============================================================
-- Fix: grant table privileges on label-printing tables
-- Migration: 20260919010000_fix_label_table_grants.sql
-- ============================================================
-- 20260915020000 recreated label_batches / label_batch_items /
-- label_print_history but never re-granted table privileges, so
-- even service_role (and all frontend users) get:
--   permission denied for table label_batches        (42501)
-- Restore the same grants every other table in this repo uses,
-- mirroring the RLS setup (authenticated has full CRUD via the
-- lbl_*_open policies; service_role gets everything).
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.label_batches TO authenticated;
GRANT ALL ON public.label_batches TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.label_batch_items TO authenticated;
GRANT ALL ON public.label_batch_items TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.label_print_history TO authenticated;
GRANT ALL ON public.label_print_history TO service_role;