# v1 新客户部署手册

本流程适用于全新的客户 Supabase。不要把 `client-init.sql` 用在已有客户数据库。

## 1. 先确认目录

所有命令必须在该客户项目根目录执行，并确认目录包含 `supabase/migrations`。

```powershell
pwd
git status
Get-ChildItem supabase/migrations
```

应看到 baseline 以及 ERP/POS/admin/feature/legal/product/CSV/Storage/AI/operations migrations。若目录、分支或 Git 状态异常，停止。

## 2. 建立独立客户资源

- 每个客户使用独立 Supabase 项目、Vercel 项目/环境和域名。
- 不复制其他客户的 service key、开发者密码、应急密码、AI key 或备份。
- 记录客户代号、Supabase project ref、region、Vercel project ID 和代码 commit；不要记录秘密值。

## 3. 初始化空 Supabase

最简单的新客户流程是在 Supabase SQL Editor 一次执行：

```text
supabase/client-init.sql
```

执行前确认数据库为空。执行后核对：

- 21 个 migration 版本与当前仓库一致；
- `products.id` 为 `bigint`；
- `product_variants.product_id` 为 `bigint`；
- `MAIN_STORE` 存在且 active；
- `feature_settings.plan = advanced`；
- `developer_access` 为空；
- `product-images` bucket 存在，公开只读，anon/authenticated 无写删权限；
- POS、库存、商品、CSV 和 operations runtime health 均为 `ready=true`。

Migration CLI 仍是开发与已有客户升级的 source of truth。`client-init.sql` 只是由 migration 链生成的新客户快照。

## 4. 在维护者电脑初始化开发者凭据

只在维护者本机的 Git 忽略配置中提供该客户的 Supabase URL 和 service/secret key。不要在客户电脑执行，不要把明文写进命令参数。

```powershell
npm run developer:status -- --project-ref 客户项目ref
npm run developer:bootstrap -- --project-ref 客户项目ref
```

CLI 会确认目标 project ref，并只显示一次随机密码。立即保存到密码管理器；不要给普通商家 owner。重复 bootstrap 必须拒绝。

## 5. 配置 Vercel

必需变量：

```text
NEXT_PUBLIC_SITE_URL
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
AUTH_RATE_LIMIT_SECRET
USE_POS_RPC=true
USE_PRODUCT_RPC=true
USE_CSV_IMPORT_RPC=true
```

规则：

- URL 和 publishable/anon key 可以公开，但公开表必须受正确 RLS、grant 和公开 DTO 限制。
- service/secret key 绕过 RLS，只能放 Vercel 服务端，绝不能使用 `NEXT_PUBLIC_` 前缀。
- `AUTH_RATE_LIMIT_SECRET` 是每客户独立、服务端随机值，至少 32 字符。
- 应急 `ADMIN_PASSWORD` 可不配置；如配置，必须至少 20 字符，包含字母、数字和符号，并且每客户/角色唯一。
- AI key 是可选的客户级低额度 key。没有 key 时 AI 功能应关闭或 fail closed。
- 环境变量更新后必须创建新 deployment，旧 deployment 不会自动更新。

## 6. 配置店铺和法律资料

1. 使用开发者密码进入 Store Settings。
2. 填写客户店名、Logo/Hero、联系资料、地址、营业时间和 Feed 设置。
3. 进入 Legal Settings，填写希腊语和英语的商家、隐私、付款、配送、退货、退款和 14 天撤回权内容。
4. 完成全部确认后发布法律版本，记录版本号。
5. 依据合同选择 Basic、Standard 或 Advanced；关闭功能时同时检查前台、后台菜单、直接 API 和员工认证。

## 7. 最小验收

- owner、staff、inventory、readonly 登录和权限矩阵正确；owner 不能进入 developer-only 设置。
- 创建一个多尺码商品和一个 ONE SIZE 商品；图片公开可读，匿名不能上传或删除。
- 库存到货、调整、盘点、退货和 Quick Sell 事务正确。
- Standard/Advanced：POS checkout/void、日报、CSV、条码、标签和员工账号正确。
- Advanced：Feed 通过严格检查与 Skroutz Validator；AI 使用测试 key 验证限流、预算和隐私。
- 390、768、1440 像素无阻断错误、横向溢出或权限循环。
- 所有测试数据、Cookie、账号和图片清理为 0。

## 8. 交付

- 客户得到商家后台账号和使用手册，不得到 developer 密码、service key、数据库密码或基础设施 owner 权限。
- 维护者保存 project ref、代码 tag、部署日期、备份位置、密钥轮换日期和版本验收结果。
- Standard/Advanced 未完成真实硬件验收时必须标记 `CONDITIONAL`。
