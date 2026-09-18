-- ============================================================================
-- 2026-09-17 — Hardware / Printer Settings
-- ----------------------------------------------------------------------------
-- Single-row table for admin-configurable hardware settings:
--   • barcode_scanner    — prefix, timeout, auto_submit settings
--   • receipt_printer    — printer_id, paper_width, auto_cut, cash_drawer settings
--   • label_printer      — printer_id, label_width, label_height, template settings
--   • print_preferences  — default copies, preview_before_print, batch_printing
--
-- Follows the same single-row pattern as whatsapp_settings (id=1).
-- Uses SECURITY DEFINER RPC functions so only admin can write, staff/admin can read.
-- ============================================================================

-- +++++++++++ HARDWARE SETTINGS TABLE +++++++++++
CREATE TABLE IF NOT EXISTS public.hardware_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),

  -- Barcode Scanner
  scanner_prefix TEXT DEFAULT '',
  scanner_timeout_ms INTEGER NOT NULL DEFAULT 50,
  scanner_auto_submit BOOLEAN NOT NULL DEFAULT true,

  -- Receipt Printer
  receipt_printer_id TEXT,
  receipt_paper_width TEXT DEFAULT '80mm' CHECK (receipt_paper_width IN ('58mm', '80mm')),
  receipt_auto_cut BOOLEAN NOT NULL DEFAULT true,
  receipt_open_cash_drawer BOOLEAN NOT NULL DEFAULT true,
  receipt_print_barcode BOOLEAN NOT NULL DEFAULT false,

  -- Label Printer
  label_printer_id TEXT,
  label_width_mm INTEGER NOT NULL DEFAULT 40,
  label_height_mm INTEGER NOT NULL DEFAULT 30,
  label_margin_mm INTEGER NOT NULL DEFAULT 2,
  label_template TEXT DEFAULT 'standard' CHECK (label_template IN ('standard', 'compact', 'detailed')),
  label_barcode_type TEXT DEFAULT 'CODE128' CHECK (label_barcode_type IN ('CODE128', 'EAN13', 'QR')),
  label_show_mrp BOOLEAN NOT NULL DEFAULT true,
  label_show_offer_price BOOLEAN NOT NULL DEFAULT true,
  label_show_batch_number BOOLEAN NOT NULL DEFAULT true,
  label_show_expiry_date BOOLEAN NOT NULL DEFAULT true,
  label_show_sku BOOLEAN NOT NULL DEFAULT true,
  label_show_store_name BOOLEAN NOT NULL DEFAULT true,
  label_show_store_address BOOLEAN NOT NULL DEFAULT true,

  -- Printing Preferences
  default_label_copies INTEGER NOT NULL DEFAULT 1,
  preview_before_print BOOLEAN NOT NULL DEFAULT false,
  batch_printing BOOLEAN NOT NULL DEFAULT false,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.hardware_settings TO authenticated;
GRANT ALL ON public.hardware_settings TO service_role;

ALTER TABLE public.hardware_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hardware_settings admin read" ON public.hardware_settings;
CREATE POLICY "hardware_settings admin read" ON public.hardware_settings
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

DROP POLICY IF EXISTS "hardware_settings admin write" ON public.hardware_settings;
CREATE POLICY "hardware_settings admin write" ON public.hardware_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Seed the single row so the admin config page can always upsert against it.
INSERT INTO public.hardware_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- +++++++++++ RPC: get_hardware_settings +++++++++++
-- Returns current hardware config (safe for staff/admin to read).
CREATE OR REPLACE FUNCTION public.get_hardware_settings()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _cfg JSONB;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff')) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT to_jsonb(h) INTO _cfg
  FROM public.hardware_settings h
  WHERE h.id = 1;

  IF _cfg IS NULL THEN
    RETURN '{}'::JSONB;
  END IF;

  RETURN _cfg;
END; $$;

GRANT EXECUTE ON FUNCTION public.get_hardware_settings() TO authenticated;

-- +++++++++++ RPC: save_hardware_settings +++++++++++
-- Admin saves hardware configuration. Accepts partial updates.
CREATE OR REPLACE FUNCTION public.save_hardware_settings(_data JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid UUID := auth.uid();
  _updated JSONB;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.has_role(_uid, 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Build update object from provided keys
  UPDATE public.hardware_settings
  SET
    scanner_prefix            = COALESCE(NULLIF((_data->>'scanner_prefix')::TEXT, ''), scanner_prefix),
    scanner_timeout_ms        = COALESCE((_data->>'scanner_timeout_ms')::INTEGER, scanner_timeout_ms),
    scanner_auto_submit       = COALESCE((_data->>'scanner_auto_submit')::BOOLEAN, scanner_auto_submit),
    receipt_printer_id        = COALESCE(NULLIF((_data->>'receipt_printer_id')::TEXT, ''), receipt_printer_id),
    receipt_paper_width       = COALESCE((_data->>'receipt_paper_width')::TEXT, receipt_paper_width),
    receipt_auto_cut          = COALESCE((_data->>'receipt_auto_cut')::BOOLEAN, receipt_auto_cut),
    receipt_open_cash_drawer  = COALESCE((_data->>'receipt_open_cash_drawer')::BOOLEAN, receipt_open_cash_drawer),
    receipt_print_barcode     = COALESCE((_data->>'receipt_print_barcode')::BOOLEAN, receipt_print_barcode),
    label_printer_id          = COALESCE(NULLIF((_data->>'label_printer_id')::TEXT, ''), label_printer_id),
    label_width_mm            = COALESCE((_data->>'label_width_mm')::INTEGER, label_width_mm),
    label_height_mm           = COALESCE((_data->>'label_height_mm')::INTEGER, label_height_mm),
    label_margin_mm           = COALESCE((_data->>'label_margin_mm')::INTEGER, label_margin_mm),
    label_template            = COALESCE((_data->>'label_template')::TEXT, label_template),
    label_barcode_type        = COALESCE((_data->>'label_barcode_type')::TEXT, label_barcode_type),
    label_show_mrp            = COALESCE((_data->>'label_show_mrp')::BOOLEAN, label_show_mrp),
    label_show_offer_price    = COALESCE((_data->>'label_show_offer_price')::BOOLEAN, label_show_offer_price),
    label_show_batch_number   = COALESCE((_data->>'label_show_batch_number')::BOOLEAN, label_show_batch_number),
    label_show_expiry_date    = COALESCE((_data->>'label_show_expiry_date')::BOOLEAN, label_show_expiry_date),
    label_show_sku            = COALESCE((_data->>'label_show_sku')::BOOLEAN, label_show_sku),
    label_show_store_name     = COALESCE((_data->>'label_show_store_name')::BOOLEAN, label_show_store_name),
    label_show_store_address  = COALESCE((_data->>'label_show_store_address')::BOOLEAN, label_show_store_address),
    default_label_copies      = COALESCE((_data->>'default_label_copies')::INTEGER, default_label_copies),
    preview_before_print      = COALESCE((_data->>'preview_before_print')::BOOLEAN, preview_before_print),
    batch_printing            = COALESCE((_data->>'batch_printing')::BOOLEAN, batch_printing),
    updated_at                = now()
  WHERE id = 1;

  -- Return the updated config
  SELECT to_jsonb(h) INTO _updated
  FROM public.hardware_settings h
  WHERE h.id = 1;

  RETURN _updated;
END; $$;

GRANT EXECUTE ON FUNCTION public.save_hardware_settings(JSONB) TO authenticated;