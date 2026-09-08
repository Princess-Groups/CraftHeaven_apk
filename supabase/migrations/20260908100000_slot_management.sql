-- Slot Management Table
-- Centralized slot cost management for purchase entries

CREATE TABLE IF NOT EXISTS public.slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  total_charges NUMERIC DEFAULT 0,
  packing_charges NUMERIC DEFAULT 0,
  freight_charges NUMERIC DEFAULT 0,
  other_charges NUMERIC DEFAULT 0,
  total_quantity NUMERIC DEFAULT 0,
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast name search
CREATE INDEX IF NOT EXISTS idx_slots_name ON public.slots (name);
CREATE INDEX IF NOT EXISTS idx_slots_active ON public.slots (is_active) WHERE is_active = true;

-- Enable Row Level Security
ALTER TABLE public.slots ENABLE ROW LEVEL SECURITY;

-- Admin/Staff can do everything
CREATE POLICY "slots_admin_all" ON public.slots
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('admin', 'staff')
    )
  );

-- Allow authenticated users to read active slots
CREATE POLICY "slots_auth_read" ON public.slots
  FOR SELECT
  TO authenticated
  USING (is_active = true);
