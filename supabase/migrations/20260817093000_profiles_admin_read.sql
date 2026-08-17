-- ============================================================================
-- ADMIN/STAFF CAN READ ALL PROFILES — run in the Supabase Dashboard → SQL Editor
-- ============================================================================
-- The profiles table only had a "self select" policy (auth.uid() = id), so
-- admin screens querying profiles from the client (Customers, Users & Staff)
-- only ever saw the logged-in user's own row. This adds an override policy so
-- admins/staff can read every profile. Safe to re-run.
-- ============================================================================

DROP POLICY IF EXISTS "profiles admin read" ON public.profiles;
CREATE POLICY "profiles admin read"
  ON public.profiles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));