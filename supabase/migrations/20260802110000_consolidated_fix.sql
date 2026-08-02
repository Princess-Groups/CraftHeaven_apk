-- ============================================================================
-- CONSOLIDATED FIX — run this in the Supabase Dashboard → SQL Editor → Run
-- ============================================================================
-- Purpose: brings a schema-only project (tables exist, functions missing) up to
-- full working state. Safe to run on an existing project: every CREATE is
-- OR REPLACE / IF NOT EXISTS, every policy is DROP + re-CREATE, every seed is
-- ON CONFLICT DO NOTHING.
-- ============================================================================

-- ---------- 1) ENUMS ----------
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin','staff','customer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.order_channel AS ENUM ('ONLINE','IN_STORE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.order_status AS ENUM ('NEW','PROCESSING','PACKED','OUT_FOR_DELIVERY','DELIVERED','CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.payment_method AS ENUM ('ONLINE','COD','CASH','UPI','CARD');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.payment_status AS ENUM ('PENDING','PAID','FAILED','REFUNDED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.delivery_type AS ENUM ('DELIVERY','PICKUP');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- 2) ROLES + has_role ----------
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

-- ---------- 3) SIGNUP TRIGGER (profile + roles) ----------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _has_admin BOOLEAN;
BEGIN
  INSERT INTO public.profiles (id, full_name, phone)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name',''), COALESCE(NEW.raw_user_meta_data->>'phone',''));
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE role='admin') INTO _has_admin;
  IF NOT _has_admin THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;
  END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'customer') ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------- 4) PLACE_ORDER (with coupon discount + POS paid logic) ----------
CREATE OR REPLACE FUNCTION public.place_order(
  _channel public.order_channel,
  _payment_method public.payment_method,
  _delivery_type public.delivery_type,
  _address_id UUID,
  _items JSONB,
  _notes TEXT DEFAULT NULL,
  _discount NUMERIC(10,2) DEFAULT 0
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _order_id UUID;
  _uid UUID := auth.uid();
  _item JSONB;
  _product RECORD;
  _qty INTEGER;
  _price NUMERIC(10,2);
  _subtotal NUMERIC(10,2) := 0;
  _delivery_fee NUMERIC(10,2) := 0;
  _address_snapshot JSONB := NULL;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _channel = 'IN_STORE' AND NOT (public.has_role(_uid,'staff') OR public.has_role(_uid,'admin')) THEN
    RAISE EXCEPTION 'Not authorized for in-store sale';
  END IF;
  IF _delivery_type = 'DELIVERY' AND _address_id IS NOT NULL THEN
    SELECT to_jsonb(a) INTO _address_snapshot FROM public.addresses a WHERE a.id = _address_id AND a.user_id = _uid;
    _delivery_fee := 40;
  END IF;
  INSERT INTO public.orders (user_id, channel, payment_method, delivery_type, address_id, address_snapshot, created_by, subtotal, delivery_fee, total, status, payment_status)
  VALUES (
    CASE WHEN _channel = 'ONLINE' THEN _uid ELSE NULL END,
    _channel, _payment_method, _delivery_type, _address_id, _address_snapshot, _uid, 0, _delivery_fee, 0, 'NEW',
    CASE WHEN _channel = 'IN_STORE' AND _payment_method IN ('CASH','CARD','UPI') THEN 'PAID' ELSE 'PENDING' END
  )
  RETURNING id INTO _order_id;
  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _qty := (_item->>'quantity')::INTEGER;
    SELECT * INTO _product FROM public.products WHERE id = (_item->>'product_id')::UUID FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Product not found'; END IF;
    IF _product.stock < _qty THEN RAISE EXCEPTION 'Insufficient stock for %', _product.name; END IF;
    _price := COALESCE(_product.discount_price, _product.price);
    _subtotal := _subtotal + (_price * _qty);
    INSERT INTO public.order_items (order_id, product_id, product_name, unit_price, quantity, line_total)
    VALUES (_order_id, _product.id, _product.name, _price, _qty, _price * _qty);
    UPDATE public.products
      SET stock = stock - _qty,
          is_available = CASE WHEN (stock - _qty) <= 0 THEN false ELSE is_available END
      WHERE id = _product.id;
  END LOOP;
  _discount := LEAST(_discount, _subtotal);
  UPDATE public.orders
    SET subtotal = _subtotal, discount = _discount, total = _subtotal - _discount + _delivery_fee, notes = _notes
    WHERE id = _order_id;
  INSERT INTO public.order_status_events (order_id, status, note) VALUES (_order_id, 'NEW', 'Order placed');
  IF _channel = 'ONLINE' THEN
    DELETE FROM public.carts WHERE user_id = _uid;
  END IF;
  RETURN _order_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.place_order(public.order_channel, public.payment_method, public.delivery_type, UUID, JSONB, TEXT, NUMERIC) TO authenticated;

-- ---------- 5) CONFIRM UPI PAYMENT ----------
CREATE OR REPLACE FUNCTION public.confirm_upi_payment(_order_id UUID, _utr TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  UPDATE public.orders
  SET payment_status = 'PAID',
      notes = CASE
        WHEN notes IS NULL OR notes = '' THEN 'UPI paid · UTR ' || _utr
        ELSE notes || ' · UPI paid · UTR ' || _utr
      END
  WHERE id = _order_id AND user_id = _uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found or not yours'; END IF;
  RETURN TRUE;
END;
$$;
GRANT EXECUTE ON FUNCTION public.confirm_upi_payment(UUID, TEXT) TO authenticated;

-- ---------- 6) UPDATE ORDER STATUS (admin/staff) ----------
CREATE OR REPLACE FUNCTION public.update_order_status(
  _order_id UUID, _status public.order_status, _note TEXT DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (public.has_role(_uid,'admin') OR public.has_role(_uid,'staff')) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  UPDATE public.orders SET status = _status, updated_at = now() WHERE id = _order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  INSERT INTO public.order_status_events (order_id, status, note)
  VALUES (_order_id, _status, COALESCE(_note, 'Status updated from admin'));
  RETURN TRUE;
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_order_status(UUID, public.order_status, TEXT) TO authenticated;

-- ---------- 7) BOOTSTRAP ADMIN ----------
CREATE OR REPLACE FUNCTION public.bootstrap_admin() RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _uid UUID := auth.uid(); _has_admin BOOLEAN;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE role='admin') INTO _has_admin;
  IF _has_admin THEN RETURN false; END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'admin') ON CONFLICT DO NOTHING;
  RETURN true;
END; $$;
GRANT EXECUTE ON FUNCTION public.bootstrap_admin() TO authenticated;

-- ---------- 8) PURCHASE STOCK TRIGGER ----------
CREATE OR REPLACE FUNCTION public.apply_purchase_stock() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE public.products
    SET stock = stock + NEW.quantity, is_available = true, purchase_price = COALESCE(NEW.unit_cost, purchase_price)
    WHERE id = NEW.product_id;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_apply_purchase_stock ON public.purchase_items;
CREATE TRIGGER trg_apply_purchase_stock AFTER INSERT ON public.purchase_items
  FOR EACH ROW EXECUTE FUNCTION public.apply_purchase_stock();

-- ---------- 9) LOW-STOCK NOTIFICATION TRIGGER ----------
CREATE OR REPLACE FUNCTION public.notify_low_stock() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.stock <= 0 AND OLD.stock > 0 THEN
    INSERT INTO public.admin_notifications(kind,title,body,meta)
    VALUES ('OUT_OF_STOCK','Out of stock: '||NEW.name, NEW.name||' is now out of stock.', jsonb_build_object('product_id',NEW.id));
  ELSIF NEW.stock <= NEW.reorder_level AND OLD.stock > NEW.reorder_level THEN
    INSERT INTO public.admin_notifications(kind,title,body,meta)
    VALUES ('LOW_STOCK','Low stock: '||NEW.name, NEW.name||' has '||NEW.stock||' left.', jsonb_build_object('product_id',NEW.id));
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_notify_low_stock ON public.products;
CREATE TRIGGER trg_notify_low_stock AFTER UPDATE OF stock ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.notify_low_stock();

-- ---------- 10) RLS POLICIES (drop + recreate — safe to re-run) ----------
DROP POLICY IF EXISTS "profiles self select" ON public.profiles;
CREATE POLICY "profiles self select" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
DROP POLICY IF EXISTS "profiles self insert" ON public.profiles;
CREATE POLICY "profiles self insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "profiles self update" ON public.profiles;
CREATE POLICY "profiles self update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS "user_roles self read" ON public.user_roles;
CREATE POLICY "user_roles self read" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "user_roles admin all" ON public.user_roles;
CREATE POLICY "user_roles admin all" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "categories public read" ON public.categories;
CREATE POLICY "categories public read" ON public.categories FOR SELECT USING (true);
DROP POLICY IF EXISTS "categories admin write" ON public.categories;
CREATE POLICY "categories admin write" ON public.categories FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "products public read" ON public.products;
CREATE POLICY "products public read" ON public.products FOR SELECT USING (true);
DROP POLICY IF EXISTS "products admin all" ON public.products;
CREATE POLICY "products admin all" ON public.products FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "addresses self" ON public.addresses;
CREATE POLICY "addresses self" ON public.addresses FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "carts self" ON public.carts;
CREATE POLICY "carts self" ON public.carts FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "wishlists self" ON public.wishlists;
CREATE POLICY "wishlists self" ON public.wishlists FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "orders self read" ON public.orders;
CREATE POLICY "orders self read" ON public.orders FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff'));
DROP POLICY IF EXISTS "orders admin/staff write" ON public.orders;
CREATE POLICY "orders admin/staff write" ON public.orders FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff')) WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff'));

DROP POLICY IF EXISTS "order_items via order" ON public.order_items;
CREATE POLICY "order_items via order" ON public.order_items FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_id AND (o.user_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff'))));
DROP POLICY IF EXISTS "order_items admin/staff write" ON public.order_items;
CREATE POLICY "order_items admin/staff write" ON public.order_items FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff')) WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff'));

DROP POLICY IF EXISTS "status events via order" ON public.order_status_events;
CREATE POLICY "status events via order" ON public.order_status_events FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_id AND (o.user_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff'))));
DROP POLICY IF EXISTS "status events admin/staff write" ON public.order_status_events;
CREATE POLICY "status events admin/staff write" ON public.order_status_events FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff')) WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff'));

DROP POLICY IF EXISTS "brands public read" ON public.brands;
CREATE POLICY "brands public read" ON public.brands FOR SELECT USING (true);
DROP POLICY IF EXISTS "brands admin write" ON public.brands;
CREATE POLICY "brands admin write" ON public.brands FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
DROP POLICY IF EXISTS "suppliers admin/staff" ON public.suppliers;
CREATE POLICY "suppliers admin/staff" ON public.suppliers FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff')) WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff'));
DROP POLICY IF EXISTS "purchases admin/staff" ON public.purchases;
CREATE POLICY "purchases admin/staff" ON public.purchases FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff')) WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff'));
DROP POLICY IF EXISTS "purchase_items admin/staff" ON public.purchase_items;
CREATE POLICY "purchase_items admin/staff" ON public.purchase_items FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff')) WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff'));
DROP POLICY IF EXISTS "activity_logs admin read" ON public.activity_logs;
CREATE POLICY "activity_logs admin read" ON public.activity_logs FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
DROP POLICY IF EXISTS "activity_logs self insert" ON public.activity_logs;
CREATE POLICY "activity_logs self insert" ON public.activity_logs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "admin_notifications admin/staff" ON public.admin_notifications;
CREATE POLICY "admin_notifications admin/staff" ON public.admin_notifications FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff')) WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff'));

-- ---------- 11) GRANTS ----------
GRANT SELECT ON public.products TO anon, authenticated;
GRANT UPDATE ON public.products TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.addresses TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.carts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wishlists TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.orders TO authenticated;
GRANT SELECT, INSERT ON public.order_items TO authenticated;
GRANT SELECT, INSERT ON public.order_status_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brands TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.suppliers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchases TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_items TO authenticated;
GRANT SELECT, INSERT ON public.activity_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.admin_notifications TO authenticated;

-- ---------- 12) SEED: categories (safe re-run) ----------
INSERT INTO public.categories (name, slug, image_url) VALUES
  ('Resin Art', 'resin-art', 'https://images.unsplash.com/photo-1615529162924-f8605388461d?w=600'),
  ('Crochet', 'crochet', 'https://images.unsplash.com/photo-1615486511484-92e172cc4fe0?w=600'),
  ('Yarn', 'yarn', 'https://images.unsplash.com/photo-1580803317811-7d1c9b6a4b40?w=600'),
  ('Painting', 'painting', 'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=600'),
  ('Brushes', 'brushes', 'https://images.unsplash.com/photo-1513519245088-0e12902e5a38?w=600'),
  ('Clay', 'clay', 'https://images.unsplash.com/photo-1565193566173-7a0ee3dbe261?w=600'),
  ('DIY Kits', 'diy-kits', 'https://images.unsplash.com/photo-1499744937866-d7e566a20a61?w=600'),
  ('Jewellery Making', 'jewellery-making', 'https://images.unsplash.com/photo-1611652022419-a9419f74343d?w=600'),
  ('Stationery', 'stationery', 'https://images.unsplash.com/photo-1544816155-12df9643f363?w=600'),
  ('Handmade Gifts', 'handmade-gifts', 'https://images.unsplash.com/photo-1512909006721-3d6018887383?w=600'),
  ('Creative Classes', 'creative-classes', 'https://images.unsplash.com/photo-1452860606245-08befc0ff44b?w=600')
ON CONFLICT (slug) DO NOTHING;

-- (Products are not re-seeded here — they already exist in the project.
--  If you need the sample catalog, use the product "Add product" screen in the
--  admin dashboard.)
