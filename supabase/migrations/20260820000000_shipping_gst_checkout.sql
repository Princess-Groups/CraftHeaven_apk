-- ============================================================================
-- 2026-08-20 — Customer App Shipping (₹25/km) + shipping zones configuration
-- ----------------------------------------------------------------------------
-- Customer-facing checkout only. Does NOT alter billing/inventory/purchase logic
-- or the Admin Profit module. Adds:
--   1. shipping_zones      — pincode → km-from-store mapping (offline distance
--                            model). Each row carries a zone tag so a pincode can
--                            be inside Nagercoil, outside-Nagercoil/TN, or another
--                            state.
--   2. shipping_settings   — single global row (id=1) with the store origin
--                            pincode, the Nagercoil per-km rate (₹25), configurable
--                            outside-TN min charge and other-state charge, plus a
--                            JSONB `zones` block so additional zones can be added
--                            later without a migration.
--   3. calculate_shipping  — SECURITY DEFINER RPC. Given a pincode + delivery type
--                            returns { zone, km, per_km_rate, min_charge, charge }.
--                            Inside Nagercoil → km × ₹25; outside TN → configurable
--                            min; other state → configurable charge; PICKUP/unknown
--                            → safe 0 / TN-min fallback. Single source of truth used
--                            by checkout.
--   4. save_shipping_settings / upsert_shipping_zone — admin RPCs so rates and
--                            pincode→km can be edited later without code changes.
--   place_order already accepts `_shipping` and stores it in orders.shipping_charges
--   (added by 20260819000000); no change to its signature is needed here.
--
-- Safe to re-run: CREATE TABLE IF NOT EXISTS / CREATE OR REPLACE everywhere.
-- ============================================================================

-- +++++++++++ 1) SHIPPING ZONES (pincode → km + zone) +++++++++++
CREATE TABLE IF NOT EXISTS public.shipping_zones (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pincode        TEXT NOT NULL UNIQUE,                     -- delivery pincode (6-digit)
  km_from_store  NUMERIC(8,2) NOT NULL DEFAULT 0,          -- distance from origin pincode
  zone           TEXT NOT NULL DEFAULT 'INSIDE_NGERCOIL',  -- INSIDE_NGERCOIL | OUTSIDE_TN | OTHER_STATE
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shipping_zones_pincode_idx ON public.shipping_zones(pincode);

GRANT SELECT ON public.shipping_zones TO authenticated;          -- customers read at checkout
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shipping_zones TO authenticated; -- admin/staff manage via RLS
GRANT ALL ON public.shipping_zones TO service_role;
ALTER TABLE public.shipping_zones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shipping_zones read" ON public.shipping_zones;
CREATE POLICY "shipping_zones read"
  ON public.shipping_zones FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "shipping_zones admin write" ON public.shipping_zones;
CREATE POLICY "shipping_zones admin write"
  ON public.shipping_zones FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

-- +++++++++++ 2) SHIPPING SETTINGS (single global row) +++++++++++
CREATE TABLE IF NOT EXISTS public.shipping_settings (
  id                  INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  origin_pincode      TEXT NOT NULL DEFAULT '629001',
  zones               JSONB NOT NULL DEFAULT '[]'::jsonb,   -- future additional zones
  enabled             BOOLEAN NOT NULL DEFAULT true,
  per_km_rate         NUMERIC(8,2) NOT NULL DEFAULT 25,     -- Nagercoil ₹/km
  outside_tn_min      NUMERIC(8,2) NOT NULL DEFAULT 80,     -- configurable min (outside Nagercoil, within TN)
  other_state_charge  NUMERIC(8,2) NOT NULL DEFAULT 120,    -- configurable other-state charge
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.shipping_settings TO authenticated;
GRANT ALL ON public.shipping_settings TO service_role;
ALTER TABLE public.shipping_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shipping_settings read" ON public.shipping_settings;
CREATE POLICY "shipping_settings read"
  ON public.shipping_settings FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "shipping_settings admin write" ON public.shipping_settings;
CREATE POLICY "shipping_settings admin write"
  ON public.shipping_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Seed the single settings row so get/save always have a target.
INSERT INTO public.shipping_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- +++++++++++ 3) RPC: CALCULATE SHIPPING (used at checkout) +++++++++++
-- Inside Nagercoil → km × per_km_rate.
-- Outside-Nagercoil/TN   → outside_tn_min (or max(rate × km, min) when km known).
-- Other state            → other_state_charge.
-- PICKUP / null pincode  → 0.
-- Unknown pincode        → outside-TN default (configurable outside_tn_min).
CREATE OR REPLACE FUNCTION public.calculate_shipping(
  _pincode TEXT,
  _delivery_type public.delivery_type DEFAULT 'DELIVERY'
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _z        public.shipping_zones;
  _s        public.shipping_settings;
  _zone     TEXT;
  _km       NUMERIC(8,2)  := 0;
  _rate     NUMERIC(8,2)  := 25;
  _min      NUMERIC(8,2)  := 80;
  _charge   NUMERIC(12,2) := 0;
BEGIN
  IF _delivery_type = 'PICKUP' OR _pincode IS NULL OR btrim(_pincode) = '' THEN
    RETURN jsonb_build_object('zone', 'PICKUP', 'km', 0, 'per_km_rate', 0, 'min_charge', 0, 'charge', 0);
  END IF;

  SELECT * INTO _s FROM public.shipping_settings WHERE id = 1;
  IF FOUND THEN
    _rate := GREATEST(0, COALESCE(_s.per_km_rate, 25));
    _min  := GREATEST(0, COALESCE(_s.outside_tn_min, 80));
  END IF;

  SELECT * INTO _z FROM public.shipping_zones WHERE pincode = btrim(_pincode);
  IF FOUND THEN
    _zone := COALESCE(_z.zone, 'OUTSIDE_TN');
    _km   := GREATEST(0, COALESCE(_z.km_from_store, 0));
    IF _zone = 'INSIDE_NGERCOIL' THEN
      _charge := _km * _rate;
    ELSIF _zone = 'OTHER_STATE' THEN
      _charge := GREATEST(0, COALESCE((SELECT other_state_charge FROM public.shipping_settings WHERE id = 1), 120));
    ELSE
      -- outside Nagercoil (within TN): use the higher of distance charge or TN min
      _charge := GREATEST(_km * _rate, _min);
    END IF;
  ELSE
    -- unknown pincode → treat as outside-Nagercoil/TN with the configurable min charge
    _zone := 'OUTSIDE_TN';
    _charge := _min;
  END IF;

  RETURN jsonb_build_object(
    'zone', _zone,
    'km', round(_km, 2),
    'per_km_rate', round(_rate, 2),
    'min_charge', round(_min, 2),
    'charge', round(GREATEST(0, _charge), 2)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.calculate_shipping(TEXT, public.delivery_type) TO authenticated;

-- +++++++++++ 4) RPC: SAVE SHIPPING SETTINGS (admin only) +++++++++++
CREATE OR REPLACE FUNCTION public.save_shipping_settings(
  _per_km_rate        NUMERIC DEFAULT NULL,
  _outside_tn_min     NUMERIC DEFAULT NULL,
  _other_state_charge NUMERIC DEFAULT NULL,
  _enabled            BOOLEAN DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid UUID := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.has_role(_uid, 'admin') THEN RAISE EXCEPTION 'Admin only'; END IF;

  UPDATE public.shipping_settings
    SET per_km_rate        = CASE WHEN _per_km_rate IS NOT NULL THEN GREATEST(0, COALESCE(_per_km_rate, 0)) ELSE per_km_rate END,
        outside_tn_min     = CASE WHEN _outside_tn_min IS NOT NULL THEN GREATEST(0, COALESCE(_outside_tn_min, 0)) ELSE outside_tn_min END,
        other_state_charge = CASE WHEN _other_state_charge IS NOT NULL THEN GREATEST(0, COALESCE(_other_state_charge, 0)) ELSE other_state_charge END,
        enabled            = CASE WHEN _enabled IS NOT NULL THEN _enabled ELSE enabled END,
        updated_at         = now()
    WHERE id = 1;
  RETURN TRUE;
END;
$$;
GRANT EXECUTE ON FUNCTION public.save_shipping_settings(NUMERIC, NUMERIC, NUMERIC, BOOLEAN) TO authenticated;

-- +++++++++++ 5) RPC: UPSERT A SHIPPING ZONE (admin/staff) +++++++++++
-- Add or update a pincode→km mapping. zone is one of
-- INSIDE_NGERCOIL | OUTSIDE_TN | OTHER_STATE.
CREATE OR REPLACE FUNCTION public.upsert_shipping_zone(
  _pincode TEXT,
  _km_from_store NUMERIC,
  _zone TEXT DEFAULT 'INSIDE_NGERCOIL'
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid UUID := auth.uid();
  _z TEXT;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (public.has_role(_uid, 'admin') OR public.has_role(_uid, 'staff')) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  _z := upper(btrim(COALESCE(_zone, 'INSIDE_NGERCOIL')));
  IF _z NOT IN ('INSIDE_NGERCOIL', 'OUTSIDE_TN', 'OTHER_STATE') THEN
    RAISE EXCEPTION 'Invalid zone';
  END IF;

  INSERT INTO public.shipping_zones (pincode, km_from_store, zone, updated_at)
  VALUES (btrim(_pincode), GREATEST(0, COALESCE(_km_from_store, 0)), _z, now())
  ON CONFLICT (pincode) DO UPDATE SET
    km_from_store = GREATEST(0, COALESCE(_km_from_store, 0)),
    zone          = _z,
    updated_at    = now();
  RETURN TRUE;
END;
$$;
GRANT EXECUTE ON FUNCTION public.upsert_shipping_zone(TEXT, NUMERIC, TEXT) TO authenticated;

-- +++++++++++ 6) SEED Nagercoil pincode → distance (editable starting data) +++++++++++
-- Approximate distances from the store origin pincode 629001 (Nagercoil). These are
-- admin-managed and fully editable later — they are starting values so the app works
-- immediately for known areas. Unknown pincodes fall back to the configurable
-- outside-TN minimum charge.
INSERT INTO public.shipping_zones (pincode, km_from_store, zone) VALUES
  ('629001', 0,  'INSIDE_NGERCOIL'),
  ('629002', 2,  'INSIDE_NGERCOIL'),
  ('629003', 4,  'INSIDE_NGERCOIL'),
  ('629004', 6,  'INSIDE_NGERCOIL'),
  ('629151', 6,  'INSIDE_NGERCOIL'),
  ('629152', 8,  'INSIDE_NGERCOIL'),
  ('629153', 10, 'INSIDE_NGERCOIL'),
  ('629154', 8,  'INSIDE_NGERCOIL'),
  ('629155', 12, 'INSIDE_NGERCOIL'),
  ('629156', 5,  'INSIDE_NGERCOIL'),
  ('629157', 7,  'INSIDE_NGERCOIL'),
  ('629158', 9,  'INSIDE_NGERCOIL'),
  ('629159', 11, 'INSIDE_NGERCOIL'),
  ('629160', 13, 'INSIDE_NGERCOIL'),
  ('629161', 3,  'INSIDE_NGERCOIL'),
  ('629162', 14, 'INSIDE_NGERCOIL'),
  ('629163', 15, 'INSIDE_NGERCOIL'),
  ('629164', 16, 'INSIDE_NGERCOIL'),
  ('629165', 17, 'INSIDE_NGERCOIL'),
  ('629166', 6,  'INSIDE_NGERCOIL'),
  ('629167', 8,  'INSIDE_NGERCOIL'),
  ('629168', 10, 'INSIDE_NGERCOIL'),
  ('629169', 12, 'INSIDE_NGERCOIL'),
  ('629170', 14, 'INSIDE_NGERCOIL'),
  ('629171', 4,  'INSIDE_NGERCOIL'),
  ('629172', 18, 'INSIDE_NGERCOIL'),
  ('629173', 19, 'INSIDE_NGERCOIL'),
  ('629174', 20, 'INSIDE_NGERCOIL'),
  ('629175', 5,  'INSIDE_NGERCOIL'),
  ('629176', 7,  'INSIDE_NGERCOIL'),
  ('629177', 12, 'INSIDE_NGERCOIL'),
  ('629178', 14, 'INSIDE_NGERCOIL'),
  ('629179', 16, 'INSIDE_NGERCOIL'),
  ('629180', 18, 'INSIDE_NGERCOIL'),
  ('629181', 20, 'INSIDE_NGERCOIL'),
  ('629182', 9,  'INSIDE_NGERCOIL'),
  ('629183', 11, 'INSIDE_NGERCOIL'),
  ('629184', 13, 'INSIDE_NGERCOIL'),
  ('629185', 15, 'INSIDE_NGERCOIL'),
  ('629186', 17, 'INSIDE_NGERCOIL'),
  ('629187', 3,  'INSIDE_NGERCOIL'),
  ('629188', 19, 'INSIDE_NGERCOIL'),
  ('629189', 21, 'INSIDE_NGERCOIL'),
  ('629190', 22, 'INSIDE_NGERCOIL'),
  ('629192', 6,  'INSIDE_NGERCOIL'),
  ('629193', 5,  'INSIDE_NGERCOIL'),
  ('629194', 10, 'INSIDE_NGERCOIL'),
  ('629195', 12, 'INSIDE_NGERCOIL'),
  ('629196', 14, 'INSIDE_NGERCOIL'),
  ('629197', 16, 'INSIDE_NGERCOIL'),
  ('629198', 18, 'INSIDE_NGERCOIL'),
  ('629199', 20, 'INSIDE_NGERCOIL'),
  ('629201', 4,  'INSIDE_NGERCOIL'),
  ('629202', 6,  'INSIDE_NGERCOIL'),
  ('629203', 8,  'INSIDE_NGERCOIL'),
  ('629204', 10, 'INSIDE_NGERCOIL'),
  ('629205', 12, 'INSIDE_NGERCOIL'),
  ('629206', 14, 'INSIDE_NGERCOIL'),
  ('629207', 16, 'INSIDE_NGERCOIL'),
  ('629209', 18, 'INSIDE_NGERCOIL'),
  ('629210', 20, 'INSIDE_NGERCOIL'),
  ('629501', 25, 'INSIDE_NGERCOIL'),
  ('629502', 26, 'INSIDE_NGERCOIL')
ON CONFLICT (pincode) DO NOTHING;