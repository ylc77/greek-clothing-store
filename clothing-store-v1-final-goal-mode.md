# Greek Clothing Store v1.0 最终收尾「目标模式」

> 用途：把下面整份内容一次性粘贴给具备仓库、终端、GitHub、Vercel 与隔离 Supabase 测试权限的代码代理。
>
> 目标模式是一份总编排指令。它可以一次接收全部目标，但必须按阶段、独立分支、独立 PR 顺序执行，禁止把所有剩余工作堆进一个超大 PR。

---

## 一句话目标

从最新 `origin/master` 开始，在不接触真实客户数据和生产数据库的前提下，依次完成公开数据边界与 JSON-LD 安全、图片与 Storage 安全、AI 与认证滥用防护、Skroutz/SEO/法律双语、报表/审计/打印/硬件、备份恢复及最终 v1.0 发布门禁；每个阶段使用独立分支和 PR，先测试后实现，通过本地、GitHub CI、隔离 Preview、数据清理和单人维护者签核后再以 merge commit 合并，直至输出 Basic、Standard、Advanced 三档的最终可发布结论。

---

# 总目标

你正在维护 `ylc77/greek-clothing-store`。

P1、P2 4A 和 P2 4B 已经完成并合并。当前核心事务边界已经覆盖：

- POS checkout / void
- 库存调整、到货、退货、盘点
- Quick Sell
- 商品新增、编辑、批量状态与 Variant 生命周期
- CSV 导入、恢复和商品导出
- 每客户独立开发者凭据
- Migration、client-init、旧库升级、CI 和隔离 Preview

现在进入最终安全加固与发布收尾。不要继续增加新业务功能。

最终目标是：

1. 清除仍影响商用的 P2 安全、隐私、数据边界和运营风险。
2. 将非阻断 P3 明确修复或记录为 Issue，不无限扩大范围。
3. 分别给出 Basic、Standard、Advanced 的发布状态。
4. 完成全新客户部署、旧客户升级、备份恢复、Preview 和生产前检查。
5. 只有全部适用门禁通过后，才能创建正式 `v1.0.0` Release。

---

# 全局执行规则

## 1. Git 与分支规则

每个阶段必须：

1. 从最新 `origin/master` 创建独立分支。
2. 不在上一个阶段分支继续开发。
3. 先建立测试和复现，再修改实现。
4. 拆分为可审查、可回滚的小提交。
5. 本地全绿后推送并创建 Draft PR。
6. GitHub required jobs 全绿后执行隔离 Preview 验收。
7. 验收完成后发布单人维护者签核评论。
8. 使用 **merge commit** 合并，禁止 squash。
9. 合并后从最新 master 开始下一阶段。
10. 删除远程工作分支，但保留审计标签。

推荐阶段标签：

- `audit-<phase>-local-verified`
- `audit-<phase>-ci-verified`
- `audit-<phase>-preview-verified`
- `<phase>-merged`

标签不可移动。若验收后 HEAD 改变，创建 `-v2` 新标签。

不得提交或修改用户原有未跟踪内容：

- `.codex/`
- `clothing-store-global-audit-prompt.md`

## 2. 环境安全

默认只能使用：

- 本地 Supabase
- 临时 PostgreSQL 容器
- 明确隔离的测试 Supabase
- 分支专用 Vercel Preview
- 低额度测试 API Key，或完全不配置 AI Key

禁止：

- 修改真实客户 Supabase
- 在 Production 执行 migration
- 使用真实客户商品、订单、员工、密码或图片
- 把 service-role、Secret Key、Token、密码、Cookie 或连接串写入 Git、PR、聊天、日志、截图或报告
- 为通过测试伪造 migration history
- 使用 `npm audit fix --force`

对 Production、客户数据、收费 API、大规模删除、密钥轮换或真实硬件动作，必须停下来明确报告并等待维护者授权。

## 3. 数据库规则

- 已发布 migration 不得改名、删除或重写。
- 新 migration 使用晚于现有全部文件的单调递增时间戳。
- 任何写 RPC：`SECURITY DEFINER`、安全固定 `search_path`、显式 revoke/grant，只允许 `service_role`。
- `anon` 与 `authenticated` 只拥有最小必要权限。
- 修改 migration 后必须重新生成 `supabase/client-init.sql` 并做逐字节漂移检查。
- 每阶段必须验证：
  - 空库 migration chain
  - client-init 空库
  - 当前 master 到新阶段的升级
  - 必要的 legacy fixture

## 4. 测试和质量规则

每阶段至少运行：

- `npm ci`
- `git diff --check`
- `npm run typecheck`
- `npm run build`
- 全部现有 P1、4A、4B 回归
- 当前阶段新增单元/集成/并发/故障注入测试
- `npx supabase db reset --local --no-seed`
- client-init 安装
- legacy upgrade fixture
- RLS/grants/RPC 安全检查
- Secret scan
- database advisors
- reconciliation
- 最终测试数据与 Storage 清理

关键测试不得 skipped。若命令因时限终止，重置隔离环境后逐项重新执行并记录。

## 5. Preview 规则

Preview 开始前必须记录：

- PR 编号
- 完整 HEAD SHA
- Preview URL
- Deployment ID
- 测试 Supabase project ref 和 region
- migration 数量
- Preview 分支环境变量范围

必须确认 Preview 与测试 Supabase 一一对应，且不连接客户或生产项目。

Preview 结束后：

- 清理所有带阶段前缀的商品、Variant、余额、流水、订单、付款、Job、账号、凭据和 Storage 对象
- Feature 恢复为 `advanced`
- 清除 Cookie、sessionStorage 和临时脚本
- 删除分支 Preview 环境变量
- 删除或保护旧 deployment
- 撤销或轮换临时测试 Secret Key

## 6. 自主执行与停止条件

无需在阶段之间反复询问，可以自动继续，但以下情况必须停止：

- 发现新的 P0 或 P1
- 需要改生产或客户数据库
- 需要付费升级、调用收费服务或真实硬件
- migration 历史存在冲突或无法安全升级
- GitHub CI、Preview、Secret scan、reconciliation 或清理门禁失败
- 需要删除无法确认用途的数据或项目
- 阶段范围出现重大架构变化，无法保持独立 PR

停止时输出：阻断原因、证据、最小解除步骤，不要自行绕过。

---

# 阶段 5A：公开数据边界与 JSON-LD 注入安全

分支：

`codex/hardening-p2-public-data-boundary`

目标：

1. 修复商品详情 JSON-LD 持久化 XSS。
2. 匿名用户不能直接读取完整 `products` 基础表或采购字段。
3. 建立明确的前台、AI、Skroutz、后台与采购 DTO。
4. staff、readonly 和匿名不能读取成本价、供应商 VAT、邮箱、电话、联系人和内部备注。
5. inventory 只读取完成库存工作必要的最小采购字段。
6. 角色相关响应不能进入跨用户共享缓存。

必须处理：

- 统一 `serializeJsonForHtmlScript` 或等价安全 helper
- 转义 `<`、`>`、`&`、U+2028、U+2029 和 `</script>` 边界
- 结构化数据对象由代码构建，用户字段只能作为字符串值
- 前台专用 View/RPC 或服务端公开 DTO
- 撤销 anon 对私有基础表字段的访问
- `procurement:read` / `procurement:cost` 或等价权限
- Products、Inventory、Suppliers API 按角色塑形
- AI、Feed、sitemap 使用最小消费者 DTO
- 静态门禁：公开查询禁止 `select("*")`，危险 HTML helper 必须经过批准

必须测试：

- `</script><script>...`
- HTML 标签、注释边界、U+2028/U+2029、恶意 URL
- 原始 HTML 只有预期 JSON-LD script
- JSON-LD 仍可 `JSON.parse`
- anon handcrafted REST 查询无法请求采购字段
- owner/staff/inventory/readonly/developer/anonymous 字段矩阵
- owner 请求后低角色请求不会命中错误缓存

完成后独立 Draft PR、CI、Preview、签核、merge commit。

---

# 阶段 5B：图片上传、Storage 生命周期与服务器端取图安全

分支：

`codex/hardening-p2-storage-image-security`

目标：

1. 修复 Store Settings 图片上传对 MIME、大小、像素和处理失败的边界。
2. 修复商品图片与设置图片的 Storage/数据库非原子问题。
3. 修复 AI 模特图或其他服务器端图片 fetch 的 SSRF。
4. 明确商品永久删除与图片清理的安全流程。

必须处理：

- 只接受明确格式：JPEG、PNG、WebP；按 magic bytes 验证
- 严格文件字节上限、像素上限、宽高上限、解压炸弹防护
- Sharp 失败必须拒绝，禁止原文件 raw fallback
- `name` 参数严格 enum，例如 logo/hero/category
- Storage path 规范化、碰撞和跨 SKU 边界
- 公共 bucket policy 最小化
- 上传：Storage 成功、DB 失败时补偿删除或进入 orphan queue
- 删除：先标记/事务记录，再删除对象并确认；失败进入可恢复状态
- 定期只读 orphan reconciliation
- 永久删除商品必须保护历史订单、流水、Variant、余额和外部引用
- 服务器端 fetch 只允许当前客户 Storage 域名或明确 allowlist
- 禁止 loopback、private、link-local、metadata、IPv6 私网、重定向绕过和 DNS rebinding
- 下载设置超时、Content-Length、流式大小上限和内容类型验证

必须测试：

- 伪造 MIME
- SVG/脚本型内容
- HEIC/异常图片
- 超大文件、超大像素、截断/畸形图
- 路径字符和碰撞 SKU
- Storage 成功/DB 失败、DB 成功/Storage 失败
- orphan 清理
- IPv4/IPv6/重定向/私网 SSRF
- 匿名和低角色不能写 Storage

完成后独立 Draft PR、CI、Preview、签核、merge commit。

---

# 阶段 5C：AI、登录与会话滥用防护

分支：

`codex/hardening-p2-ai-auth-abuse`

目标：

1. 公开 AI 导购具备共享限流、预算、并发、超时和输入上限。
2. 身高、体重、胸腰臀等数据只在明确告知和最小化后发送给模型供应商。
3. 管理员环境密码和 developer 登录具备跨实例防爆破。
4. 员工 Supabase Token 刷新和退出生命周期正确。
5. 完成 Issue #3 的 401/403 语义一致性。

必须处理：

- 共享限流存储，不能只用进程内 Map
- 按 IP、会话、店铺和全局维度限流
- 每分钟、每日预算和并发限制
- 上游 fetch 超时、AbortController、最大 token/响应大小
- message、measurements、productContext schema 和长度限制
- AI 不得读取采购/内部字段
- Prompt Injection 防护：模型输出只能引用允许 SKU，服务端二次校验
- PII 最小化、明确隐私文案和同意状态；不记录完整身体数据
- 管理员密码使用 timing-safe 比较、弱密码与重复角色密码启动检查
- developer 登录限流迁移到共享存储，并限制失败审计容量
- Supabase `onAuthStateChange`、刷新后的 Token 更新和真正 `signOut()`
- 未认证 401、已认证无权限 403、Feature 关闭 403、能力不可用 503
- admin_users 增加大小写不敏感 email 唯一约束和安全升级
- 明确 revoke 多余默认 grants

必须测试：

- 多实例/冷启动限流
- IP 伪造和代理规范化
- 预算耗尽
- 上游超时和异常 JSON
- 超长输入和并发请求
- 身体数据不进入日志
- Token 短生命周期刷新
- 退出后 session 与 API 均失效
- owner/staff/inventory/readonly 状态码矩阵

完成后独立 Draft PR、CI、Preview、签核、merge commit。

---

# 阶段 6A：Skroutz、SEO、法律双语与前台合规

分支：

`codex/hardening-p2-channels-seo-legal`

目标：

1. Skroutz Feed 与官方规范和 Validator 对齐。
2. Greek/English 原始 HTML 的 `lang`、canonical、hreflang 一致。
3. 法律政策真正支持希腊语和英语独立内容。
4. Cookie、AI 身材数据和第三方服务说明完整。
5. 前台安全响应头和基础可访问性收尾。

必须处理：

- Feed 只输出实际可售尺码
- HTTPS 链接、EAN/MPN/品牌/制造商规则
- 图片尺寸、非法 XML 字符、UTF-8、分页和完整性
- 测试 SKU/Demo SKU 排除
- 官方 Skroutz Validator 验收；若无法使用，标记 Advanced 阻断
- `/el/...`、`/en/...` 或等价稳定语言 URL 方案
- 原始 HTML 即包含正确 lang、canonical、alternate hreflang
- sitemap 包含语言版本和完整分页
- Legal Settings 改为 GR/EN 字段或 locale map
- 发布时两种语言完整性校验
- 隐私政策包含 AI 供应商、身体数据、保存策略和联系渠道
- Cookie 文案和所有硬编码前台文本进入 i18n
- Return/Shipping 等 metadata 本地化
- CSP、frame-ancestors/X-Frame-Options、nosniff、Referrer-Policy、Permissions-Policy
- 后台 noindex
- 登录表单 label/aria、键盘基本可用性

必须测试：

- 原始 HTML，不只 hydration 后 DOM
- EL/EN canonical/hreflang
- XML parser、非法字符、1001+ 商品
- Feed 官方 validator
- 法律发布双语必填
- 安全响应头
- axe/键盘基础检查

完成后独立 Draft PR、CI、Preview、签核、merge commit。

---

# 阶段 6B：报表、审计、打印、容量与运营完整性

分支：

`codex/hardening-p2-operations-reporting-print`

目标：

1. POS 日报使用 `Europe/Athens` IANA 时区和数据库聚合。
2. 健康检查能发现部分订单、付款和库存流水不一致。
3. 记录真实操作者，不再统一写 `admin`。
4. 标签、小票和导出使用真实店铺品牌与 GR/EN 文案。
5. 清除仍存在的固定 200/500/1000 行截断。
6. 建立真实可恢复的备份与灾备流程。

必须处理：

- DST、冬夏时制切换、午夜边界
- 日报分页/数据库聚合，不先截断 500 行
- 对账订单明细数量、付款金额、sale/void movement 每个 Variant
- actor user ID、role、auth type，append-only audit event
- 标签按实际件数打印，正确店名、语言、价格和条码
- 小票不是税务票据的明确文案
- 前台分类、后台标签、POS 搜索、Feed、sitemap 的容量分页
- 商品 CSV 导出继续明确不是灾备
- Supabase 数据库备份、Storage 清单、恢复脚本和恢复演练
- 明确 RPO/RTO
- Feature fallback 文案与实际 Basic 安全回退一致
- Barcode API 的唯一性、并发和历史稳定性

真实硬件门禁：

- USB/蓝牙扫码枪
- 标签打印机
- 连续纸尺寸偏移
- 小票打印
- 条码离线解码

如果无法获得硬件：

- Basic 可继续评估
- Standard 标记为“硬件未验收，不可正式交付”
- Advanced 继承 Standard 的硬件门禁

完成后独立 Draft PR、CI、Preview、签核、merge commit。

---

# 阶段 7：最终 v1.0 发布门禁

分支：

`codex/release-v1-production-readiness`

本阶段不再做大型重构，只做最终集成、文档、环境和发布判定。

## 1. 全仓库最终回归

执行所有：

- P1
- Product 4A
- CSV 4B
- 5A/5B/5C
- 6A/6B
- 并发
- 故障注入
- 权限矩阵
- Feature 矩阵
- Secret scan
- 依赖审计
- DB reset/client-init/legacy upgrade
- reconciliation
- 390/768/1440

所有关键测试不得 skipped。

## 2. 新客户部署演练

在全新隔离 Supabase：

1. 执行 client-init
2. developer bootstrap
3. 配置 Vercel Preview
4. 创建 owner/staff/inventory/readonly
5. 创建商品与图片
6. 测试库存、POS、CSV、Feature、Legal、Feed
7. 完整清理

## 3. 旧客户升级演练

使用至少两种 fixture：

- P1 之前旧库
- P2 4B 之前旧库

验证 ID、订单、流水、图片引用、员工和设置不丢失。

## 4. 备份恢复演练

必须真正完成：

- 数据库备份
- Storage 对象清单/备份
- 在新的临时项目恢复
- 校验商品、Variant、余额、订单、付款、设置、法律版本和图片
- 记录 RPO/RTO

仅有“导出 CSV”不算备份。

## 5. Production 前检查

只读确认：

- Production Supabase project ref
- migration history
- RLS/grants/RPC
- Vercel 环境变量范围
- `USE_POS_RPC=true`
- `USE_PRODUCT_RPC=true`
- `USE_CSV_IMPORT_RPC=true`
- service/secret key 不公开
- 自定义域名和 `NEXT_PUBLIC_SITE_URL`
- 日志、告警和监控
- Branch protection 与 required checks

未获得明确授权不得修改 Production。

## 6. 按版本判定

### Basic 可发布条件

- 前台、商品、图片、分类、供应商最小权限
- 库存、调整、流水、对账
- 法律双语
- 备份恢复
- 安全和部署门禁

### Standard 可发布条件

Basic 全部条件，加：

- POS checkout/void/日报
- CSV
- 员工账号
- 条码与标签
- 扫码枪、标签机和小票真实硬件验收

### Advanced 可发布条件

Standard 全部条件，加：

- Skroutz 官方 Validator
- AI 限流、预算、PII 和隐私
- 维护导出/恢复边界

分别输出：`READY`、`CONDITIONAL` 或 `BLOCKED`，不能只给一个模糊结论。

## 7. 发布产物

生成或更新：

- `docs/v1-release-readiness.md`
- `docs/v1-deployment-runbook.md`
- `docs/v1-upgrade-runbook.md`
- `docs/v1-backup-restore-runbook.md`
- `docs/v1-known-limitations.md`
- `docs/v1.0-release-notes.md`
- 客户部署检查清单
- 维护者密钥与轮换清单，不含秘密值

所有适用门禁通过后：

1. 创建最终 Release PR
2. CI、Preview、签核、merge commit
3. 在 merge commit 创建不可移动标签 `v1.0.0`
4. 创建 GitHub Release
5. 不自动部署 Production，除非维护者明确授权

---

# 非阻断长期优化

以下不得阻止 v1.0，除非测试证明会导致真实安全或数据问题：

- 拆分超大 `admin-dashboard.tsx`
- 更换状态管理或 UI 框架
- 大规模视觉重设计
- 新支付功能
- 在线购物车或电商结账
- 新 AI 功能
- 多仓库、会计或 myDATA 深度集成

为这些项目创建独立 GitHub Issues，并标记：

- `post-v1`
- `refactor`
- `enhancement`

---

# 每阶段完成报告格式

每个阶段必须输出：

1. 分支、基线 SHA、最终 HEAD
2. 原问题复现
3. 修改摘要
4. 数据库与权限变化
5. 修改文件
6. commit SHA 和用途
7. 单元、集成、并发和故障测试结果
8. migration 三路径结果
9. GitHub CI 结果
10. Preview URL、Deployment ID、测试 project ref
11. 日志和 Secret scan
12. reconciliation 和数据清理
13. 非阻断后续项
14. 回滚方案
15. 是否允许合并
16. 是否允许进入下一阶段

不能把本地通过描述成 Preview 或 Production 通过。

---

# 最终完成定义

只有以下条件全部满足，才可宣布项目“收尾”：

- 已确认 P0/P1 为 0
- 商用相关 P2 已修复，或对应功能被明确关闭
- Basic 发布状态至少为 READY
- Standard 和 Advanced 分别有明确 READY/CONDITIONAL/BLOCKED 结论
- 所有数据库写路径具备事务、幂等和故障恢复
- 权限、RLS、Feature Gate、公开 DTO、密钥和日志通过
- 空库、client-init、旧库升级通过
- 隔离 Preview 通过
- 备份恢复演练通过
- 客户部署、升级、回滚、已知限制文档完整
- 所有测试数据和临时密钥完成清理
- `v1.0.0` 标签和 Release 已创建，或明确列出唯一剩余外部阻断

现在从最新 `origin/master` 开始执行。先建立一份剩余风险矩阵和阶段看板，然后按 5A → 5B → 5C → 6A → 6B → 7 的顺序推进。除上述停止条件外，不需要在阶段之间再次询问。
