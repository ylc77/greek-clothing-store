# v1 已有客户升级手册

已有数据库只允许使用 migration 升级，禁止执行 `client-init.sql`。

## 1. 冻结并备份

1. 记录当前代码 SHA、Vercel deployment、Supabase project ref、region 和远程 migration history。
2. 暂停后台写入窗口。
3. 执行数据库 + Auth + Storage 完整备份，并运行 `customer:backup:verify`。
4. 先在新的隔离 Supabase 恢复并验证；未通过不得继续客户项目。

## 2. 检查 migration history

在项目根目录执行：

```powershell
pwd
git status
Get-ChildItem supabase/migrations
npx supabase link --project-ref 客户项目ref
npx supabase db push --dry-run
```

- project ref 不符、出现未知远程版本、要求 `--include-all` 或计划包含非预期变更时立即停止。
- 不执行 `migration repair`，除非已经逐项证明远程版本的真实来源和等价性。
- 不重命名、删除或重写已在客户数据库执行过的 migration。

## 3. 在隔离副本演练

至少保留两类 fixture：P1 之前旧库、P2 4B 之前旧库。验证：

- 商品 bigint ID、Variant、余额和兼容库存投影；
- 历史订单、明细、付款和库存流水；
- 员工、Feature、店铺和法律版本；
- 图片引用和 Storage 对象；
- 原有 SKU、条码、幂等键和审计记录不丢失。

## 4. 正式升级

```powershell
npx supabase db push
```

数据库完成后再更新 Vercel：

```text
USE_POS_RPC=true
USE_PRODUCT_RPC=true
USE_CSV_IMPORT_RPC=true
AUTH_RATE_LIMIT_SECRET=每客户唯一服务端随机值
```

重新部署后运行 runtime health。任何 RPC、grant、RLS 或环境配置缺失必须返回 503/fail closed，禁止恢复旧 JS 多步写入。

## 5. 开发者凭据与会话

已有 developer credential 升级后一律视为可能共享并进入 `must_rotate`：

```powershell
npm run developer:status -- --project-ref 客户项目ref
npm run developer:rotate -- --project-ref 客户项目ref
```

轮换后旧密码和全部旧 Cookie 必须立即失效。不要通过公开 API、邮件或普通 owner 恢复开发者密码。

## 6. 回归与回滚决定

验证商品、库存、POS、CSV、员工、法律、Storage、Feed、日志和备份。若数据库已迁移而应用回滚，旧代码不得写入新事务边界；优先 roll forward 修复。确需回滚时：

- 先阻断相关写 API；
- 保留已提交 migration 和数据；
- 回滚应用到明确兼容的新旧边界版本；
- 不使用 `db reset`、`DROP` 或 `client-init.sql` 处理客户库。
