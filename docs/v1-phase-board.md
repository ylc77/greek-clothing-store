# v1.0 阶段看板

基线：`49aeb93afd1ea08e41c692af9acbddb6b169a10a`（2026-07-16 的最新 `origin/master`）  
总原则：每阶段独立分支、独立 PR，测试先行，本地 → CI → 隔离 Preview → 清理 → 单人维护者签核 → merge commit。

## 当前状态

| 阶段 | 分支 | 状态 | 当前出口条件 |
|---|---|---|---|
| 风险矩阵/看板 | `codex/hardening-p2-public-data-boundary` | 完成 | 风险均有证据等级、完成证据和停止条件。 |
| 5A 公开数据边界 | `codex/hardening-p2-public-data-boundary` | 本地门禁完成 | JSON-LD、匿名列权限、角色 DTO、缓存、静态门禁和数据库安装路径已本地通过；仍需 Draft PR、CI、隔离 Preview、清理签核和合并。 |
| 5B 图片与 Storage | `codex/hardening-p2-storage-image-security` | 等待 5A 合并 | MIME/magic bytes、Sharp、资源限制、Storage 补偿、SSRF、永久删除、orphan 对账通过。 |
| 5C AI 与认证 | `codex/hardening-p2-ai-auth-abuse` | 等待 5B 合并 | 共享限流/预算/并发/超时/PII、登录防爆破、Token 生命周期和状态码矩阵通过。 |
| 6A 渠道/SEO/法律 | `codex/hardening-p2-channels-seo-legal` | 等待 5C 合并 | Skroutz Validator、EL/EN 原始 HTML、法律双语、安全头和可访问性通过。 |
| 6B 运营/报表/打印 | `codex/hardening-p2-operations-reporting-print` | 等待 6A 合并 | Athens 时区、对账、审计、容量、打印、备份恢复与硬件状态结论完成。 |
| 7 v1.0 发布门禁 | `codex/release-v1-production-readiness` | 等待 6B 合并 | 全回归、部署/升级/恢复演练、只读生产检查、三版本结论、Release PR、`v1.0.0` 和 GitHub Release。 |

## 每阶段固定门禁

1. 从最新 `origin/master` 建立规定分支，记录基线 SHA。
2. 先提交可重复复现和回归测试，再提交实现。
3. 运行 `npm ci`、`git diff --check`、typecheck、build、现有 P1/4A/4B 回归和阶段测试。
4. 数据库变更使用晚于全部现有 migration 的时间戳；重新生成并逐字节验证 `client-init.sql`。
5. 验证空库 migration reset、client-init 空库、master→阶段升级及必要 legacy fixture。
6. 验证 RLS/grants/RPC、database advisors、secret scan、reconciliation 和测试数据/Storage 清理。
7. 创建 Draft PR；GitHub required checks 全绿。
8. 在一对一隔离 Supabase/Vercel Preview 验收，记录 PR、SHA、URL、Deployment ID、project ref、region、migration 数量和环境变量范围。
9. Preview 清理为零，撤销临时凭据和分支环境变量；完成 solo maintainer sign-off。
10. 创建阶段 local/CI/Preview 不可移动标签，以 merge commit 合并；再从新 `master` 建下一阶段分支。

## 5A 工作包

- [x] JSON-LD 恶意字段测试和安全 serializer。
- [x] 公开 Storefront/AI/Skroutz/Sitemap DTO。
- [x] 数据库列级公开权限或安全公开接口；匿名采购字段读取必须失败。
- [x] `procurement:read`、`procurement:cost`、`procurement:write` 权限边界。
- [x] Products/Inventory/Suppliers 按角色塑形。
- [x] 角色响应 `private, no-store`，缓存交叉请求测试。
- [x] 静态门禁禁止公开 `select("*")` 与未批准危险 HTML helper。
- [x] 单元、Route、数据库权限矩阵和浏览器原始 HTML 测试。
- [x] migration/client-init/legacy 安装与安全门禁。
- [ ] Draft PR、CI、Preview、清理、签核、标签和 merge commit。

## 发布版本判定占位

| 版本 | 当前状态 | 说明 |
|---|---|---|
| Basic | `BLOCKED` | 5A–6B 安全、法律双语和备份恢复尚未完成。 |
| Standard | `BLOCKED` | 继承 Basic；真实扫码枪、标签机和小票硬件尚未验收。 |
| Advanced | `BLOCKED` | 继承 Standard；Skroutz 官方 Validator 与 AI 滥用防护尚未完成。 |

只有阶段 7 的当前证据可以把这些状态改为 `READY` 或 `CONDITIONAL`。未完成真实硬件验收时，不得把 Standard/Advanced 描述为正式可交付。
