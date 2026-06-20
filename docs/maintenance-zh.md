# 开发者维护说明

## 项目结构

```
app/                    Next.js App Router
  admin/                后台管理 (/admin, /admin/settings)
  api/admin/            后台 API
  [category]/           分类商品列表页
  product/[sku]/        商品详情页
  feed.xml/             Skroutz feed
  contact/              联系我们
  sitemap.xml/          站点地图
  robots.txt/           robots.txt
components/             共享 UI 组件
lib/                    工具库
  types.ts              类型定义
  i18n.ts               多语言 + localizeHours
  products.ts           商品查询
  product-stock.ts      尺码库存统一逻辑（hasSizeStock/getTotalStock/getSizeOptions）
  settings.ts           店铺设置加载（getBusinessSettings, 30s 缓存）
  feed.ts               Feed 生成器（getFeedProducts, buildSkroutzFeed）
  admin-products.ts     管理员验证 + validateProductPayload
  categories-data.ts    分类数据加载（DB 优先，硬编码 fallback）
supabase/
  client-init.sql        新客户一键初始化
  demo-products.sql      演示商品（可选）
  patches/              老客户升级补丁
```

## 数据库表

| 表 | 说明 | 关键字段 |
|----|------|---------|
| `products` | 商品 | sku(PK), size_stock(jsonb), image_urls(jsonb), is_active |
| `business_settings` | 店铺设置 | 单行，business_name, logo_url, hero_image_url, enable_skroutz |
| `product_categories` | 一级分类 | slug(PK), name_cn/en/gr, sort_order |
| `product_subcategories` | 二级分类 | category_id(FK), slug, name_cn/en/gr, unique(category_id,slug) |

## Storage Bucket

| Bucket | 用途 | 权限 |
|--------|------|------|
| `product-images` | 商品主图和多图 | public read |
| `store-assets` | Logo、首页大图 | public read |

## 环境变量

```env
NEXT_PUBLIC_SITE_URL=         # 网站域名
NEXT_PUBLIC_SUPABASE_URL=     # Supabase 项目 URL
NEXT_PUBLIC_SUPABASE_ANON_KEY= # Supabase 匿名 key
ADMIN_PASSWORD=               # 后台密码
SUPABASE_SERVICE_ROLE_KEY=    # Supabase 服务角色 key（后台写操作）
DEEPSEEK_API_KEY=             # DeepSeek 翻译 API key
```

## 常见排查

### 图片上传失败
1. 确认 Supabase Storage bucket `product-images` 存在且 public=true
2. 检查 Vercel 日志：`SUPABASE_SERVICE_ROLE_KEY` 是否配置
3. 图片是否过大（sharp 压缩超时）

### 尺码库存不生效
1. 确认 `products.size_stock` 字段存在（jsonb, default '{}')
2. 确认前台使用 `getSizeOptions()` 而非直接读 `sizes`
3. 确认后台保存时 `submitProduct` 包含了 `size_stock`

### 分类不显示
1. 确认 `product_categories` 表有数据且 `is_active=true`
2. 确认 RLS policy 允许 public select
3. 前台需使用 `loadCategories()` 加载

### feed.xml 不显示商品
1. 确认 `business_settings.enable_skroutz=true`
2. 确认商品 `is_active=true` 且 `stock>=0`
3. 检查 `/feed.xml` 是否返回 404（Skroutz 被关闭）

### Vercel 部署失败
1. `npm run build` 本地先通过
2. 检查环境变量是否全部配置
3. 检查 Vercel 日志 Runtime Logs

### Supabase 数据备份
免费版不支持自动备份。建议定期使用后台「导出 CSV」备份商品数据。店铺设置需手动记录。

## 后续维护规则

### 老客户升级 → patches
已有真实数据的客户，不能直接执行完整 `client-init.sql`。应新建 `supabase/patches/` 下的 SQL 补丁：

```sql
-- supabase/patches/2026-06-21-add-field.sql
alter table products add column if not exists new_field text;
```

### 新客户初始化 → client-init.sql
新客户直接执行 `supabase/client-init.sql`。

### 每次数据库改动必须同时做
1. 新增 `supabase/patches/YYYY-MM-DD-描述.sql`
2. 同步更新 `supabase/client-init.sql`（CREATE TABLE + seed）
3. 涉及演示数据 → 更新 `supabase/demo-products.sql`
4. 更新相关文档（本文档和 client-guide-zh.md）
5. 运行 `npm run build`
6. 提交时说明上述变更
