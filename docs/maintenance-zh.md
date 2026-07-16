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
  migrations/           数据库开发和老客户升级的权威来源
  patches/              仅在具体升级说明明确要求时使用的专用补丁
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
USE_POS_RPC=true              # POS 事务 RPC；缺失时写入 fail closed
USE_PRODUCT_RPC=true          # 商品事务 RPC；CSV 也依赖它
USE_CSV_IMPORT_RPC=true       # CSV Job / 逐行事务 RPC；缺失时返回 503
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
后台「导出 CSV」只导出商品资料，不能替代 PostgreSQL 灾难恢复备份，也不包含全部订单、设置、账号和 Storage 对象。正式上线前应另行制定 Supabase 数据库与 Storage 的备份、恢复和演练方案。

### 线上自动监控
项目已包含 GitHub Actions 定时检查：`.github/workflows/site-monitor.yml`。

- 默认每天检查一次线上网站和 `/feed.xml`。
- 检查内容包括：首页、分类页、商品详情、联系页、后台入口、`/feed.xml`、`/sitemap.xml`、`/robots.txt`。
- `/feed.xml` 会额外抽查测试商品、库存、价格格式、商品链接、公网图片；图片尺寸默认记为警告。
- 失败时会上传 `automation-reports/`，里面包含 JSON 报告和失败截图。
- 如需改线上域名，在 GitHub 仓库 Settings → Secrets and variables → Actions → Variables 中新增或修改 `BASE_URL`。
- 正式提交 Skroutz 前建议运行严格检查，图片尺寸不足会直接失败。

本地也可以手动运行：

```bash
BASE_URL=https://你的域名.vercel.app npm run check:site
BASE_URL=https://你的域名.vercel.app npm run check:skroutz
```

## 后续维护规则

### 老客户升级 → migrations
已有真实数据的客户不能执行完整 `client-init.sql`。正常升级使用尚未应用的 `supabase/migrations`；只有具体升级说明明确要求时才使用 `supabase/patches/` 专用补丁。

事务 migrations 依次包含 P1 POS/库存/开发者凭据、`20260715143949_transactional_product_operations.sql` 商品事务，以及 `20260716100000_transactional_csv_import_jobs.sql` CSV Job 与逐行事务。老客户必须先备份并确认目标 project ref，再使用 `db push --dry-run` 核对计划后执行 `db push`；不要执行 `client-init.sql`，也不要手工伪造 migration history。部署代码前在 Vercel 同时设置 `USE_PRODUCT_RPC=true` 和 `USE_CSV_IMPORT_RPC=true`，否则 CSV 写入会以 503 fail closed。

### CSV 导入中断恢复

- 先完成整份文件预检和可选翻译预览，再创建持久 Job。
- 浏览器刷新、网络超时或响应丢失时，不要重新上传并生成另一业务 ID；重新进入 CSV 页面恢复原 Job。
- `partial` 或 `failed` Job 应下载失败行并使用“重试失败行”；已成功行不会重复执行。
- 不要手工修改 `product_import_jobs`、`product_import_rows` 或库存表来伪造成功状态。
- 后台商品 CSV 导出只是商品资料导出，不是完整数据库备份。

### 新客户初始化 → client-init.sql
新客户执行 `supabase/client-init.sql` 后，developer credential 保持未初始化。维护者在自己的电脑运行：

```powershell
npm run developer:status -- --project-ref 客户项目ref
npm run developer:bootstrap -- --project-ref 客户项目ref
```

密码只显示一次并保存到密码管理器，不写入 PostgreSQL、Vercel、Git 或浏览器存储。已有客户应用凭据 hardening migration 后必须运行 `npm run developer:rotate -- --project-ref 客户项目ref`；旧密码和旧 Cookie 在轮换前均不能使用。

### 每次数据库改动必须同时做
1. 使用 Supabase CLI 新增单调递增的 `supabase/migrations/<timestamp>_描述.sql`；不要把新 migration 插到已发布版本之前
2. 运行 `scripts/build-client-init.ps1` 重新生成 `supabase/client-init.sql`；不得手工添加共享凭据 seed
3. 涉及演示数据 → 更新 `supabase/demo-products.sql`
4. 更新相关文档（本文档和 client-guide-zh.md）
5. 运行 `npm run build`
6. 提交时说明上述变更
