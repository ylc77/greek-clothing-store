# Fashion Boutique — 服装店商品展示网站

可复制给不同商家的服装店商品展示网站模板。适合雅典本地 boutique、女装店、男装店、鞋店、包包店、配饰店使用。

## 功能

- 多语言前台（英语 / 希腊语），后台固定中文
- 商品展示：首页、分类页、商品详情页
- 尺码库存：每尺码独立库存，售罄自动置灰
- 图片上传：Supabase Storage，自动 WebP 压缩
- 分类管理：一级/二级分类后台可编辑
- CSV 批量导入导出商品
- 自动翻译：DeepSeek API 中→英/希
- Skroutz Feed：`/feed.xml` 对接希腊电商平台
- 店铺设置：店名、Logo、联系方式、营业时间等后台配置

## 技术栈

Next.js 15 + TypeScript + Supabase + Vercel + DeepSeek API

## 快速开始

```bash
npm install
cp .env.example .env.local   # 填写你的 Supabase 和 DeepSeek 密钥
npm run dev                   # http://localhost:3000
```

## 新客户部署

1. 在 Supabase SQL Editor 执行 `supabase/client-init.sql`
2. （可选）执行 `supabase/demo-products.sql` 填充演示商品
3. 部署到 Vercel，配置环境变量
4. 访问 `/admin` 配置店铺信息

详见 [docs/deploy-client-zh.md](docs/deploy-client-zh.md)

## 文档

| 文档 | 读者 |
|------|------|
| [部署说明](docs/deploy-client-zh.md) | 开发者 |
| [后台使用说明](docs/client-guide-zh.md) | 商家 |
| [维护说明](docs/maintenance-zh.md) | 开发者 |

## 环境变量

```env
NEXT_PUBLIC_SITE_URL=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
ADMIN_PASSWORD=
SUPABASE_SERVICE_ROLE_KEY=
DEEPSEEK_API_KEY=
```

## 维护规则

- 新客户：`supabase/client-init.sql` 一键初始化
- 老客户升级：`supabase/patches/` 下的 SQL 补丁
- 数据库改动必须同时更新 patch 和 client-init.sql
