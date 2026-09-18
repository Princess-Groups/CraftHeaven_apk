-- Allow inventory products to be deleted without deleting purchase history.
-- Historic purchase_items remain available with their product_id cleared.
ALTER TABLE public.purchase_items
  ALTER COLUMN product_id DROP NOT NULL;

ALTER TABLE public.purchase_items
  DROP CONSTRAINT IF EXISTS purchase_items_product_id_fkey;

ALTER TABLE public.purchase_items
  ADD CONSTRAINT purchase_items_product_id_fkey
  FOREIGN KEY (product_id)
  REFERENCES public.products(id)
  ON DELETE SET NULL;