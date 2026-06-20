# Fashion Boutique — 服装店商品展示网站模板

## 项目概述

可复制给不同商家的服装店商品展示网站模板。不是完整支付电商。
技术栈：Next.js 15 + TypeScript + Supabase + Vercel。前台英/希，后台中文。

## 重要维护规则

**任何 DB 结构、Storage、RLS、默认数据改动，必须同时维护：**
1. `supabase/patches/` — 老客户升级
2. `supabase/client-init.sql` — 新客户一键初始化
3. `docs/` — 文档

不要只在 Supabase 线上手动改而不提交 SQL。

## 核心规则

- 商品来自 `products` 表，不写死代码
- 店铺设置来自 `business_settings`
- 分类来自 `product_categories` / `product_subcategories`（后台可管理）
- 尺码库存 `products.size_stock` (jsonb)
- DeepSeek API Key 只在服务端
- 图片用 Supabase Storage：`product-images`（商品）、`store-assets`（Logo/Hero）

## 新客户初始化

```sql
-- Supabase SQL Editor:
supabase/client-init.sql        -- 必须
supabase/demo-products.sql      -- 可选
```

## 维护流程

1. 新增 `supabase/patches/YYYY-MM-DD-描述.sql`
2. 更新 `supabase/client-init.sql`
3. 涉及默认数据 → 更新 seed 部分
4. 涉及演示 → 更新 `supabase/demo-products.sql`
5. 更新 `docs/`
6. `npm run build`
7. 提交说明包含：patch、client-init、文档、build 状态
