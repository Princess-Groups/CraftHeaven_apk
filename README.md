# Craft Connect Hub

App Build Prompt — Craft Store Retail Management System

Copy everything below into your AI app builder (e.g. Claude Code, Cursor, Lovable, v0, Bolt) to generate the app.

Prompt

Build a Craft Store Retail Management System — a centralized platform that connects a customer mobile app, an in-store billing (POS) system, and an admin dashboard to one shared, real-time inventory database.

Visual Theme

Primary palette: Peach (#FFDAB9 / #FFCBA4 for accents, #FFF1E6 for backgrounds) and Pastel Green (#B8E0C4 / #A8D5BA for accents, #EAF6EE for backgrounds).

Supporting neutrals: warm white (#FFFDF9), soft charcoal text (#3E3A39), muted gray for secondary text (#8A837E).

Accent/alert colors: soft coral or terracotta for warnings (low stock, out of stock), sage green for success/confirmed states.

Style: soft rounded corners (12–20px radius), gentle drop shadows, generous white space, friendly rounded sans-serif typography (e.g. Poppins, Quicksand, or Nunito), card-based layouts. The overall feel should be warm, handcrafted, and approachable — fitting a craft store — not corporate or cold.

Use peach for primary buttons/highlights and pastel green for secondary actions, success states, and stock/positive indicators.

Core Idea — ONE UNIFIED APP, NOT THREE SEPARATE APPS

This is a single application with three roles/modes built into one codebase and one shared database — not three disconnected products:

Customer Mode — the shopping app (browse, cart, wishlist, buy)

Staff/Billing Mode — in-store POS billing screen

Admin Mode — management dashboard

All three modes read and write to the exact same orders table and inventory table. There is no separate "online order" system and "offline bill" system — there is one unified orders table where each order has a channel field (ONLINE or IN_STORE) and one unified inventory table that every channel deducts from instantly.

Merged flow example:

A customer orders 2 units online → orders table gets a new row (channel: ONLINE) → inventory table decreases by 2 → Admin Dashboard reflects it instantly.

A walk-in customer buys 3 units at the counter via Billing Mode → orders table gets a new row (channel: IN_STORE) → inventory table decreases by 3 → same dashboard, same stock number updates instantly.

Both flows call the same placeOrder() / createSale() backend function under the hood — just with a different channel and payment context — so stock, sales reports, and analytics are always unified across both channels. Never build two separate order pipelines.

Shopping Experience (Meesho / Amazon-style, for Customer Mode)

Build the customer-facing shopping flow with the same UX patterns as Meesho/Amazon/Flipkart:

Home/browse feed: category tiles, banners, "trending" and "new arrivals" product rails

Product detail page: image gallery, price (with optional strike-through discount price), size/variant selector if applicable, stock availability, description, ratings/reviews section

Wishlist ❤️: heart icon on every product card and detail page to save items for later; dedicated Wishlist tab to view/remove/move-to-cart

Add to Cart 🛒: add/update quantity from product cards or detail page; persistent cart icon with item count badge; cart page with quantity steppers, price breakdown (subtotal, delivery, discount, total), and swipe/remove item

Buy Now: a one-tap button on the product page that skips the cart and goes straight to checkout for that single item

Checkout flow: delivery address selection/add-new, delivery vs. pickup, payment method (online / Cash on Delivery), order summary, place order confirmation

Order Tracking: post-purchase tracking screen showing the status pipeline visually (New → Processing → Packed → Out for Delivery → Delivered), estimated delivery date, and a map/timeline style tracker like Amazon's; push notification on every status change

My Orders tab: order history list, tap into any order for full tracking + invoice + reorder button

Use peach and pastel green for badges, discount tags, wishlist heart (filled state), and "in stock"/"low stock" indicators, keeping the same warm handcrafted look defined in the Visual Theme section.

Module 1 — Customer Mobile App

Browse products by category, with search

Product detail pages with images, price, description; add to cart

Checkout with Home Delivery or Store Pickup

Payment options: online payment or Cash on Delivery

Live order status tracking (New → Processing → Packed → Out for Delivery → Delivered / Cancelled)

Order history and saved delivery addresses

Push notifications on every order status change

Module 2 — Billing Software (POS, for in-store staff)

Fast invoice creation at checkout counter

Barcode scanning to add products instantly

Print physical bills/receipts

Accept Cash, UPI, and Card payments

Handle returns; optional GST-compliant invoices

Daily billing summary/report view

Module 3 — Admin Dashboard (secure, role-based login)

Protected by username/password with role-based access control. Admins can manage:

Products (create, edit, delete) and categories

Inventory & stock additions, purchase entries

Orders (view/update status across the pipeline)

Customers

Billing records (monitor POS activity)

Deliveries

Users/staff accounts and permissions

Module 4 — Centralized Inventory Engine

Single source of truth for stock across app + POS + dashboard

Real-time stock deduction on both online orders and offline bills

Low Stock Alerts: trigger automatically at a configurable minimum threshold — notify admin, badge the product in the dashboard

Out-of-Stock Handling: automatically marks a product unavailable at zero stock, blocks new orders, and reflects this status in the app immediately

Module 5 — Reporting & Analytics

Daily reports: total sales, online vs. offline sales split, total orders, top-selling products, low-stock products

Monthly reports: revenue analysis, product-wise and category-wise sales, customer growth, best sellers, inventory & delivery performance

Present as a dashboard with charts (bar/line for sales trends, simple cards for daily KPIs) using the peach/pastel-green palette

Module 6 — Delivery Management

Customers manage saved delivery addresses in-app

Live delivery status tracking from dispatch to drop-off

Delivery history log

Delivery performance reports for admin

Automatic notifications at each delivery milestone

Order Status Pipeline

New Order → Processing → Packed → Out for Delivery → Delivered (with Cancelled as an alternate end-state). Every status change should push an automatic notification to the customer — no manual staff follow-up required.

Suggested Tech Stack

Frontend (mobile): Flutter or React Native

Admin Dashboard: responsive web app (React/Next.js)

Billing Software: desktop or web-based POS interface

Backend: Node.js or Laravel

Database: MySQL or PostgreSQL

Payments: Razorpay integration

Security: role-based access control, secure authentication, encrypted user data

Future Scalability (design with these in mind, don't need to build now)

Multi-branch management, multiple billing counters, employee login system, loyalty & membership programs, WhatsApp notifications, barcode-based inventory management, advanced business analytics.

Deliverable

Build this as one single app/codebase with mode-based navigation (Customer / Staff / Admin), backed by one shared database. Scaffold in this order:

Shared backend & schema first: unified products, inventory, and orders (with a channel field) tables/collections, plus one placeOrder()/createSale() function used by both the customer checkout and the POS billing screen

Customer Mode screens: home/browse feed, product detail, wishlist, cart, buy-now checkout, order tracking, my orders, profile

Staff/Billing Mode screen: barcode/search entry, cart, payment, print receipt — writes to the same orders/inventory tables with channel: IN_STORE

Admin Mode screens: login, product/category management, inventory, unified order list (filterable by channel), customers, reports/analytics dashboard

Apply the peach and pastel green theme consistently across all three modes so the whole app feels like one cohesive product, even though it serves different types of users.

Tip: If your app builder lets you upload reference images, you can pair this prompt with a simple palette swatch (peach #FFCBA4 + pastel green #A8D5BA) for more consistent color output.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://craft-heaven-apk.vercel.app

## Payments (UPI / GPay / PhonePe — no gateway needed)

Online orders are paid via **UPI deep links** that open the customer's own UPI app
(Google Pay / PhonePe / Paytm). There is **no payment gateway** — the customer pays
you directly to your UPI ID and confirms the payment with their UTR.

Before going live, set the merchant UPI ID in `src/routes/_authenticated/checkout.tsx`:

```ts
const MERCHANT_VPA = "athira.creativehaven@upi";   // ← replace with your real UPI ID
const MERCHANT_NAME = "Athira's Creative Haven";
```

Flow: place order (stored as `payment_status = PENDING`) → customer approves payment
in GPay/PhonePe/Paytm → returns and enters the 12-digit UTR → order flips to `PAID`.

POS (`/admin/pos`): CASH / UPI / CARD payments are recorded as paid at the counter.

## Coupons

- `BLOOM20` — 20% off (shown on the home page offer banner)
- `CRAFT10` — 10% off

Coupon codes live in the `COUPONS` map in `src/routes/_authenticated/checkout.tsx`.

## Mobile / installable web app

- `public/manifest.webmanifest` + `public/icons/` → installable on Android/iOS home screens.
- `public/sw.js` → simple offline cache (registered in production builds only).
- App theme color / apple meta tags are set in `src/routes/__root.tsx`.

## Deployment (Vercel)

1. Push to GitHub → import the repo at https://vercel.com/new.
2. Set these environment variables in Vercel (Settings → Environment Variables):
   `SUPABASE_PROJECT_ID`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and the `VITE_`-prefixed versions.
3. The `vite.config.ts` uses the `vercel` nitro preset, and `vercel.json` sets the build command.
4. Before orders work, run `supabase/migrations/20260802120000_functions_only.sql`
   in the Supabase SQL Editor (creates `place_order`, `confirm_upi_payment`, etc.).

The native Android app (`capacitor.config.ts` → `server.url`) loads this deployed site.

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/9d0a67a1-f255-4865-b24a-fc96860c986b).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
