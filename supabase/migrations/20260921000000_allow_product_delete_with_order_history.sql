-- Allow inventory products to be deleted without deleting order history.
-- Historic order_items keep their product_name snapshot; the product_id link
-- is cleared so the product row itself can be removed. Mirrors the earlier
-- purchase_items fix (20260918000000).
ALTER TABLE public.order_items
  ALTER COLUMN product_id DROP NOT NULL;

ALTER TABLE public.order_items
  DROP CONSTRAINT IF EXISTS order_items_product_id_fkey;

ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_product_id_fkey
  FOREIGN KEY (product_id)
  REFERENCES public.products(id)
  ON DELETE SET NULL;