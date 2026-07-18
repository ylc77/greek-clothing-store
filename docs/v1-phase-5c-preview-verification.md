# v1 阶段 5C 隔离 Preview 验收报告

日期：2026-07-17

结论：**Local integration, exact-HEAD GitHub CI, and isolated Vercel Preview acceptance verified. Production deployment is not verified.**

## 环境身份

| 项目 | 证据 |
|---|---|
| PR | [#8 Harden AI abuse controls and admin authentication](https://github.com/ylc77/greek-clothing-store/pull/8) |
| 功能验收 HEAD | `ce5c6993d5894117eec5e95b36a692977f545820` |
| Preview URL | `https://greek-clothing-store-mz3l4dj02-ylc77s-projects.vercel.app` |
| Deployment ID | `dpl_9cCawhuhM1M8gXsuegBMF2UxpFqd` |
| 隔离 Supabase | `greek-clothing-store-test` / `krlhwwjkgoqzusehxuav` |
| Region | `eu-west-3` |
| Migration | 18 份顺序执行 |
| Preview 环境变量范围 | 仅 PR 分支 Preview；包含隔离 Supabase URL/公开 key/服务端 key、`AUTH_RATE_LIMIT_SECRET`、`NEXT_PUBLIC_SITE_URL` 和三个 `USE_*_RPC=true`，报告不记录任何秘密值 |

验收前通过部署身份、公开 Supabase URL 和服务端访问测试确认 Preview 与上述隔离项目一一对应。未连接 Production 或客户 Supabase；隔离项目开始时没有真实商品、订单、员工、图片或凭据。

## 自动化业务验收

隔离 Preview 验收共 **8/8 通过**：

1. 精确 Preview、隔离项目和 18-migration 数据库身份。
2. Runtime health、RLS、RPC execute 和 service-role-only 表边界。
3. 服务端权威公开商品投影；浏览器提交字段不能扩大 AI 商品上下文。
4. owner、staff、inventory、readonly 的真实认证和直接 API 权限矩阵。
5. 员工 Token 刷新、服务器授权上下文更新和本地 `signOut()` 生命周期。
6. AI Feature、明确 consent、本地可回答路径和供应商不可用时 fail closed。
7. AI operation ID 重放、共享并发 lease、分钟/日预算与限制边界。
8. Developer 共享登录限制、HttpOnly/Strict Cookie、凭据轮换和全部旧会话立即失效。

拒绝路径按统一矩阵返回：未认证 401、已认证无权限 403、Feature 关闭 403/`FEATURE_DISABLED`、限流 429、安全能力不可用 503。拒绝请求未产生业务写入。

## GitHub CI 与部署

功能验收 HEAD 的四项 required jobs 全绿：

- Static quality and dependency audit
- P1 unit tests
- Local Supabase integration and security
- Clean, client-init, and legacy upgrade paths

Vercel deployment 状态为 `Ready`，目标为 `preview`。生产环境没有在本阶段部署或验证。

## 浏览器与日志

在精确 Preview 检查：

- 390px：希腊语前台和中文后台登录页，无横向溢出。
- 768px：后台页面无横向溢出。
- 1440px：希腊语前台、Cookie 提示和后台页面布局正常。
- 浏览器没有阻断控制台错误、hydration 错误或 401/403 循环。

Vercel Functions 日志抽查 100 条请求；状态包含预期的 200、400、401、403、429 和 503 负向用例。密码、Token、service/secret key、Cookie、身体测量值和完整敏感请求体模式匹配均为 0。

## 数据与秘密清理

验收脚本在 `finally` 中清理所有阶段 fixture。最终只读核对：

| 集合 | 残留 |
|---|---:|
| `products` | 0 |
| 测试 `admin_users` | 0 |
| `developer_access` | 0 |
| `security_rate_limit_buckets` | 0 |
| `security_auth_limits` | 0 |
| `ai_usage_daily` | 0 |
| `ai_request_leases` | 0 |
| 阶段 Storage 对象 | 0 |

验收中撤销过的旧测试 Secret Key 保持失效；未在仓库、报告、PR、浏览器存储或日志中记录新秘密值。分支 Preview 环境变量与最终测试 key 在 PR 合并和不再需要复现后统一撤销，避免提前破坏当前可复验部署。

## 未验证与后续阶段

- 未验证 Production，也未修改任何客户或生产 Supabase。
- 未使用收费 AI Key；供应商不可用路径按 503 fail closed 验收。
- 真实扫码枪、标签机和小票打印属于 6B 外部门禁。
- Skroutz Feed、SEO、法律双语、安全响应头和可访问性属于 6A；当前生产 Daily site monitor 的空 Feed 失败不属于 5C。

## 合并判定与回滚

5C 没有发现新的 P0/P1，允许完成单人维护者签核、不可移动 CI/Preview 标签并以 merge commit 合并 PR #8。若回滚，优先回滚应用提交；数据库 migration 采用前向修复，不删除已经进入 migration history 的安全表或约束。
