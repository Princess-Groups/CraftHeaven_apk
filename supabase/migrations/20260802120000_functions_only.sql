-- ============================================================================
-- FUNCTIONS ONLY — run this in Supabase Dashboard → SQL Editor → Run
-- ============================================================================
-- Creates ONLY the database functions the app needs. Safe to re-run: every
-- function uses CREATE OR REPLACE. Does NOT create enums/tables/policies
-- (they already exist). If you see "already exists" for anything here, that is
-- expected and harmless — the script still completes.
-- ============================================================================

-- ---------- has_role ----------
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO authenticated;

-- ---------- handle_new_user (signup trigger) ----------
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

-- ---------- place_order (with coupon discount) ----------
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
    CASE WHEN _channel = 'IN_STORE' AND _payment_method IN ('CASH','CARD','UPI') THEN 'PAID'::public.payment_status ELSE 'PENDING'::public.payment_status END
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

-- ---------- confirm_upi_payment ----------
CREATE OR REPLACE FUNCTION public.confirm_upi_payment(_order_id UUID, _utr TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  UPDATE public.orders
  SET payment_status = 'PAID'::public.payment_status,
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

-- ---------- update_order_status (admin/staff) ----------
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

-- ---------- bootstrap_admin ----------
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

-- ---------- apply_purchase_stock (trigger for purchases) ----------
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

-- ---------- notify_low_stock (trigger for products) ----------
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

-- ---------- DONE ----------
-- If you got here, all functions are installed. You can now verify by checking
-- that place_order, confirm_upi_payment, and update_order_status all respond
-- (they'll return "Not authenticated" instead of "not found" when called).
