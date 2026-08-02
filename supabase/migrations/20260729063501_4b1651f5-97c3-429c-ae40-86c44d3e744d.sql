
-- =========== ENUMS ===========
CREATE TYPE public.app_role AS ENUM ('admin', 'staff', 'customer');
CREATE TYPE public.order_channel AS ENUM ('ONLINE', 'IN_STORE');
CREATE TYPE public.order_status AS ENUM ('NEW', 'PROCESSING', 'PACKED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED');
CREATE TYPE public.payment_method AS ENUM ('ONLINE', 'COD', 'CASH', 'UPI', 'CARD');
CREATE TYPE public.payment_status AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDED');
CREATE TYPE public.delivery_type AS ENUM ('DELIVERY', 'PICKUP');

-- =========== PROFILES ===========
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles self select" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "profiles self insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles self update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- =========== USER ROLES ===========
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_roles self read" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

-- Admin can read all roles
CREATE POLICY "user_roles admin all" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- =========== SIGNUP TRIGGER ===========
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, phone)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), COALESCE(NEW.raw_user_meta_data->>'phone', ''));
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'customer') ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========== CATEGORIES ===========
CREATE TABLE public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.categories TO anon, authenticated;
GRANT ALL ON public.categories TO service_role;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "categories public read" ON public.categories FOR SELECT USING (true);
CREATE POLICY "categories admin write" ON public.categories FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- =========== PRODUCTS ===========
CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  discount_price NUMERIC(10,2),
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  image_urls TEXT[] NOT NULL DEFAULT '{}',
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  low_stock_threshold INTEGER NOT NULL DEFAULT 5,
  is_available BOOLEAN NOT NULL DEFAULT true,
  barcode TEXT UNIQUE,
  is_trending BOOLEAN NOT NULL DEFAULT false,
  is_new BOOLEAN NOT NULL DEFAULT false,
  rating NUMERIC(2,1) DEFAULT 4.5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.products TO anon, authenticated;
GRANT ALL ON public.products TO service_role;
GRANT UPDATE ON public.products TO authenticated; -- staff/admin only via policy
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "products public read" ON public.products FOR SELECT USING (true);
CREATE POLICY "products admin all" ON public.products FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- =========== ADDRESSES ===========
CREATE TABLE public.addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  line1 TEXT NOT NULL,
  line2 TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  pincode TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.addresses TO authenticated;
GRANT ALL ON public.addresses TO service_role;
ALTER TABLE public.addresses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "addresses self" ON public.addresses FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- =========== CARTS ===========
CREATE TABLE public.carts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, product_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.carts TO authenticated;
GRANT ALL ON public.carts TO service_role;
ALTER TABLE public.carts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "carts self" ON public.carts FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- =========== WISHLISTS ===========
CREATE TABLE public.wishlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, product_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wishlists TO authenticated;
GRANT ALL ON public.wishlists TO service_role;
ALTER TABLE public.wishlists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wishlists self" ON public.wishlists FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- =========== ORDERS ===========
CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  channel public.order_channel NOT NULL,
  status public.order_status NOT NULL DEFAULT 'NEW',
  payment_method public.payment_method NOT NULL,
  payment_status public.payment_status NOT NULL DEFAULT 'PENDING',
  delivery_type public.delivery_type,
  address_id UUID REFERENCES public.addresses(id) ON DELETE SET NULL,
  address_snapshot JSONB,
  subtotal NUMERIC(10,2) NOT NULL DEFAULT 0,
  discount NUMERIC(10,2) NOT NULL DEFAULT 0,
  delivery_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  total NUMERIC(10,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "orders self read" ON public.orders FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));
CREATE POLICY "orders admin/staff write" ON public.orders FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

-- =========== ORDER ITEMS ===========
CREATE TABLE public.order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id),
  product_name TEXT NOT NULL,
  unit_price NUMERIC(10,2) NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  line_total NUMERIC(10,2) NOT NULL
);
GRANT SELECT, INSERT ON public.order_items TO authenticated;
GRANT ALL ON public.order_items TO service_role;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "order_items via order" ON public.order_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_id AND (o.user_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff'))));
CREATE POLICY "order_items admin/staff write" ON public.order_items FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff'));

-- =========== STATUS EVENTS ===========
CREATE TABLE public.order_status_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  status public.order_status NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.order_status_events TO authenticated;
GRANT ALL ON public.order_status_events TO service_role;
ALTER TABLE public.order_status_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "status events via order" ON public.order_status_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_id AND (o.user_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff'))));
CREATE POLICY "status events admin/staff write" ON public.order_status_events FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff'));

-- =========== PLACE_ORDER FUNCTION ===========
CREATE OR REPLACE FUNCTION public.place_order(
  _channel public.order_channel,
  _payment_method public.payment_method,
  _delivery_type public.delivery_type,
  _address_id UUID,
  _items JSONB, -- [{product_id, quantity}]
  _notes TEXT DEFAULT NULL
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
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- staff/admin required for in-store
  IF _channel = 'IN_STORE' AND NOT (public.has_role(_uid, 'staff') OR public.has_role(_uid, 'admin')) THEN
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
    CASE WHEN _payment_method IN ('CASH','CARD','UPI','ONLINE') AND _channel = 'IN_STORE' THEN 'PAID'
         WHEN _payment_method = 'ONLINE' THEN 'PAID'
         ELSE 'PENDING' END
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

  UPDATE public.orders SET subtotal = _subtotal, total = _subtotal + _delivery_fee, notes = _notes WHERE id = _order_id;

  INSERT INTO public.order_status_events (order_id, status, note) VALUES (_order_id, 'NEW', 'Order placed');

  -- Clear cart for online orders
  IF _channel = 'ONLINE' THEN
    DELETE FROM public.carts WHERE user_id = _uid;
  END IF;

  RETURN _order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_order(public.order_channel, public.payment_method, public.delivery_type, UUID, JSONB, TEXT) TO authenticated;

-- =========== SEED CATEGORIES + PRODUCTS ===========
INSERT INTO public.categories (name, slug, image_url) VALUES
  ('Handmade Pottery', 'pottery', 'https://images.unsplash.com/photo-1493106641515-6b5631de4bb9?w=800'),
  ('Knitting & Yarn', 'knitting', 'https://images.unsplash.com/photo-1584992236310-6ded1d34e1e0?w=800'),
  ('Paper Crafts', 'paper-crafts', 'https://images.unsplash.com/photo-1513542789411-b6a5d4f31634?w=800'),
  ('Candles & Soaps', 'candles-soaps', 'https://images.unsplash.com/photo-1602523499998-8e5b0e42d3b6?w=800');

INSERT INTO public.products (name, slug, description, price, discount_price, category_id, image_urls, stock, is_trending, is_new, barcode) VALUES
  ('Terracotta Vase', 'terracotta-vase', 'Handcrafted terracotta vase, perfect for dried flowers.', 899, 749, (SELECT id FROM public.categories WHERE slug='pottery'), ARRAY['https://images.unsplash.com/photo-1578500494198-246f612d3b3d?w=800'], 15, true, true, 'CS1001'),
  ('Ceramic Mug Set', 'ceramic-mug-set', 'Set of 2 pastel glaze ceramic mugs.', 649, NULL, (SELECT id FROM public.categories WHERE slug='pottery'), ARRAY['https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?w=800'], 22, false, true, 'CS1002'),
  ('Clay Planter', 'clay-planter', 'Small clay planter with drainage hole.', 349, 299, (SELECT id FROM public.categories WHERE slug='pottery'), ARRAY['https://images.unsplash.com/photo-1485955900006-10f4d324d411?w=800'], 30, true, false, 'CS1003'),
  ('Chunky Merino Yarn', 'chunky-merino-yarn', 'Super soft merino wool, peach shade, 200g.', 499, NULL, (SELECT id FROM public.categories WHERE slug='knitting'), ARRAY['https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=800'], 40, true, false, 'CS2001'),
  ('Bamboo Knitting Needles', 'bamboo-needles', 'Set of 5 bamboo knitting needles.', 299, 249, (SELECT id FROM public.categories WHERE slug='knitting'), ARRAY['https://images.unsplash.com/photo-1615486511293-84e2733fc9b4?w=800'], 18, false, true, 'CS2002'),
  ('Cotton Yarn Bundle', 'cotton-yarn-bundle', 'Pastel cotton yarn bundle, 5 colours.', 799, 699, (SELECT id FROM public.categories WHERE slug='knitting'), ARRAY['https://images.unsplash.com/photo-1580227974546-fbd48825d991?w=800'], 12, true, true, 'CS2003'),
  ('Origami Paper Pack', 'origami-paper-pack', '100 sheets, assorted pastel colours.', 249, NULL, (SELECT id FROM public.categories WHERE slug='paper-crafts'), ARRAY['https://images.unsplash.com/photo-1513542789411-b6a5d4f31634?w=800'], 50, false, true, 'CS3001'),
  ('Handmade Journal', 'handmade-journal', 'A5 handmade paper journal with cotton cover.', 549, 499, (SELECT id FROM public.categories WHERE slug='paper-crafts'), ARRAY['https://images.unsplash.com/photo-1531346878377-a5be20888e57?w=800'], 20, true, false, 'CS3002'),
  ('Craft Punch Set', 'craft-punch-set', 'Set of 6 shaped craft punches.', 899, 799, (SELECT id FROM public.categories WHERE slug='paper-crafts'), ARRAY['https://images.unsplash.com/photo-1611262588024-d12430b98920?w=800'], 8, false, false, 'CS3003'),
  ('Soy Wax Candle', 'soy-wax-candle', 'Vanilla and honey soy wax candle, 200g.', 449, 399, (SELECT id FROM public.categories WHERE slug='candles-soaps'), ARRAY['https://images.unsplash.com/photo-1602523499998-8e5b0e42d3b6?w=800'], 25, true, true, 'CS4001'),
  ('Handmade Soap Trio', 'handmade-soap-trio', 'Lavender, rose and citrus handmade soaps.', 599, NULL, (SELECT id FROM public.categories WHERE slug='candles-soaps'), ARRAY['https://images.unsplash.com/photo-1600857544200-b2f666a9a2ec?w=800'], 33, true, false, 'CS4002'),
  ('Beeswax Candle', 'beeswax-candle', 'Pure beeswax pillar candle.', 699, 599, (SELECT id FROM public.categories WHERE slug='candles-soaps'), ARRAY['https://images.unsplash.com/photo-1608181831718-c9ffd8728ea6?w=800'], 3, false, true, 'CS4003');
