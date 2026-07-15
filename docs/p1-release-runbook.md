# P1 发布、升级与回滚手册

本手册只覆盖 P1 事务与安全修复。它不授权连接任意客户项目；每次远程操作前必须由维护者明确确认目标 project ref、备份和变更窗口。

## 1. 合并前门禁

在项目根目录执行：

```powershell
npm ci
git diff --check origin/master...HEAD
npm run check:p1-static
npm run typecheck
npm run build
npm run test:p1-unit
npx supabase db reset --local --no-seed
npm run test:p1-integration
npm run check:p1-db-security
npx supabase db advisors --local
npm run check:p1-cleanup
npm run test:p1-install-paths
npm run test:developer-secrets
```

任何命令失败都应阻止合并。GitHub 上还必须等待 `.github/workflows/p1-remediation-gate.yml` 的四个 job 全部通过。

## 2. 新客户空库

1. 确认数据库全新且为空。
2. 在 Supabase SQL Editor 一次性执行 `supabase/client-init.sql`。
3. 此时 `developer_access` 必须为空，Store/Legal/Feature 写入必须 fail closed。
4. 维护者在自己的电脑配置该客户的 Supabase URL 与 service/secret key，确认 project ref 后执行：

```powershell
npm run developer:status -- --project-ref 客户项目ref
npm run developer:bootstrap -- --project-ref 客户项目ref
```

5. 将仅显示一次的密码保存到维护者密码管理器；不交付给普通商家账号。
6. 配置 Vercel 服务端变量，确认 secret/service_role 没有 `NEXT_PUBLIC_` 前缀。
7. POS 启用时必须设置 `USE_POS_RPC=true`，并通过后台 POS 健康检查。

## 3. 已有客户升级

在包含 `supabase/migrations` 的正确客户项目根目录执行：

```powershell
pwd
git status
ls supabase/migrations
npx supabase link --project-ref 客户项目ref
npx supabase db push --dry-run
```

核对 dry-run 只包含预期 migration 后才执行：

```powershell
npx supabase db push
```

安全前置条件：

- 不得执行 `client-init.sql`。
- 不得手工修改 migration history。
- 必须确认远程历史中不存在重命名前的未发布库存 migration；若存在，停止并制定单独前向升级方案。
- 凭据 hardening 后，已有 developer credential 会进入 `must_rotate`，必须由维护者运行：

```powershell
npm run developer:rotate -- --project-ref 客户项目ref
```

## 4. 发布后验收

- POS health 为 ready；`USE_POS_RPC=false` 时 checkout/void 必须 503 且无写入。
- 同一 checkout/void 请求重试不重复扣减或恢复库存。
- 库存调整和 Quick Sell 的余额、流水、操作记录和 legacy 投影一致。
- Quick Sell 仅 owner 可用；staff 使用 POS。
- Feature 关闭后，菜单、页面、直接 API 和员工认证均关闭。
- Store Settings、Legal Settings、Feature Settings 仅有效 developer session 可写。
- 轮换前 Cookie 全部失效，新密码可登录，旧密码不可登录。
- 检查 `sales_orders`、`sales_order_items`、`payments`、`inventory_balances`、`stock_movements`、`inventory_operations` 和 legacy 库存投影。
- 单独验收 Storage bucket、公开读和服务端上传/替换/删除；数据库 migration 成功不等于图片系统已验收。

## 5. 回滚策略

### 仅代码/配置异常

按独立 commit 反向 revert，并保持事务 RPC migration 不回退。若 POS 健康检查失败，应关闭业务入口并返回 503，不要启用旧多步 fallback。

### migration 已部署但尚无业务写入

优先用前向修复 migration。只有新建、可丢弃、确认无数据的客户项目才可重建空库。

### migration 已部署且已有业务写入

不要删除表、函数或幂等流水，也不要直接回滚 schema。停止相关写入口，保留现场，使用部署前备份恢复到独立环境核对，或发布经过验证的前向修复 migration。

### developer credential 异常

使用维护者持有的 service_role CLI 再次 rotate/recovery。不要恢复模板密码，不要添加公开重置 API，也不要把明文放入环境变量、数据库、日志或聊天记录。

## 6. GitHub branch protection（需人工设置）

在 `master` 上至少配置：

- Require a pull request before merging
- Require approvals（至少 1 人）
- Require conversation resolution
- Require branches to be up to date
- Require status checks：
  - `Static quality and dependency audit`
  - `P1 unit tests`
  - `Local Supabase integration and security`
  - `Clean, client-init, and legacy upgrade paths`
- 禁止 force push 和删除受保护分支

## 7. 本地验证不能替代的远程事项

- 目标 Supabase project ref 和真实 migration history
- 真实 Vercel 环境变量与 `USE_POS_RPC=true`
- 真实 Storage bucket/policy
- 远程备份与恢复演练
- GitHub workflow 的首次实际运行
- 真实收银、扫码枪、标签打印机和客户网络环境
