# v1.0 剩余风险矩阵

基线：`origin/master` at `49aeb93afd1ea08e41c692af9acbddb6b169a10a`
建立日期：2026-07-16
执行顺序：5A → 5B → 5C → 6A → 6B → 7

本矩阵只把有代码、数据库、运行结果或可重复测试证据的问题标记为“已确认”。尚未完成动态复现的项目保留为“待验证假设”，不得当作已确认漏洞。

## 严重等级

- P0：可立即导致大范围不可逆数据损失、关键系统失控或已被利用的严重漏洞。
- P1：阻止商用上线的权限、事务、秘密或远程代码执行问题。
- P2：必须在对应商业版本交付前修复的安全、合规、完整性或运营风险。
- P3：不阻止 v1.0 的维护性、体验或长期扩展问题。

## 剩余风险

| ID | 阶段 | 等级 | 状态 | 风险与证据 | 完成证据 |
|---|---|---:|---|---|---|
| 5A-01 | 5A | P2 | 已确认 | `app/product/[sku]/page.tsx` 将商品字段直接 `JSON.stringify` 后写入 `dangerouslySetInnerHTML`，未转义 `</script>`、`<`、`>`、`&`、U+2028/U+2029，可形成持久化 JSON-LD script 边界逃逸。 | 恶意商品字段的原始 HTML 仅有预期 JSON-LD script；脚本文本可 `JSON.parse`；浏览器不执行注入内容。 |
| 5A-02 | 5A | P2 | 已确认 | 基线 migration 对 `anon`/`authenticated` 授予 `public.products` 整表 SELECT；RLS 只能限制行，手工 PostgREST 查询仍可请求供应商和内部字段。 | 数据库权限测试证明匿名只能读公开列，读取采购列被拒绝；公开页面、AI、Feed、sitemap 正常。 |
| 5A-03 | 5A | P2 | 已确认 | Products API 对所有 `products:read` 角色使用 service role `select(*)`；Suppliers API 对所有 `products:read` 角色返回 `select(*)`；Inventory DTO 含 `cost_price` 和供应商字段。staff/readonly 可越过最小数据边界。 | owner/staff/inventory/readonly/developer/anonymous 字段矩阵全部通过，inventory 仅获得库存作业必需采购字段。 |
| 5A-04 | 5A | P2 | 已确认 | 角色相关 Products/Inventory/Suppliers 响应未统一设置 `private, no-store`，存在共享缓存误配置后跨角色复用的风险。 | 每个角色响应均为动态、private/no-store；owner 后低权限请求不命中高权限缓存。 |
| 5A-05 | 5A | P2 | 已确认 | 公开、AI、Skroutz、后台与采购数据选择散落在多个文件，缺少可静态检查的 DTO 边界。 | DTO/选择器集中定义；静态门禁禁止公开路径 `select("*")` 和未批准危险 HTML helper。 |
| 5B-01 | 5B | P2 | 已确认 | Store Settings 上传在 Sharp 失败时回退保存原文件；未看到统一的 magic-byte、像素和尺寸上限。 | JPEG/PNG/WebP magic bytes、字节/像素/宽高限制通过；Sharp 失败拒绝且不产生对象。 |
| 5B-02 | 5B | P2 | 待验证假设 | 图片上传、数据库引用更新和对象删除分步执行，可能产生孤儿对象或悬空引用。 | 故障注入覆盖 Storage 成功/DB 失败与 DB 成功/Storage 失败；orphan reconciliation 为 0。 |
| 5B-03 | 5B | P2 | 已确认 | AI 模特图服务端对 URL 执行 fetch；当前仅做 URL 字符串检查，尚无完整 DNS、重定向、私网和流式体积边界。 | IPv4/IPv6、重定向、DNS rebinding、metadata/private/link-local SSRF 测试全部拒绝。 |
| 5B-04 | 5B | P2 | 待验证假设 | 永久删除商品可能未完整保护历史订单、库存流水、Variant 余额和外部图片引用。 | 数据库 fixture 覆盖有/无历史引用；受保护对象不能永久删除；清理流程可恢复并可对账。 |
| 5C-01 | 5C | P2 | 已确认 | 公共 AI 限流位于进程内 `Map`，多实例和冷启动可绕过；缺少共享分钟/日预算及全局并发边界。 | 多实例与冷启动测试、IP/会话/店铺/全局维度、日预算和并发门禁全部通过。 |
| 5C-02 | 5C | P2 | 待验证假设 | AI 上游超时、响应大小、Prompt Injection、允许 SKU 二次校验及身体数据最小化需要完整动态验证。 | 超时、异常 JSON、超长输入、并发、PII 日志扫描和允许 SKU 校验测试通过。 |
| 5C-03 | 5C | P2 | 已确认 | 环境管理员密码认证仍以环境变量为主，需要 timing-safe 比较、弱密码/重复角色密码启动检查和共享限流。 | 多实例爆破测试、弱密码启动失败、重复密码失败、timing-safe 单元测试通过。 |
| 5C-04 | 5C | P2 | 待验证假设 | 员工 Supabase Token 刷新、`onAuthStateChange` 和真正 `signOut()` 生命周期尚未形成完整浏览器回归。 | token 刷新/过期/登出后 UI 与 API 同时失效；所有旧 token/cookie 无写权限。 |
| 5C-05 | 5C | P3 | 已确认 | Issue #3：部分“已认证但无权”响应使用 401，语义不一致但当前能够拒绝写入。 | 未认证 401、无权 403、Feature 关闭 403/`FEATURE_DISABLED`、能力不可用 503。 |
| 6A-01 | 6A | P2 | 已确认 | 线上 `feed.xml` 当前 HTTP 200 但 `<products>` 为空，Daily site monitor #15 因“Feed 没有商品”失败；Feed 仍需官方规则和容量验收。 | 隔离 Preview 生成真实可售 Variant Feed；XML/1001+ 商品/官方 Validator 通过；监控全绿。 |
| 6A-02 | 6A | P2 | 已确认 | 当前语言主要依赖查询参数和 hydration 前脚本设置 `lang`，原始 HTML 的 canonical/hreflang/语言 URL 不完整。 | `/el/...`、`/en/...` 或等价稳定 URL 的原始 HTML lang/canonical/hreflang 与 sitemap 一致。 |
| 6A-03 | 6A | P2 | 待验证假设 | Legal Settings 的 GR/EN 独立内容、发布完整性、Cookie/AI 身体数据/第三方服务说明可能不足。 | 双语必填发布测试、Privacy/Cookie/Terms 页面原始 HTML 与第三方启用状态一致。 |
| 6A-04 | 6A | P2 | 待验证假设 | 安全响应头、后台 noindex、表单 label/aria 与键盘访问尚未按全站矩阵验证。 | header 集成测试、robots/noindex、axe 和键盘基础验收通过。 |
| 6B-01 | 6B | P2 | 已确认 | POS 日报未使用 `Europe/Athens` IANA 时区，查询和展示存在 DST/午夜边界错误风险；订单列表存在固定 `.limit(500)`。 | 冬/夏令时和切换日数据库聚合测试；1000+ 订单分页总额正确。 |
| 6B-02 | 6B | P2 | 待验证假设 | 健康检查对部分订单明细、付款、sale/void movement 的逐 Variant 不一致覆盖不足。 | 故障 fixture 均被 reconciliation 检出，修复后对账为 0。 |
| 6B-03 | 6B | P2 | 待验证假设 | 部分操作 actor 仍可能统一写 `admin`；缺少 append-only actor/user/role/auth-type 审计事件。 | owner/staff/inventory/developer 操作均记录真实 actor，审计表不可由普通角色修改。 |
| 6B-04 | 6B | P2 | 待验证假设 | 标签、小票和导出可能仍含固定店名/单语文本；标签数量、价格、条码与连续纸布局需验证。 | 店铺配置驱动 GR/EN 输出，按件数打印；浏览器打印快照及硬件门禁记录完成。 |
| 6B-05 | 6B | P2 | 已确认 | 当前“备份”主要是商品 CSV 导出，不是数据库和 Storage 的可恢复灾备。 | 数据库备份、Storage 清单/备份、隔离恢复演练、完整校验、RPO/RTO 记录。 |
| 6B-06 | 6B | 外部门禁 | 未执行 | 扫码枪、标签机、连续纸偏移、小票打印和离线解码必须使用真实硬件；自动化不能替代。 | 真实硬件验收记录；缺失时 Standard/Advanced 必须标记 `CONDITIONAL` 或 `BLOCKED`。 |
| 7-01 | 7 | 发布门禁 | 未执行 | 尚未执行 5A–6B 后的全量回归、新客户部署、两种旧客户升级、真实备份恢复和只读 Production 检查。 | 所有发布清单逐项有当前 SHA 和环境证据，无 skipped 关键测试。 |

## 已关闭的高风险基线

以下已由 P1、4A 和 4B 的当前 `master` 回归资产保护，不在 5A–7 重开设计：

- POS checkout/void RPC-only、事务、并发与业务幂等。
- 库存调整与 Quick Sell RPC-only、事务、并发与业务幂等。
- 商品新增/编辑、Variant 和库存初始化的事务一致性。
- CSV 整文件预验证、Job/Row 恢复、行事务、幂等和安全导出。
- 每客户 developer credential 初始化、轮换及旧 Cookie 失效。

后续阶段必须持续运行这些回归；一旦出现回归，按新的 P1 停止条件处理。

## 停止条件

发现新 P0/P1、migration 历史冲突、无法安全升级、CI/Preview/secret scan/reconciliation/清理失败，或任务需要修改生产/客户数据库、付费 API、不可逆删除或真实硬件操作时，停止自动推进并报告证据及最小解除步骤。
