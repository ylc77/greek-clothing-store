# Fashion Boutique 商品展示网站

可复用的服装店商品展示网站模板，适合女装、男装、鞋子、包包、行李箱、帽子、首饰和配饰类商店。

## 功能

- 前台多语言：希腊语 / 英语
- 后台中文商品管理
- 商品展示：首页、分类页、商品详情页
- 一级分类和二级分类管理
- 商品多图、主图上传、WebP 压缩
- 尺码和尺码库存
- CSV 批量导入 / 导出
- DeepSeek API 自动翻译：中文到英文、希腊语
- AI 导购助手
- Skroutz XML Feed：`/feed.xml`
- 店铺设置：店名、Logo、横幅图、联系方式、社交链接等

## 技术栈

Next.js 15 + React 19 + TypeScript + Tailwind CSS + Supabase + Sharp + Vercel + DeepSeek API

## 快速开始

```bash
npm install
cp .env.example .env.local
npm run dev
```

本地访问：

```txt
http://localhost:3000
http://localhost:3000/admin
http://localhost:3000/feed.xml
```

## 新客户部署

1. 在 Supabase SQL Editor 执行 `supabase/client-init.sql`。
2. 可选：执行 `supabase/demo-products.sql` 填充演示商品。
3. 在 `.env.local` 和 Vercel 环境变量中填写 Supabase、后台密码、DeepSeek 等配置。
4. 运行 `npm run build` 确认项目可构建。
5. 部署到 Vercel。
6. 访问 `/admin` 配置店铺信息和商品。

## 老客户数据库升级

已有真实数据的客户不要直接重新执行 `supabase/client-init.sql`。

老客户升级时，只执行 `supabase/patches/` 目录下尚未执行过的补丁文件。每个 patch 都应使用 `alter table ... add column if not exists`、`create index if not exists` 等安全写法。

当前 SQL 文件用途：

- `supabase/client-init.sql`：新客户完整初始化。
- `supabase/demo-products.sql`：可选演示商品。
- `supabase/patches/*.sql`：老客户增量升级。

## 环境变量

```env
NEXT_PUBLIC_SITE_URL=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
ADMIN_PASSWORD=
SUPABASE_SERVICE_ROLE_KEY=
USE_POS_RPC=false
DEEPSEEK_API_KEY=
DEEPSEEK_TRANSLATION_MODEL=deepseek-chat
```

说明：

- `NEXT_PUBLIC_SUPABASE_ANON_KEY` 用于前台读取公开商品和店铺数据。
- `SUPABASE_SERVICE_ROLE_KEY` 只用于服务端后台 API，不能暴露到浏览器。
- `USE_POS_RPC` 控制 POS checkout / void 是否走数据库事务 RPC；默认保持 `false`，验证完成后再逐步开启。
- `DEEPSEEK_API_KEY` 用于后台自动翻译和 AI 导购助手。

## 常用命令

```bash
npm run dev
npm run typecheck
npm run build
```

当前项目没有 `lint` script。

## 文档

- [部署说明](docs/deploy-client-zh.md)
- [后台使用说明](docs/client-guide-zh.md)
- [维护说明](docs/maintenance-zh.md)
- [上线前检查清单](docs/launch-checklist-zh.md)

## 维护规则

- 新客户：执行 `supabase/client-init.sql`。
- 老客户：只执行 `supabase/patches/` 下的增量 patch。
- 每次新增数据库字段时，同时更新：
  - `supabase/client-init.sql`
  - `supabase/patches/`
  - `.env.example` 或文档（如果涉及环境变量）
