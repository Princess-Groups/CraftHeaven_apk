
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
