
# Admin Panel & Billing Software — Athira's Creative Haven

The customer app stays exactly as it is (peach + sage Play Store shopping app). We add a **separate admin surface** at `/admin/*` with its own layout, its own login entry point, and role-gated access — reading and writing the **same** Supabase tables so stock stays perfectly in sync.

## Access & security

- New route `/admin/login` — user id (email) + password form. Uses existing Supabase auth.
- After sign-in we check `user_roles` for `admin` or `staff`. Non-privileged users are redirected out with a toast.
- All admin pages live under `src/routes/_admin/*` behind a role gate (client-side auth + server-side RLS already enforces it).
- I'll promote your current logged-in account to `admin` so you can access it immediately.
- "Admin Login" entry point added to the customer Profile page (subtle link, doesn't clutter the shopping UI).

## Shared inventory (the critical part)

One `products.stock` column, one source of truth. Both flows use the existing atomic `place_order` RPC (or a new `create_pos_sale` RPC for offline) that:
1. Locks the product row (`FOR UPDATE`)
2. Validates stock ≥ qty
3. Deducts stock
4. Flips `is_available=false` when stock hits 0

Customer app already does this. POS billing will call the same pattern. No separate online/offline stock — ever.

## Schema additions (one migration)

New tables/columns needed:
- `brands` (name, slug, logo)
- `suppliers` (name, phone, email, address, gstin)
- `purchases` + `purchase_items` (supplier, invoice_no, date, totals; items adjust `products.stock` via trigger)
- `products` new cols: `sku`, `hsn_code`, `gst_rate`, `purchase_price`, `brand_id`, `reorder_level`
- `activity_logs` (user_id, action, entity, meta) for admin activity
- `notifications` (admin-scoped low-stock / new-order alerts)

All with GRANT + RLS scoped via `has_role(auth.uid(), 'admin' | 'staff')`.

## Admin modules (phased build)

**Phase A — Foundation & Dashboard**
- `_admin` layout with sidebar (Dashboard, POS, Products, Purchases, Categories, Brands, Suppliers, Customers, Orders, Inventory, Reports, Users, Settings), top bar, notifications bell.
- Dashboard KPIs: today's sales, orders count (online vs offline), revenue, total products, low/out-of-stock, pending/completed orders, top & least selling products.
- Sales charts: daily (last 30d), monthly (last 12mo), yearly — using recharts.

**Phase B — POS Billing**
- Full-screen POS: barcode input (auto-focus), product search, cart with qty/discount/GST, customer selector, coupon field.
- Payment: Cash / UPI / Card / Split.
- Generates invoice → printable thermal + A4 PDF view.
- Calls `create_pos_sale` RPC → deducts stock atomically, writes `orders` row with `channel='IN_STORE'`.

**Phase C — Catalog & Inventory**
- Products CRUD (images, variants list, SKU, barcode, HSN, GST, prices, discount, stock, reorder level, status).
- Auto barcode/QR generation (JsBarcode + qrcode.react).
- Categories, Brands, Suppliers CRUD.
- Purchase Entry form → increments stock via trigger.
- Inventory page: filters (low stock / out of stock / fast movers), bulk edit, stock adjust.

**Phase D — Orders, Customers, Reports**
- Orders: tabs Online / Offline, filter by status, update status pipeline, cancel/return actions.
- Customers: list from `profiles`, order history, lifetime spend, loyalty points column.
- Reports: daily / monthly / yearly (sales, purchase, profit, GST summary, top/least products). Export CSV.
- Users & Staff: list `user_roles`, promote/demote (admin only).

**Phase E — Notifications & Settings**
- Realtime bell: subscribes to new online orders + low-stock triggers.
- Settings: store info, GST number, invoice footer, thermal printer width.
- Activity log viewer.

## Design language for admin

Deliberately different from the customer app: **clean SaaS look** (Zoho/Shopify-style) — white cards, compact tables, sage accents for primary actions, peach kept minimal. Still uses the same CSS tokens so branding stays coherent, but density is higher and layout is desktop-first with responsive collapse.

## What ships in this turn

Given the scope (~14 modules), I'll ship **Phase A + Phase B** now: role gate, admin login entry, admin layout with sidebar, Dashboard with real KPIs and charts, and a working POS Billing screen that deducts shared stock. Then you say "continue" and I ship Phases C → E.

Sound good? If yes I'll start with the schema migration (brands, suppliers, purchases, new product columns) + promote your account to admin, then build the layout + Dashboard + POS.
