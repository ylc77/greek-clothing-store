# v1.0 阶段看板

当前 6A 基线：`b30e3efd5b8c2fc0b24a89835fc4988c1d14a9a6`（5C merge commit；建立 6A 分支时的最新 `origin/master`）
总原则：每阶段独立分支、独立 PR，测试先行，本地 → CI → 隔离 Preview → 清理 → 单人维护者签核 → merge commit。

## 当前状态

| 阶段 | 分支 | 状态 | 当前出口条件 |
|---|---|---|---|
| 风险矩阵/看板 | `codex/hardening-p2-public-data-boundary` | 完成 | 风险均有证据等级、完成证据和停止条件。 |
| 5A 公开数据边界 | `codex/hardening-p2-public-data-boundary` | 已完成并合并 | PR #6、CI、隔离 Preview、清理、签核、阶段标签和 merge commit `7d943ea` 均完成。 |
| 5B 图片与 Storage | `codex/hardening-p2-storage-image-security` | 已完成并合并 | PR #7、本地、CI、隔离 Preview、零残留清理、签核和 `v1-phase-5b-merged` 标签均完成；merge commit `23dd67b`。 |
| 5C AI 与认证 | `codex/hardening-p2-ai-auth-abuse` | 已完成并合并 | PR #8、本地、CI、隔离 Preview、清理、签核和阶段标签均完成；merge commit `b30e3ef`。 |
| 6A 渠道/SEO/法律 | `codex/hardening-p2-channels-seo-legal` | 全量本地门禁已通过，等待 CI 和隔离 Preview | 20 migrations、127 单元测试、149 具名集成场景、22 安装路径断言、生产 build、三视口浏览器、权限、advisors、对账、秘密扫描和清理均通过；官方 Skroutz Validator 与线上监控仍须在 Preview 验收。 |
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
- [x] Draft PR、CI、Preview、清理、签核、标签和 merge commit。

## 5B 工作包

- [x] JPEG/PNG/WebP magic bytes、声明 MIME、字节、像素、宽高、动画/多页和损坏图片校验。
- [x] Sharp 解码/处理失败 fail closed；所有接受图片统一重新编码为 WebP。
- [x] Logo/Hero/Category 严格 target enum；商品对象按不可变 product id、SKU hash、用途和 UUID 隔离。
- [x] 上传/引用/删除状态机、失败补偿、待清理队列和 service-role-only 恢复记录。
- [x] AI 参考图 exact-origin allowlist、Storage 路径限制、DNS/重定向/IPv4/IPv6/metadata/流式体积与超时保护。
- [x] 永久删除 RPC 保护订单、库存流水、库存操作、商品操作、导入记录、Variant 余额和旧库存投影。
- [x] 只读 orphan/missing/pending reconciliation；显式 project ref 的恢复 CLI。
- [x] 专项 unit、Route/Storage 集成、故障注入、数据库权限和三条安装路径测试。
- [x] 全量 P1/4A/4B/5A 回归、build、secret scan、database advisors。
- [x] Draft PR 和四项 required CI。
- [x] 隔离 Preview 图片/权限/生命周期业务验收、390/768/1440 浏览器验收和零残留清理。
- [x] 当前精确 HEAD 复验、签核、Preview 标签和 merge commit。

## 5C 工作包

- [x] AI 的 IP、会话、店铺、全局分钟限制、每日预算、并发 lease 和重放保护使用共享数据库状态。
- [x] 用户明确同意后才提交身体测量字段；最小化输入，不持久化、不写日志。
- [x] 服务端公开商品投影、允许 SKU 二次约束、请求/上游响应大小、超时和异常 JSON 门禁。
- [x] 环境紧急密码强度/重复启动检查、timing-safe 验证和跨实例共享登录限流。
- [x] Developer 登录共享限流；未初始化、需轮换、限流和能力不可用均 fail closed。
- [x] Supabase 员工 Token 初始恢复、刷新、登出和浏览器/API 同步失效。
- [x] 未认证 401、无权 403、Feature 关闭 403/`FEATURE_DISABLED`、安全能力不可用 503。
- [x] 管理员邮箱统一小写并建立大小写不敏感唯一约束；重复旧数据安全停止而非静默合并。
- [x] 专项 unit、Route、多实例、预算/并发、PII 日志、数据库权限和四条安装路径测试。
- [x] 全量既有 P1/4A/4B/5A/5B 回归和本地 build。
- [x] Draft PR 和精确 HEAD 的 GitHub 四项 required CI。
- [x] 隔离 Preview 8/8 业务验收、390/768/1440 浏览器检查、日志扫描和零残留清理。
- [x] 单人维护者签核、CI/Preview 标签和 merge commit。

## 6A 工作包

- [x] Feed 使用服务端公开投影、`MAIN_STORE` 权威余额和扣除预留后的可售库存。
- [x] 测试/Demo、无英文资料、无真实品牌/MPN/EAN、非 HTTPS、图片尺寸不足和尺码映射不完整的商品不进入 Feed。
- [x] Feed XML、1,000+ 分页、数量/Variant 一致性和 Skroutz crawler 监控测试。
- [x] Greek/English 原始 HTML `lang`、canonical、reciprocal hreflang、sitemap 和 robots/noindex。
- [x] CSP nonce、安全响应头、390/768/1440 axe、横向溢出和后台键盘登录检查。
- [x] 独立 Greek/English 法律内容、双语发布校验和 service-role-only 事务发布 RPC。
- [x] 20 migrations 空库 reset、client-init、legacy upgrade、并发、故障注入和清理测试。
- [x] Phase 6A 专项静态、单元、数据库和浏览器检查加入现有四项 GitHub CI。
- [x] 全量既有回归。
- [x] 精确 HEAD 本地标签 `audit-v1-6a-local-verified`（创建于本地全量门禁通过后的报告提交）。
- [ ] Draft PR 与四项 required CI。
- [ ] 隔离 Preview、官方 Skroutz Validator、严格线上监控和零残留清理。
- [ ] 单人维护者签核、CI/Preview 标签和 merge commit。

## 发布版本判定占位

| 版本 | 当前状态 | 说明 |
|---|---|---|
| Basic | `BLOCKED` | 5A–5C 已完成，6A 尚待 Preview，6B 备份恢复和最终发布门禁尚未完成。 |
| Standard | `BLOCKED` | 继承 Basic；真实扫码枪、标签机和小票硬件尚未验收。 |
| Advanced | `BLOCKED` | 继承 Standard；Skroutz 官方 Validator、6B 运营门禁和最终发布验收尚未完成。 |

只有阶段 7 的当前证据可以把这些状态改为 `READY` 或 `CONDITIONAL`。未完成真实硬件验收时，不得把 Standard/Advanced 描述为正式可交付。
