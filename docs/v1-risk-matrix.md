# v1.0 剩余风险矩阵

初始审查基线：`origin/master` at `49aeb93afd1ea08e41c692af9acbddb6b169a10a`
当前 6A 工作基线：`origin/master` at `b30e3efd5b8c2fc0b24a89835fc4988c1d14a9a6`
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
| 5B-01 | 5B | P2 | 已修复并通过 Preview | Store Settings 上传在 Sharp 失败时回退保存原文件，且没有统一 magic-byte、像素和尺寸上限；动态伪造 MIME fixture 证实原路径会接受不可信声明。 | 本地与隔离 Preview 均证明合法 JPEG/PNG/WebP 会重新编码为 WebP；伪造 MIME、异常尺寸、超大文件和损坏图片被拒绝且无对象残留。 |
| 5B-02 | 5B | P2 | 已修复并通过 Preview | 商品、店铺和分类图片原先先写 Storage 再分步更新数据库引用；故障注入证实数据库更新失败会留下孤儿，反向删除失败会留下悬空引用。 | 本地故障注入和 Preview 替换/删除验证均通过；旧对象被清除，引用与对象一致，最终 operation/orphan/Storage 残留均为 0。 |
| 5B-03 | 5B | P2 | 已修复并通过 CI | AI 模特图服务端对浏览器提供的 URL 直接 `fetch`，只做 URL 字符串检查，没有 DNS、重定向、私网和流式体积边界。 | exact-origin、Storage 路径、IPv4/IPv6、重定向、DNS rebinding、DNS timeout、metadata/private/link-local、Content-Type/Length/stream 自动化测试全部通过。 |
| 5B-04 | 5B | P2 | 已修复并通过 Preview | 原永久删除只检查部分库存流水，先删数据库再 best-effort 删除对象；订单、库存操作、导入引用、非零余额和失败恢复均未完整保护。 | Preview 证明安全无历史商品与对象可完整删除，有库存历史商品返回阻断；本地故障注入证明 Storage 失败可恢复、可对账。 |
| 5C-01 | 5C | P2 | 已修复并通过本地、CI、Preview 验证 | 公共 AI 限流位于进程内 `Map`，多实例和冷启动可绕过；缺少共享分钟/日预算及全局并发边界。 | 数据库共享 IP/会话/店铺/全局分钟、每日预算、并发 lease 和重放测试通过；隔离 Preview 的限流、预算、重放和并发行为通过。 |
| 5C-02 | 5C | P2 | 已修复并通过本地、CI、Preview 验证 | 动态验证确认原 AI 路径缺少完整的上游超时、输出大小、允许 SKU 二次约束和身体数据同意边界。 | 超时、异常 JSON、超长输入/输出、并发、PII 日志扫描、服务端公开商品投影和允许 SKU 测试通过；Preview 日志未发现测量值或秘密。 |
| 5C-03 | 5C | P2 | 已修复并通过本地、CI、Preview 验证 | 环境管理员密码认证仍以环境变量为主，需要 timing-safe 比较、弱密码/重复角色密码启动检查和共享限流。 | 多实例爆破、重启后限流、弱密码启动失败、重复角色密码失败、timing-safe 测试及隔离 Preview Developer 登录/轮换通过。 |
| 5C-04 | 5C | P2 | 已修复并通过本地、CI、Preview 验证 | 员工 Supabase Token 刷新、`onAuthStateChange` 和真正 `signOut()` 生命周期尚未形成完整浏览器回归。 | 本地生命周期测试及隔离 Preview 真实 Supabase Auth 会话证明刷新后 Token 更新、登出后 UI/API 同时失效。 |
| 5C-05 | 5C | P3 | 已修复并通过本地、CI、Preview 验证 | Issue #3：部分“已认证但无权”响应使用 401，语义不一致但当前能够拒绝写入。 | 本地与 Preview Route 权限矩阵证明未认证 401、无权 403、Feature 关闭 403/`FEATURE_DISABLED`、能力不可用 503，且拒绝请求无业务写入。 |
| 6A-01 | 6A | P2 | 代码已修复并通过本地；Preview Validator/监控待验 | 线上 `feed.xml` 当前 HTTP 200 但 `<products>` 为空，Daily site monitor #15 因“Feed 没有商品”失败；Feed 仍需官方规则和容量验收。 | 单元测试已证明权威余额、预留扣除、严格字段/图片/尺码门禁和 1,005 商品分页；严格监控已加入 CI。仍需隔离 Preview 可售 fixture、官方 Validator 和 live monitor。 |
| 6A-02 | 6A | P2 | 已修复并通过本地 | 当前语言主要依赖查询参数和 hydration 前脚本设置 `lang`，原始 HTML 的 canonical/hreflang/语言 URL 不完整。 | Greek 默认和 `?lang=en` 的首页、联系页及全部法律页原始 HTML `lang`、canonical、reciprocal hreflang、x-default 与 sitemap 测试通过。 |
| 6A-03 | 6A | P2 | 已确认并修复，通过本地 | Legal Settings 的 GR/EN 独立内容、发布完整性、Cookie/AI 身体数据/第三方服务说明原先不足。 | 双语独立归一化和必填测试、事务发布并发/回滚/权限测试、Privacy/Cookie/Terms 等页面原始 HTML 测试通过；仍需 Preview 发布和呈现复验。 |
| 6A-04 | 6A | P2 | 已确认并修复，通过本地 | 安全响应头、后台 noindex、表单 label/aria 与键盘访问原先未按全站矩阵验证，并发现对比度/标签缺口。 | CSP nonce、安全头、robots/noindex、390/768/1440 serious/critical axe、横向溢出和后台键盘登录测试通过；已加入 GitHub CI。 |
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
