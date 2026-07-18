# v1 阶段 6B 隔离 Preview 验收报告

日期：2026-07-18

结论：**Phase 6B application behavior, isolated Preview data, reporting capacity, printing layouts, reconciliation, audit, barcode, and recovery controls are verified. Production and real hardware are not verified.**

## 环境身份

| 项目 | 证据 |
|---|---|
| PR | [#10 Harden operations reporting, printing, and recovery](https://github.com/ylc77/greek-clothing-store/pull/10) |
| 功能验收 HEAD | `5795c2f79571ec0e54052e63bd7f048e432deec0` |
| Preview URL | `https://greek-clothing-store-ej6zgm59g-ylc77s-projects.vercel.app` |
| Deployment ID | `dpl_4c7KoxduHBf16avCybA8iEHfxrpH` |
| 隔离 Supabase | `greek-clothing-store-test` / `krlhwwjkgoqzusehxuav` |
| Region | `eu-west-3` |
| Migration | 21 份，远程 reset 后 local/remote history 完全一致 |
| Preview 环境变量范围 | 仅 6B 分支 Preview；隔离 Supabase URL/公开 key/服务端 key、站点 URL 和三个 `USE_*_RPC=true`。本报告不记录任何秘密值 |

开始写入前确认 Preview 只连接上述隔离测试项目，不连接客户或 Production Supabase。测试数据全部使用 `AUDIT_6B_PREVIEW` 前缀。

## 业务验收结果

### 角色、权限与 Feature

- owner、staff、inventory、readonly 使用真实 Supabase Auth 会话完成页面和直接 API 矩阵。
- 未认证、角色不足、Feature 关闭和运行能力缺失分别保持 401、403、403/`FEATURE_DISABLED` 和 503；拒绝请求没有业务写入。
- Basic、Standard、Advanced 三档逐一切换并检查桌面/移动入口和直接 API；验收后恢复 `advanced`。
- developer-only 设置不由 owner 或员工角色继承。

### 报表、分页与容量

- 创建 1,005 张测试订单以及对应的明细、付款和 sale movement。
- POS 订单列表、日报和搜索使用数据库分页/聚合，首页、尾页和超过 1,000 条的结果均可访问，没有旧的 500/1,000 行静默截断。
- 雅典时区、冬夏令时和午夜边界已由本地具名测试覆盖；Preview 显示使用 `Europe/Athens` 结果。
- 390px、768px、1440px 后台无阻断错误或横向溢出。

### 对账、审计与条码

- 人为制造付款不一致后，reconciliation 能检出；修复 fixture 后恢复为 0。
- 订单、付款、sale/void movement 按订单和 Variant 核对，不以单条流水代替整单完整性。
- owner/staff/inventory/developer/system 操作者信息包含 user ID、role 和 auth type；审计表保持 append-only，普通角色和 service role 均不能更新或删除。
- 条码分配验证唯一性、相同 operation ID 重放、并发冲突和已有历史引用保护。

### 标签和小票

- 标签页显示商品图片、一级/二级分类选择、尺码 Variant、实际库存份数、价格和 Variant 条码。
- 40×30mm 标签分页与 Greek/English 店铺配置驱动文案通过。
- 80mm 和 58mm 小票均显示希腊语店铺文案、付款信息、操作人和“不是正式税务票据”说明。
- 在修复长 operation/actor 标识换行后，精确 Preview 的 58mm 纸张宽约 219px，`scrollWidth === clientWidth`；80mm 同样为 0 溢出。

## 备份与恢复证据

- 可信维护者 CLI 会生成 role/schema/data/migration-history 四份数据库文件、全部 Storage 对象和 SHA-256 manifest。
- 本地以及 Ubuntu GitHub CI 均执行真实的“源库备份 → 第二套空白 Supabase → 数据库和 Storage 恢复 → migration history、应用 fixture 和对象字节校验”。最近一次本地演练为 82.3 秒，低于 4 小时 RTO；当前设计 RPO 为最近一次成功备份。
- Preview 验收数据在清理前完成分页读回：1 个商品、4 个 Variant、1,005 张订单、1,005 条明细、1,005 笔付款、1,006 条阶段 movement、4 个余额和 1 个 Storage 对象；数据库快照与 Storage 对象分别生成 SHA-256 并通过完整性校验。
- 商品 CSV 导出仍明确不是数据库或 Storage 灾备。

## GitHub CI、Supabase Advisors 与日志

- exact-head CI 的静态质量、单元测试、安装路径和本地 Supabase 集成门禁必须在合并前全部为绿色；报告提交后的最终 HEAD 会重新执行四项 required jobs。
- Supabase Security Advisor：0 errors；1 warning 为测试项目 Auth 的 leaked-password protection 未启用。该项不表示数据库越权，但保留为正式客户 Auth 配置检查。
- Supabase Performance Advisor：0 errors、0 warnings。
- 精确 Preview Vercel runtime：34 个 200、2 个 204、2 个验收预期 400；0 个 5xx，error/fatal 日志为 0。
- 源码、migration、文档、测试、`client-init.sql` 和浏览器 bundle 的 secret scan 由 required CI 执行；报告不包含密码、Token、service/secret key 或连接字符串。

## 数据与秘密清理

由于 `audit_logs` 按设计连 service role 也不可删除，验收结束使用维护者明确授权的远程测试库 reset，而不是削弱 append-only 边界。`npx supabase db reset --linked --no-seed --yes` 成功从 baseline 顺序执行 21 份 migration；随后 `npx supabase migration list --linked` 证明 local/remote history 完全一致。

最终只读核对：

| 集合 | 残留 |
|---|---:|
| `products` / `product_variants` | 0 / 0 |
| `sales_orders` / `sales_order_items` / `payments` | 0 / 0 / 0 |
| `inventory_balances` / `inventory_operations` / `stock_movements` | 0 / 0 / 0 |
| `audit_logs` / `barcode_operations` | 0 / 0 |
| product/import/delete/Storage operation records | 0 |
| `admin_users` / Supabase Auth users | 0 / 0 |
| `developer_access` | 0 |
| Storage 对象 | 0 |

`product-images` bucket 仍存在，Feature plan 为 `advanced`。临时 fixture SQL 已从工作区删除。分支 Preview 环境变量和测试 Secret Key 在 PR 合并、无需复现后撤销或轮换。

## 外部门禁与发布判定

本阶段没有修改或验证 Production。以下真实硬件仍未验收：

- USB/蓝牙扫码枪
- 标签打印机和 40×30mm 连续纸偏移
- 58/80mm 小票打印机
- 条码离线解码

因此 6B 允许在 exact-head CI 全绿后合并；Basic 可进入最终发布门禁，Standard/Advanced 在真实硬件验收前必须保持 `CONDITIONAL`，不能描述为正式硬件交付已通过。

## 回滚

应用问题优先回滚对应 commit 或 merge commit。已进入 migration history 的数据库变更不做破坏性降级，使用前向 migration 修复。备份恢复 CLI 默认拒绝覆盖非空目标，执行前要求 project ref 明确确认并校验 manifest。
