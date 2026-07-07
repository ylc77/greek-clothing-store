# 客户版本功能开关验收清单

## 1. 安全边界

- 本清单用于 Feature-E 测试，不自动执行 migration。
- 首次验证应在测试 Supabase 项目或本地测试库进行。
- 在 production 切换版本前暂停后台商品、库存、CSV 和 POS 操作。
- 切换版本只改变功能可用性，不应删除商品、订单、库存流水或 Barcode。
- `USE_POS_RPC` 和 `USE_VARIANT_INVENTORY` 不属于客户版本功能，不在本轮切换。

## 2. 执行前

- [ ] `npm run typecheck` 通过。
- [ ] `npm run build` 通过。
- [ ] `git diff --check` 通过。
- [ ] 已确认目标 Supabase 项目不是其他项目。
- [ ] 已备份测试库或确认测试数据可重建。
- [ ] 当前功能配置和环境变量已记录。

## 3. Migration 验证

在测试库执行：

`supabase/migrations/20260707000100_add_feature_settings.sql`

然后运行：

`supabase/feature-settings-readonly-checks.sql`

通过标准：

- [ ] `feature_settings` 只有一行，`id = 1`。
- [ ] 默认 `plan = advanced`。
- [ ] 14 个功能键都存在且值为 boolean。
- [ ] RLS 已启用。
- [ ] 没有公开 policy。
- [ ] anon/authenticated 没有表权限。
- [ ] service_role 有 select/insert/update/delete。

## 4. 通用认证检查

- [ ] 未登录访问 `/api/admin/features` 返回 401。
- [ ] 未登录访问库存、POS、商品 API 返回 401，而不是 403。
- [ ] owner 可以读取和保存版本配置。
- [ ] 非 owner 员工可以读取功能状态用于菜单过滤。
- [ ] 非 owner 员工不能保存版本配置。
- [ ] 功能关闭后，已登录请求返回 403、`code = FEATURE_DISABLED`。

## 5. Basic 验收

在店铺设置选择“基础版”并保存。

应保留：

- [ ] 前台首页、分类页和商品详情页正常。
- [ ] 后台商品列表、新增编辑、图片和分类入口正常。
- [ ] 店铺设置和法律页面正常。

应隐藏或拒绝：

- [ ] 库存管理和快速售出入口隐藏。
- [ ] POS 收银、订单和日报入口隐藏。
- [ ] 标签打印入口隐藏。
- [ ] CSV 导入入口隐藏。
- [ ] Skroutz Feed 入口隐藏，`/feed.xml` 返回 404。
- [ ] AI 操作入口隐藏，公开 AI 客服返回 404。
- [ ] 备份按钮隐藏。
- [ ] 直接调用以上后台 API 返回 403。

数据检查：

- [ ] 原有订单数量不变。
- [ ] 原有库存和流水数量不变。
- [ ] 原有 Barcode 不变。

## 6. Standard 验收

在店铺设置选择“标准版”并保存。

应启用：

- [ ] 商品管理。
- [ ] ERP 库存、调整、流水和对账。
- [ ] POS 收银、订单历史和日报。
- [ ] 小票预览和浏览器打印。
- [ ] Barcode 和标签打印。
- [ ] CSV 导入。
- [ ] Skroutz Feed。
- [ ] 员工账号权限仍生效。

应关闭：

- [ ] POS 作废按钮不显示，void API 返回 403。
- [ ] AI 生成接口返回 403，公开 AI 客服返回 404。
- [ ] 备份按钮不显示，备份 API 返回 403。

## 7. Advanced 验收

在店铺设置选择“高级版”并保存。

- [ ] 所有当前稳定后台入口恢复显示。
- [ ] POS checkout dryRun 正常。
- [ ] POS 订单、作废和日报 API 正常。
- [ ] ERP 库存接口正常。
- [ ] Barcode、CSV、AI 和备份接口正常。
- [ ] `/feed.xml` 正常返回 XML。
- [ ] 员工角色仍不能越过原有 `AdminPermission`。

本轮不应执行真实 production checkout、void 或库存调整；如需写入验收，必须使用测试 SKU 和测试项目。

## 8. Custom 验收

- [ ] 手动切换任意开关后版本显示为“自定义”。
- [ ] 保存并刷新页面后开关状态保持一致。
- [ ] 关闭某模块不会删除历史数据。
- [ ] 重新开启模块后历史数据仍可查看。
- [ ] 技术开关 `USE_POS_RPC`、`USE_VARIANT_INVENTORY` 未出现在页面。

建议避免无意义组合：

- POS 作废需要同时开启 POS 订单。
- 小票打印需要同时开启 POS 订单或 POS 收银。
- POS 日报需要 POS 订单数据。
- Barcode 标签依赖商品管理和 ERP variant 数据。

## 9. 页面 Smoke

每次版本切换后检查：

- [ ] `/`
- [ ] 一个分类页
- [ ] 一个商品详情页
- [ ] `/admin`
- [ ] `/admin/settings`
- [ ] `/feed.xml`，按版本预期为 XML 或 404
- [ ] `/sitemap.xml`

## 10. 回滚

出现问题时：

1. 不删除 `feature_settings` 表和历史业务数据。
2. 将版本切回 `advanced` 并保存。
3. 如果设置页不可用，用经过审核的 SQL 只更新 `id = 1` 的配置行。
4. 清除部署缓存或重新部署。
5. 重新运行页面 smoke、ERP 对账和 POS health check。

## 11. Production 启用条件

只有以下项目全部通过后才能在 production 使用版本开关：

- [ ] 测试库 migration 和只读检查通过。
- [ ] Basic、Standard、Advanced 三档菜单和 API 行为通过。
- [ ] 关闭和重新开启模块不会丢失数据。
- [ ] 未授权 401 和功能禁用 403 边界正确。
- [ ] ERP 对账为 0。
- [ ] POS runtime health check 为 0。
- [ ] 已记录 production 当前版本和回滚方式。
