-- Supplies Master Table
-- Centralized supply records linked to suppliers for Purchase Entry integration

CREATE TABLE IF NOT EXISTS public.supplies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  category TEXT,
  unit TEXT DEFAULT 'Nos',
  rate NUMERIC DEFAULT 0,
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast name search
CREATE INDEX IF NOT EXISTS idx_supplies_name ON public.supplies USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_supplies_active ON public.supplies (is_active) WHERE is_active = true;

-- Enable Row Level Security
ALTER TABLE public.supplies ENABLE ROW LEVEL SECURITY;

-- Admin/Staff can do everything
CREATE POLICY "supplies_admin_all" ON public.supplies
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('admin', 'staff')
    )
  );

-- Public can read active supplies (for autocomplete)
CREATE POLICY "supplies_public_read" ON public.supplies
  FOR SELECT
  TO anon
  USING (is_active = true);

-- Allow authenticated users to read active supplies
CREATE POLICY "supplies_auth_read" ON public.supplies
  FOR SELECT
  TO authenticated
  USING (is_active = true);
