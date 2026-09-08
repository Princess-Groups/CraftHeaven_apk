-- Materials Master Table
-- Materials linked to categories for Purchase Entry integration

CREATE TABLE IF NOT EXISTS public.materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category_id UUID REFERENCES public.categories(id) ON DELETE CASCADE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast search
CREATE INDEX IF NOT EXISTS idx_materials_name ON public.materials (name);
CREATE INDEX IF NOT EXISTS idx_materials_category ON public.materials (category_id);
CREATE INDEX IF NOT EXISTS idx_materials_active ON public.materials (is_active) WHERE is_active = true;

-- Enable Row Level Security
ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;

-- Admin/Staff can do everything
CREATE POLICY "materials_admin_all" ON public.materials
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.role IN ('admin', 'staff')
    )
  );

-- Allow authenticated users to read active materials
CREATE POLICY "materials_auth_read" ON public.materials
  FOR SELECT
  TO authenticated
  USING (is_active = true);
