-- ============================================================
-- MULTI-CHANNEL INVENTORY & E-COMMERCE MANAGEMENT SYSTEM
-- Migration: 20260904000000_multi_channel_system.sql
-- ============================================================
-- This migration creates all new tables for the Multi-Channel
-- Management module WITHOUT modifying any existing tables.
-- ============================================================

-- ==================== ENUMS ====================

-- Channel types for multi-channel sales
CREATE TYPE mc_channel AS ENUM ('WEBSITE', 'AMAZON', 'FLIPKART', 'MEESHO', 'OTHER');

-- Inventory movement types
CREATE TYPE mc_movement_type AS ENUM (
  'PURCHASE', 'SALE', 'RETURN', 'ADJUSTMENT', 'TRANSFER',
  'DAMAGED', 'CORRECTION', 'RESERVATION', 'RELEASE'
);

-- Marketplace order statuses (extended set)
CREATE TYPE mc_order_status AS ENUM (
  'NEW', 'CONFIRMED', 'PROCESSING', 'PACKED', 'SHIPPED',
  'DELIVERED', 'CANCELLED', 'RETURNED', 'REFUNDED'
);

-- Marketplace connection status
CREATE TYPE mc_connection_status AS ENUM (
  'DISCONNECTED', 'CONNECTING', 'CONNECTED', 'ERROR', 'SYNCING'
);

-- Sync job status
CREATE TYPE mc_sync_status AS ENUM (
  'PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'
);

-- Product status in master database
CREATE TYPE mc_product_status AS ENUM (
  'ACTIVE', 'INACTIVE', 'DRAFT', 'DISCONTINUED'
);

-- Cost component types
CREATE TYPE mc_cost_type AS ENUM (
  'PURCHASE', 'GST', 'SHIPPING', 'TRANSPORT', 'PACKAGING',
  'MARKETPLACE_FEE', 'COMMISSION', 'PAYMENT_GATEWAY', 'OTHER'
);

-- ==================== MASTER PRODUCTS ====================

CREATE TABLE mc_master_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  sku TEXT UNIQUE,
  barcode TEXT,
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  subcategory TEXT,
  brand_id UUID REFERENCES brands(id) ON DELETE SET NULL,
  description TEXT,
  image_url TEXT,
  size TEXT,
  colour TEXT,
  material TEXT,
  unit TEXT DEFAULT 'Nos',
  purchase_price NUMERIC(12,2) DEFAULT 0,
  base_cost NUMERIC(12,2) DEFAULT 0,
  selling_price NUMERIC(12,2) DEFAULT 0,
  minimum_stock NUMERIC(10,2) DEFAULT 5,
  current_stock NUMERIC(10,2) DEFAULT 0,
  available_stock NUMERIC(10,2) DEFAULT 0,
  reserved_stock NUMERIC(10,2) DEFAULT 0,
  damaged_stock NUMERIC(10,2) DEFAULT 0,
  supplier_name TEXT,
  gst_rate NUMERIC(5,2) DEFAULT 0,
  status mc_product_status DEFAULT 'ACTIVE',
  -- Link to existing product if mapped
  linked_product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ==================== PRODUCT VARIANTS ====================

CREATE TABLE mc_product_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  master_product_id UUID NOT NULL REFERENCES mc_master_products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sku TEXT,
  barcode TEXT,
  size TEXT,
  colour TEXT,
  material TEXT,
  purchase_price NUMERIC(12,2) DEFAULT 0,
  selling_price NUMERIC(12,2) DEFAULT 0,
  stock NUMERIC(10,2) DEFAULT 0,
  image_url TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ==================== CHANNEL PRICES ====================

CREATE TABLE mc_channel_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  master_product_id UUID NOT NULL REFERENCES mc_master_products(id) ON DELETE CASCADE,
  channel mc_channel NOT NULL,
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  min_price NUMERIC(12,2),
  max_price NUMERIC(12,2),
  discount_price NUMERIC(12,2),
  promotional_price NUMERIC(12,2),
  platform_margin_pct NUMERIC(5,2) DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(master_product_id, channel)
);

-- ==================== INVENTORY ====================

CREATE TABLE mc_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  master_product_id UUID NOT NULL REFERENCES mc_master_products(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES mc_product_variants(id) ON DELETE CASCADE,
  physical_stock NUMERIC(10,2) DEFAULT 0,
  available_stock NUMERIC(10,2) DEFAULT 0,
  reserved_stock NUMERIC(10,2) DEFAULT 0,
  sold_stock NUMERIC(10,2) DEFAULT 0,
  damaged_stock NUMERIC(10,2) DEFAULT 0,
  reorder_level NUMERIC(10,2) DEFAULT 5,
  last_updated TIMESTAMPTZ DEFAULT now(),
  UNIQUE(master_product_id, variant_id)
);

-- ==================== INVENTORY MOVEMENTS ====================

CREATE TABLE mc_inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  master_product_id UUID NOT NULL REFERENCES mc_master_products(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES mc_product_variants(id) ON DELETE SET NULL,
  quantity NUMERIC(10,2) NOT NULL,
  movement_type mc_movement_type NOT NULL,
  channel mc_channel,
  source TEXT,
  destination TEXT,
  reference_id TEXT,
  notes TEXT,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ==================== INVENTORY RESERVATIONS ====================

CREATE TABLE mc_inventory_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  master_product_id UUID NOT NULL REFERENCES mc_master_products(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES mc_product_variants(id) ON DELETE SET NULL,
  channel mc_channel NOT NULL,
  order_reference TEXT NOT NULL,
  quantity NUMERIC(10,2) NOT NULL,
  status TEXT DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CONFIRMED', 'RELEASED', 'EXPIRED')),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ==================== MARKETPLACE CHANNELS ====================

CREATE TABLE mc_marketplace_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  channel mc_channel NOT NULL UNIQUE,
  is_enabled BOOLEAN DEFAULT false,
  connection_status mc_connection_status DEFAULT 'DISCONNECTED',
  sync_frequency_minutes INTEGER DEFAULT 60,
  inventory_sync BOOLEAN DEFAULT true,
  product_sync BOOLEAN DEFAULT true,
  price_sync BOOLEAN DEFAULT true,
  order_sync BOOLEAN DEFAULT true,
  default_pricing_rule TEXT DEFAULT 'FIXED',
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Seed default channels
INSERT INTO mc_marketplace_channels (name, channel, is_enabled) VALUES
  ('Website', 'WEBSITE', true),
  ('Amazon', 'AMAZON', false),
  ('Flipkart', 'FLIPKART', false),
  ('Meesho', 'MEESHO', false);

-- ==================== MARKETPLACE CONNECTIONS ====================

CREATE TABLE mc_marketplace_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES mc_marketplace_channels(id) ON DELETE CASCADE,
  seller_id TEXT,
  api_key_encrypted TEXT,
  api_secret_encrypted TEXT,
  marketplace_name TEXT,
  region TEXT DEFAULT 'IN',
  status mc_connection_status DEFAULT 'DISCONNECTED',
  last_sync_at TIMESTAMPTZ,
  error_message TEXT,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ==================== MARKETPLACE PRODUCTS ====================

CREATE TABLE mc_marketplace_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  master_product_id UUID NOT NULL REFERENCES mc_master_products(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES mc_marketplace_channels(id) ON DELETE CASCADE,
  marketplace_product_id TEXT,
  marketplace_sku TEXT,
  listing_status TEXT DEFAULT 'DRAFT',
  sync_status TEXT DEFAULT 'PENDING',
  last_synced_at TIMESTAMPTZ,
  marketplace_data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(master_product_id, channel_id)
);

-- ==================== MARKETPLACE ORDERS ====================

CREATE TABLE mc_marketplace_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES mc_marketplace_channels(id) ON DELETE CASCADE,
  marketplace_order_id TEXT NOT NULL,
  customer_name TEXT,
  customer_email TEXT,
  customer_phone TEXT,
  shipping_address JSONB,
  status mc_order_status DEFAULT 'NEW',
  payment_status TEXT DEFAULT 'PENDING',
  payment_method TEXT,
  subtotal NUMERIC(12,2) DEFAULT 0,
  discount NUMERIC(12,2) DEFAULT 0,
  shipping_charges NUMERIC(12,2) DEFAULT 0,
  tax NUMERIC(12,2) DEFAULT 0,
  total NUMERIC(12,2) DEFAULT 0,
  platform_fees NUMERIC(12,2) DEFAULT 0,
  commission NUMERIC(12,2) DEFAULT 0,
  net_amount NUMERIC(12,2) DEFAULT 0,
  marketplace_data JSONB DEFAULT '{}',
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(channel_id, marketplace_order_id)
);

-- ==================== MARKETPLACE ORDER ITEMS ====================

CREATE TABLE mc_marketplace_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES mc_marketplace_orders(id) ON DELETE CASCADE,
  master_product_id UUID REFERENCES mc_master_products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  sku TEXT,
  quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_price NUMERIC(12,2) DEFAULT 0,
  discount NUMERIC(12,2) DEFAULT 0,
  tax NUMERIC(12,2) DEFAULT 0,
  total NUMERIC(12,2) DEFAULT 0,
  marketplace_data JSONB DEFAULT '{}'
);

-- ==================== SALES TRANSACTIONS ====================

CREATE TABLE mc_sales_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel mc_channel NOT NULL,
  marketplace_order_id UUID REFERENCES mc_marketplace_orders(id) ON DELETE SET NULL,
  customer_name TEXT,
  customer_email TEXT,
  subtotal NUMERIC(12,2) DEFAULT 0,
  discount NUMERIC(12,2) DEFAULT 0,
  shipping NUMERIC(12,2) DEFAULT 0,
  tax NUMERIC(12,2) DEFAULT 0,
  platform_fees NUMERIC(12,2) DEFAULT 0,
  total NUMERIC(12,2) DEFAULT 0,
  payment_status TEXT DEFAULT 'PENDING',
  order_status mc_order_status DEFAULT 'NEW',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ==================== COST COMPONENTS ====================

CREATE TABLE mc_cost_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  master_product_id UUID NOT NULL REFERENCES mc_master_products(id) ON DELETE CASCADE,
  cost_type mc_cost_type NOT NULL,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  percentage NUMERIC(5,2),
  description TEXT,
  channel mc_channel,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ==================== PRODUCT COSTS (Calculated) ====================

CREATE TABLE mc_product_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  master_product_id UUID NOT NULL REFERENCES mc_master_products(id) ON DELETE CASCADE,
  purchase_cost NUMERIC(12,2) DEFAULT 0,
  gst_amount NUMERIC(12,2) DEFAULT 0,
  shipping_cost NUMERIC(12,2) DEFAULT 0,
  transport_cost NUMERIC(12,2) DEFAULT 0,
  packaging_cost NUMERIC(12,2) DEFAULT 0,
  marketplace_fee NUMERIC(12,2) DEFAULT 0,
  commission NUMERIC(12,2) DEFAULT 0,
  payment_gateway_charges NUMERIC(12,2) DEFAULT 0,
  other_expenses NUMERIC(12,2) DEFAULT 0,
  landed_cost NUMERIC(12,2) DEFAULT 0,
  gross_profit NUMERIC(12,2) DEFAULT 0,
  net_profit NUMERIC(12,2) DEFAULT 0,
  profit_margin_pct NUMERIC(5,2) DEFAULT 0,
  calculated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(master_product_id)
);

-- ==================== SYNC JOBS ====================

CREATE TABLE mc_sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES mc_marketplace_channels(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL CHECK (job_type IN ('PRODUCT', 'INVENTORY', 'PRICE', 'ORDER')),
  status mc_sync_status DEFAULT 'PENDING',
  items_total INTEGER DEFAULT 0,
  items_synced INTEGER DEFAULT 0,
  items_failed INTEGER DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ==================== SYNC LOGS ====================

CREATE TABLE mc_sync_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES mc_sync_jobs(id) ON DELETE CASCADE,
  level TEXT DEFAULT 'INFO' CHECK (level IN ('INFO', 'WARNING', 'ERROR')),
  message TEXT NOT NULL,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ==================== MULTI-CHANNEL NOTIFICATIONS ====================

CREATE TABLE mc_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body TEXT,
  kind TEXT DEFAULT 'info' CHECK (kind IN ('info', 'warning', 'error', 'success')),
  channel mc_channel,
  entity_type TEXT,
  entity_id UUID,
  meta JSONB DEFAULT '{}',
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ==================== IMPORT JOBS ====================

CREATE TABLE mc_import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'VALIDATING', 'IMPORTING', 'COMPLETED', 'FAILED')),
  total_rows INTEGER DEFAULT 0,
  valid_rows INTEGER DEFAULT 0,
  error_rows INTEGER DEFAULT 0,
  imported_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  error_log JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ DEFAULT now()
);

-- ==================== USER ROLES EXTENSION ====================

-- Extend app_role enum for multi-channel roles
-- We need to alter the existing enum type
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'inventory_manager';
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'purchase_manager';
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'billing_staff';
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'accounts_staff';
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'marketplace_manager';
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'viewer';

-- ==================== INDEXES ====================

CREATE INDEX idx_mc_master_products_sku ON mc_master_products(sku);
CREATE INDEX idx_mc_master_products_barcode ON mc_master_products(barcode);
CREATE INDEX idx_mc_master_products_status ON mc_master_products(status);
CREATE INDEX idx_mc_master_products_category ON mc_master_products(category_id);
CREATE INDEX idx_mc_master_products_linked ON mc_master_products(linked_product_id);

CREATE INDEX idx_mc_inventory_product ON mc_inventory(master_product_id);
CREATE INDEX idx_mc_inventory_variant ON mc_inventory(variant_id);

CREATE INDEX idx_mc_movements_product ON mc_inventory_movements(master_product_id);
CREATE INDEX idx_mc_movements_type ON mc_inventory_movements(movement_type);
CREATE INDEX idx_mc_movements_channel ON mc_inventory_movements(channel);
CREATE INDEX idx_mc_movements_created ON mc_inventory_movements(created_at);

CREATE INDEX idx_mc_channel_prices_product ON mc_channel_prices(master_product_id);
CREATE INDEX idx_mc_channel_prices_channel ON mc_channel_prices(channel);

CREATE INDEX idx_mc_mp_orders_channel ON mc_marketplace_orders(channel_id);
CREATE INDEX idx_mc_mp_orders_status ON mc_marketplace_orders(status);
CREATE INDEX idx_mc_mp_orders_created ON mc_marketplace_orders(created_at);
CREATE INDEX idx_mc_mp_orders_marketplace_id ON mc_marketplace_orders(marketplace_order_id);

CREATE INDEX idx_mc_mp_order_items_order ON mc_marketplace_order_items(order_id);

CREATE INDEX idx_mc_sales_channel ON mc_sales_transactions(channel);
CREATE INDEX idx_mc_sales_created ON mc_sales_transactions(created_at);

CREATE INDEX idx_mc_sync_jobs_channel ON mc_sync_jobs(channel_id);
CREATE INDEX idx_mc_sync_jobs_status ON mc_sync_jobs(status);

CREATE INDEX idx_mc_notifications_read ON mc_notifications(is_read);
CREATE INDEX idx_mc_notifications_kind ON mc_notifications(kind);
CREATE INDEX idx_mc_notifications_created ON mc_notifications(created_at);

CREATE INDEX idx_mc_cost_product ON mc_cost_components(master_product_id);
CREATE INDEX idx_mc_product_costs_product ON mc_product_costs(master_product_id);

CREATE INDEX idx_mc_reservations_product ON mc_inventory_reservations(master_product_id);
CREATE INDEX idx_mc_reservations_channel ON mc_inventory_reservations(channel);
CREATE INDEX idx_mc_reservations_status ON mc_inventory_reservations(status);

CREATE INDEX idx_mc_import_jobs_status ON mc_import_jobs(status);

-- ==================== ROW LEVEL SECURITY ====================

ALTER TABLE mc_master_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE mc_product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE mc_channel_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE mc_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE mc_inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE mc_inventory_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE mc_marketplace_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE mc_marketplace_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE mc_marketplace_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE mc_marketplace_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE mc_marketplace_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE mc_sales_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mc_cost_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE mc_product_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE mc_sync_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE mc_sync_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE mc_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE mc_import_jobs ENABLE ROW LEVEL SECURITY;

-- Admin/Staff can do everything
CREATE POLICY "mc_admin_all" ON mc_master_products FOR ALL USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));
CREATE POLICY "mc_admin_all_variants" ON mc_product_variants FOR ALL USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));
CREATE POLICY "mc_admin_all_prices" ON mc_channel_prices FOR ALL USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));
CREATE POLICY "mc_admin_all_inv" ON mc_inventory FOR ALL USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));
CREATE POLICY "mc_admin_all_movements" ON mc_inventory_movements FOR ALL USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));
CREATE POLICY "mc_admin_all_reservations" ON mc_inventory_reservations FOR ALL USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));
CREATE POLICY "mc_admin_all_channels" ON mc_marketplace_channels FOR ALL USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));
CREATE POLICY "mc_admin_all_connections" ON mc_marketplace_connections FOR ALL USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));
CREATE POLICY "mc_admin_all_mp_products" ON mc_marketplace_products FOR ALL USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));
CREATE POLICY "mc_admin_all_mp_orders" ON mc_marketplace_orders FOR ALL USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));
CREATE POLICY "mc_admin_all_mp_items" ON mc_marketplace_order_items FOR ALL USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));
CREATE POLICY "mc_admin_all_sales" ON mc_sales_transactions FOR ALL USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));
CREATE POLICY "mc_admin_all_costs" ON mc_cost_components FOR ALL USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));
CREATE POLICY "mc_admin_all_pc" ON mc_product_costs FOR ALL USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));
CREATE POLICY "mc_admin_all_sync" ON mc_sync_jobs FOR ALL USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));
CREATE POLICY "mc_admin_all_synclog" ON mc_sync_logs FOR ALL USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));
CREATE POLICY "mc_admin_all_notif" ON mc_notifications FOR ALL USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));
CREATE POLICY "mc_admin_all_import" ON mc_import_jobs FOR ALL USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

-- Customers can read their own orders on website channel
CREATE POLICY "mc_website_orders_read" ON mc_marketplace_orders
  FOR SELECT USING (channel_id = (SELECT id FROM mc_marketplace_channels WHERE channel = 'WEBSITE'));

-- Anyone authenticated can read marketplace channels (for reference)
CREATE POLICY "mc_read_channels" ON mc_marketplace_channels FOR SELECT USING (auth.role() = 'authenticated');

-- ==================== FUNCTIONS ====================

-- Function to update available stock based on movements
CREATE OR REPLACE FUNCTION mc_update_inventory_stock()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE mc_inventory
  SET
    physical_stock = physical_stock + CASE
      WHEN NEW.movement_type IN ('PURCHASE', 'RETURN', 'ADJUSTMENT', 'CORRECTION') THEN NEW.quantity
      WHEN NEW.movement_type IN ('SALE', 'DAMAGED') THEN -NEW.quantity
      ELSE 0
    END,
    sold_stock = sold_stock + CASE WHEN NEW.movement_type = 'SALE' THEN NEW.quantity ELSE 0 END,
    damaged_stock = damaged_stock + CASE WHEN NEW.movement_type = 'DAMAGED' THEN NEW.quantity ELSE 0 END,
    available_stock = GREATEST(0, physical_stock - reserved_stock),
    last_updated = now()
  WHERE master_product_id = NEW.master_product_id
    AND (variant_id = NEW.variant_id OR (variant_id IS NULL AND NEW.variant_id IS NULL));

  -- Update master product stock totals
  UPDATE mc_master_products
  SET
    current_stock = (SELECT COALESCE(SUM(physical_stock), 0) FROM mc_inventory WHERE master_product_id = NEW.master_product_id),
    available_stock = (SELECT COALESCE(SUM(available_stock), 0) FROM mc_inventory WHERE master_product_id = NEW.master_product_id),
    reserved_stock = (SELECT COALESCE(SUM(reserved_stock), 0) FROM mc_inventory WHERE master_product_id = NEW.master_product_id),
    damaged_stock = (SELECT COALESCE(SUM(damaged_stock), 0) FROM mc_inventory WHERE master_product_id = NEW.master_product_id),
    updated_at = now()
  WHERE id = NEW.master_product_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_mc_inventory_movement
  AFTER INSERT ON mc_inventory_movements
  FOR EACH ROW
  EXECUTE FUNCTION mc_update_inventory_stock();

-- Function to auto-create inventory record for new products
CREATE OR REPLACE FUNCTION mc_create_inventory_on_product()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO mc_inventory (master_product_id, physical_stock, available_stock, reorder_level)
  VALUES (NEW.id, NEW.current_stock, NEW.available_stock, NEW.minimum_stock);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_mc_auto_inventory
  AFTER INSERT ON mc_master_products
  FOR EACH ROW
  EXECUTE FUNCTION mc_create_inventory_on_product();

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION mc_update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_mc_products_timestamp BEFORE UPDATE ON mc_master_products FOR EACH ROW EXECUTE FUNCTION mc_update_timestamp();
CREATE TRIGGER trg_mc_channels_timestamp BEFORE UPDATE ON mc_marketplace_channels FOR EACH ROW EXECUTE FUNCTION mc_update_timestamp();
CREATE TRIGGER trg_mc_connections_timestamp BEFORE UPDATE ON mc_marketplace_connections FOR EACH ROW EXECUTE FUNCTION mc_update_timestamp();
CREATE TRIGGER trg_mc_orders_timestamp BEFORE UPDATE ON mc_marketplace_orders FOR EACH ROW EXECUTE FUNCTION mc_update_timestamp();
