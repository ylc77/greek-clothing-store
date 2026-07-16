# v1 阶段 5C 本地验证报告

日期：2026-07-16

分支：`codex/hardening-p2-ai-auth-abuse`

基线：`23dd67b1b93cc3fadbab8842fcf470ae1bf36b79`
结论：**Local integration verified. GitHub CI, isolated Preview, and Production are not yet verified.**

## 已关闭或本地验证的风险

| 风险 | 本地结论 | 主要证据 |
|---|---|---|
| 5C-01 AI 多实例限流/预算/并发 | 已修复 | 共享 PostgreSQL RPC 按 IP、会话、店铺和全局分钟计数，并执行每日预算、并发 lease、过期回收和 operation ID 重放；服务重启后限制仍生效。 |
| 5C-02 AI 输入、上游和隐私边界 | 已修复 | 明确 consent、16 KiB 请求、800 字符消息、测量范围、60 KiB 服务端商品上下文、64 KiB 上游输出、允许 SKU 约束和 1–30 秒超时全部通过动态测试；日志扫描无测量值。 |
| 5C-03 环境密码防爆破 | 已修复 | 可选紧急密码必须至少 20 位并含字母/数字/符号；重复角色值使启动失败；timing-safe 比较和数据库共享失败窗口/封禁通过多实例及重启测试。 |
| 5C-04 员工 Token 生命周期 | 本地通过，Preview 待复验 | 初始 Supabase Auth session 恢复、刷新 Token 更新、失效 Token 清除、本地 sign-out 和 API 拒绝均通过；还需 Preview 真实浏览器证据。 |
| 5C-05 状态码语义 | 已修复 | 未认证 401、已认证无权 403、Feature 关闭 403/`FEATURE_DISABLED`、共享安全能力不可用 503、限流 429；拒绝路径无业务写入。 |

## 数据库与安全结构

- 新 migration：`20260716170000_ai_auth_abuse_protection.sql`。
- 私有表：`security_rate_limit_buckets`、`ai_usage_daily`、`ai_request_leases`、`security_auth_limits`。
- 所有表启用 RLS、无 anon/authenticated policy、公开角色无 DML；仅 service role 维护。
- 四个安全 RPC 使用 `SECURITY DEFINER`、空 `search_path`、显式 revoke/grant。
- 管理员邮箱升级会先 lower/trim；大小写冲突会明确停止并回滚，不会覆盖或合并账号。
- `supabase/client-init.sql` 已由 18 份有序 migration 重新生成。

## 专项测试结果

| 门禁 | 结果 |
|---|---|
| `npm ci` / `npm audit` | 通过；0 vulnerabilities。 |
| 5C 单元测试 | 15/15 通过。 |
| 5C 集成测试 | 10/10 通过，包含 consent、服务端商品上下文、代理 IP、多实例/重启限流、预算/并发、超时/异常/超长输出、Developer 登录、角色状态码、Token 生命周期和 PII 日志。 |
| 数据库安全门禁 | RLS、grants、RPC search path、共享计数、预算、并发、重放和容量清理全部通过。 |
| 安装路径 | 4/4：migration 空库、client-init 空库、唯一旧邮箱升级、大小写重复旧邮箱安全停止。 |
| 既有业务回归 | POS 18/18、库存 22/22、Developer 12/12、Feature 5/5、商品 39/39、CSV DB 21/21、CSV Route 7/7、公开数据 7/7、Storage 8/8。 |
| 全量总计 | 113/113 单元测试、149/149 集成测试、22/22 安装路径断言通过。 |
| `npm run typecheck` / `npm run build` | 通过。 |
| `git diff --check` | 通过（仅 Git 的 LF/CRLF 工作区提示）。 |
| 本地空库 reset | 18 份 migration 顺序执行通过。 |
| Database advisors | 0 项。 |
| Secret scan | 通过；扫描 326 个源码、migration、文档、测试、快照和浏览器 Bundle 文件。 |
| 测试数据清理 | 最终空库核对 21 个业务、认证、AI 限流、恢复和 Storage 对象集合，残留均为 0。 |

## 安全运行约束

- `AUTH_RATE_LIMIT_SECRET` 是每客户唯一的至少 32 字符服务端随机值。
- AI 限流数据库不可用时返回 503，不回退进程内 `Map`。
- 登录共享限流不可用时紧急密码和 Developer 登录均 fail closed。
- 身体测量数据仅在用户明确同意后的单次请求中使用，不持久化、不写日志。
- 浏览器只提交 SKU；完整商品上下文由服务端公开字段重建，模型不能推荐未授权 SKU。
- DeepSeek/OpenAI/service role/限流密钥均不进入浏览器 Bundle。

## 尚未完成的阶段门禁

1. 完成最终全量本地门禁和 secret scan 后创建不可移动 local 标签。
2. 推送独立分支并创建 Draft PR。
3. GitHub 四个 required jobs 在 Ubuntu Runner 全绿。
4. 使用一对一隔离 Supabase/Vercel Preview 复验 consent、限流、登录封禁、Token 刷新/登出、角色状态码和三种视口。
   分支环境变量变更后必须由新的 Git deployment 验收；旧 deployment 的 Redeploy 可能继续使用原环境快照。
5. Preview 测试数据、临时账号、Cookie、环境变量和部署快照凭据清理为零。
6. 完成单人维护者签核、CI/Preview 标签和 merge commit。

这些证据完成前，5C 不能描述为 Preview、Production 或最终发布已通过，也不能开始 6A。
