# v1.0 发布就绪结论

更新时间：2026-07-18

发布分支：`codex/release-v1-production-readiness`

代码基线：`be3205fbe1a7626b9971a1c8f854b0206e7c754c`

## 结论先行

| 范围 | 状态 | 结论 |
| --- | --- | --- |
| Basic 模板 | `READY` | 前台、商品、图片、分类、供应商、尺码库存、库存事务、法律双语、权限和备份恢复均已通过本地、CI 或隔离 Preview 门禁。 |
| Standard 模板 | `CONDITIONAL` | 软件功能已通过；仍需在交付门店使用真实扫码枪、标签机、连续纸和小票打印机完成硬件验收。 |
| Advanced 模板 | `CONDITIONAL` | 继承 Standard 的硬件条件；Skroutz 官方 Validator、AI 限流/预算/隐私和维护备份边界已经通过。 |
| 当前既有 Production 实例 | `BLOCKED` | 这是部署环境阻断，不是隔离 Preview 或代码回归。修复前不得把当前线上地址描述为 v1.0 已上线。 |

`READY` 表示该模板可以按部署手册为新客户建立独立 Supabase/Vercel 项目。它不表示当前旧 Production 环境已经完成升级，也不代表未经测试的真实硬件已经通过。

## 已完成的发布证据

- 已确认 P0/P1：0 个未解决。
- 21 份 migration 从空库执行成功；`client-init.sql`、旧库升级 fixture 和重复执行安全检查通过。
- POS checkout/void、库存调整、Quick Sell、商品创建/编辑和 CSV 行级提交均使用事务 RPC，具备并发、幂等、故障注入和 fail-closed 测试。
- 全量单元、集成、安装路径、数据库安全、secret scan、typecheck 和 production build 通过，无 skipped 关键测试。
- 隔离 Preview 使用 `greek-clothing-store-test`（`krlhwwjkgoqzusehxuav`，`eu-west-3`）完成新客户演练：商品、图片、库存、POS、作废、CSV、法律发布、角色和 Feed 均通过。
- 隔离演练结束后再次执行远程空库 reset：21/21 migrations 匹配；商品、订单、后台账号、Auth 用户、开发者凭据、法律版本和测试 Storage 对象均为 0；`MAIN_STORE` 为 1；默认 Feature 版本为 `advanced`。
- 数据库 + Storage 备份恢复演练通过，最新完整复验低于 90 秒，低于 4 小时 RTO 目标。
- GitHub `master` 要求 PR、四项 required checks、分支最新和 conversation resolution；禁止 force push 和删除，required approvals 为 0，符合单维护者流程。
- Phase 6A 已通过官方 Skroutz Validator；Feed 使用 `MAIN_STORE` 权威库存并排除资料不完整、图片不足或测试商品。

## 当前 Production 只读检查

检查过程中没有执行 migration、写数据库、改环境变量、轮换密钥或触发 Production 部署。

| 检查项 | 实际结果 | 发布影响 |
| --- | --- | --- |
| Vercel Production | 最新部署为 Ready，但所有页面实际返回 HTTP 500 | `BLOCKED` |
| Vercel 日志 | `ADMIN_PASSWORD` 不符合新的应急密码策略，启动阶段以 `WEAK_PASSWORD` fail closed | `BLOCKED` |
| Production 环境变量 | 有 `USE_POS_RPC`，缺少 `USE_PRODUCT_RPC`、`USE_CSV_IMPORT_RPC`、`AUTH_RATE_LIMIT_SECRET` | 商品、CSV 和认证安全能力不能正式启用 |
| Production Supabase | 项目 `clothes store`，ref `rgkdyksyztqaupatiltz`，`eu-west-2` | 仅做只读识别 |
| migration history | 远程只有 4 个旧版本；当前 21 个本地版本均未登记为已应用 | 不得直接部署当前代码或猜测修复 history |
| RLS / grants / RPC | 因当前 migration 链未部署，不能视为已验证 | 必须先备份和设计旧库升级演练 |
| 域名 | 服装店项目只有 Vercel 默认 aliases；`wokdragon.gr` 属于另一个 Vercel 项目 | 不得误绑定或修改其他项目域名 |
| 监控 | Daily site monitor 已启用，但 2026-07-15 至 2026-07-18 连续失败，报告全部入口为 500 | 修复 Production 后必须手动重跑并转绿 |

## 解除当前 Production 阻断的最小顺序

1. 为 `rgkdyksyztqaupatiltz` 创建受保护的数据库 + Storage 备份，并在隔离项目验证可恢复。
2. 对照远程 4 个旧 migration 版本和当前 21 个版本制定一次旧库升级 fixture；不要直接运行 `client-init.sql`，也不要手工伪造 migration history。
3. 在 Vercel Production 配置新的、每客户唯一且符合策略的应急密码，或确认不需要后删除旧应急密码；配置唯一 `AUTH_RATE_LIMIT_SECRET`。
4. 数据库升级验证成功后设置 `USE_POS_RPC=true`、`USE_PRODUCT_RPC=true`、`USE_CSV_IMPORT_RPC=true`。
5. 确认 Production 的 Supabase URL、publishable key 和 service/secret key 属于同一项目，service/secret key 只存在于服务端。
6. 重新部署 Production，验证首页、后台、健康检查、角色、POS、库存、Storage、Feed、日志和 Daily site monitor。
7. 若要使用客户域名，再单独配置正确域名和 `NEXT_PUBLIC_SITE_URL`；不要改动 `wokdragon.gr` 所属项目。

这些步骤会修改 Production，必须获得维护者单独授权后执行。

## 发布决定

- 允许创建最终 Draft Release PR：**是**。
- 允许把当前 Production 描述为 v1.0 已上线：**否**。
- 允许未经授权修改 Production：**否**。
- `v1.0.0` 标签与 GitHub Release：在 Release PR、CI、隔离 Preview 和签核通过后创建；如果仍保留 Production 外部阻断，Release 必须明确标记“代码/模板发布，Production deployment not yet verified”。
