-- ============================================================
-- 演示商品数据（可选执行）
-- 在 client-init.sql 之后执行，填充 8 个演示商品
-- 不会覆盖已有商品
-- ============================================================

insert into products (sku, name_cn, name_en, name_gr, description_en, description_gr, category, subcategory, price, stock, sizes, size_stock, brand, is_active)
values
  ('women-dresses-001', '夏季碎花连衣裙', 'Summer Floral Dress', 'Καλοκαιρινό Φλοράλ Φόρεμα',
   'Light and breezy floral dress, perfect for summer days.', 'Ελαφρύ και δροσερό φλοράλ φόρεμα, ιδανικό για καλοκαιρινές μέρες.',
   'women', 'dresses', 39.90, 5, 'XS,S,M,L,XL',
   '{"XS":1,"S":2,"M":1,"L":1,"XL":0}', 'Fashion Boutique', true),
  ('women-tops-001', '白色真丝上衣', 'White Silk Blouse', 'Λευκή Μεταξωτή Μπλούζα',
   'Elegant white silk blouse for office and evening wear.', 'Κομψή λευκή μεταξωτή μπλούζα για γραφείο και βραδινές εμφανίσεις.',
   'women', 'tops', 45.00, 3, 'S,M,L',
   '{"S":1,"M":1,"L":1}', 'Fashion Boutique', true),
  ('men-tshirts-001', '纯棉圆领T恤', 'Cotton Crew Neck T-Shirt', 'Βαμβακερό T-shirt',
   'Classic crew neck t-shirt in 100% organic cotton.', 'Κλασικό t-shirt από 100% οργανικό βαμβάκι.',
   'men', 'tshirts', 19.90, 10, 'S,M,L,XL,XXL',
   '{"S":2,"M":4,"L":3,"XL":1,"XXL":0}', 'Fashion Boutique', true),
  ('men-shirts-001', '修身商务衬衫', 'Slim Fit Business Shirt', 'Εφαρμοστό Επαγγελματικό Πουκάμισο',
   'Slim fit business shirt with spread collar.', 'Εφαρμοστό επαγγελματικό πουκάμισο.',
   'men', 'shirts', 34.90, 4, 'S,M,L,XL',
   '{"S":1,"M":1,"L":1,"XL":1}', 'Fashion Boutique', true),
  ('shoes-sneakers-001', '复古跑鞋', 'Retro Running Sneakers', 'Retro Αθλητικά Παπούτσια',
   'Vintage-inspired running sneakers with cushioned sole.', 'Αθλητικά παπούτσια με ρετρό σχεδιασμό.',
   'shoes', 'sneakers', 59.90, 6, '38,39,40,41,42',
   '{"38":1,"39":2,"40":2,"41":1,"42":0}', 'Fashion Boutique', true),
  ('shoes-sandals-001', '希腊风凉鞋', 'Greek Style Sandals', 'Ελληνικά Σανδάλια',
   'Handmade leather sandals with traditional Greek design.', 'Χειροποίητα δερμάτινα σανδάλια με παραδοσιακό ελληνικό σχεδιασμό.',
   'shoes', 'sandals', 49.90, 4, '38,39,40,41',
   '{"38":1,"39":1,"40":1,"41":1}', 'Fashion Boutique', true),
  ('bags-handbags-001', '真皮手提包', 'Leather Handbag', 'Δερμάτινη Τσάντα Χειρός',
   'Genuine leather handbag with gold-toned hardware.', 'Γνήσια δερμάτινη τσάντα χειρός με χρυσές λεπτομέρειες.',
   'bags', 'handbags', 89.00, 2, 'One Size',
   '{"One Size":2}', 'Fashion Boutique', true),
  ('jewelry-necklaces-001', '珍珠项链', 'Pearl Necklace', 'Μαργαριταρένιο Κολιέ',
   'Classic freshwater pearl necklace with silver clasp.', 'Κλασικό κολιέ με μαργαριτάρια γλυκού νερού.',
   'jewelry', 'necklaces', 29.90, 3, 'One Size',
   '{"One Size":3}', 'Fashion Boutique', true)
on conflict (sku) do nothing;
