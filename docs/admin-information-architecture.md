# 后台六入口改造与验证

本轮仅调整后台导航、组件组合和显示文案。不修改数据库、RPC、服务端授权或 API 请求契约；仓库原有 Viva / BOX NOW 未提交改动保留，不属于本轮交付。

## 旧入口映射

| 新一级入口 | 旧入口及迁移方式 |
| --- | --- |
| 工作台 | 新增角色快捷操作与现有商品状态摘要；不展示技术诊断 |
| 扫码收银 | pos 原组件；库存查询中的「带入 POS」保留 |
| 到货入库 | stockOperations 固定 receiving；成功后进入「打印本次标签」 |
| 商品库存 → 商品 | dashboard 商品列表；quickAdd、add 改为顶部按钮；check 改为资料不完整/缺图/缺译文/无库存/已下架筛选 |
| 商品库存 → 库存 | stockLookup 快速查询 + inventory 总览；流水默认折叠，对账技术诊断仅 owner 可见 |
| 商品库存 → 盘点 | stockOperations 固定 stocktake，不展示到货或退货模式切换 |
| 订单售后 → 全部订单 | posOrders 与 onlineOrders 共用来源选择器；底层列表及 API 独立保留 |
| 订单售后 → 退货换货 | 原订单查询及处理指引；库存角色可进入固定 return 加回模式，不虚构退款功能 |
| 订单售后 → 日结 | posDaily 原报表；删除其重复横向导航 |
| 更多管理 → 商品设置 | categories、suppliers、csv、images |
| 更多管理 → 门店设置与标签 | labels 批量补打/打印参数、员工角色说明、开发者店铺资料入口 |
| 更多管理 → 系统管理 | 开发者功能开关及法律设置、既有备份工具说明、诊断、owner-only quickSale「库存紧急扣减」 |

商品行继续保留编辑、复制、上下架，并加入按商品定位的库存调整与打印标签。库存调整仍需选中具体规格，不能将商品总库存误当作单规格库存。

标签按 Variant 选择：商品上下文默认每规格一张；本次到货上下文累计成功入库增量，不使用总库存。失败不进入成功队列，重复操作 ID 不重复累计。队列为当前页面会话数据，刷新后可用批量补打恢复；不新增数据库标签历史。数量仍沿用原打印模块每规格最多 500 张的限制，大批量需分批打印。

## 角色可见菜单

以下为对应 Feature 全开时的桌面菜单；实际仍按原角色授权与 Feature 交集决定。

| 角色 | 一级入口 | 工作台快捷操作 |
| --- | --- | --- |
| owner | 工作台、扫码收银、到货入库、商品库存、订单售后、更多管理 | 扫码收银、新货入库、库存查询、拍照上新 |
| staff | 工作台、扫码收银、商品库存、订单售后 | 扫码收银、库存查询、在线订单、商品查询 |
| inventory | 工作台、到货入库、商品库存、订单售后、更多管理 | 新货入库、库存查询、标签补打 |
| readonly | 工作台、商品库存、订单售后 | 库存查询、商品查询、门店订单 |

inventory 的订单售后仅提供退货库存指引/加回，不因此获得订单读取权限；更多管理只保留可用的打印功能。系统管理仅 owner 可见；进货成本仍取 `procurement:cost` 权限。普通 owner 不获得开发者设置权限。

桌面 ≥1280px 使用左侧导航；平板/手机使用可 Escape 关闭、焦点回归的模态抽屉。沿用原项目限制，紧凑视口仍隐藏 POS、CSV、批量图片，不在本轮擅自开放。工作台快捷按钮按相同规则过滤。

## 修改文件

- `lib/admin-navigation.ts`：六入口模型、旧视图映射、角色快捷操作及员工技术错误展示。
- `components/admin-shell.tsx`、`admin-sidebar.tsx`、`workspace-page.tsx`、`admin-more-page.tsx`：新壳层。
- `components/admin-dashboard.tsx`：组合旧页面、上下文标签、角色默认工作台、订单来源选择、模式隔离。
- `components/online-orders-manager.tsx`：售后指引入口、诊断展示边界，不改订单 API。
- `tests/admin-navigation.test.ts`、`tests/operations-reporting.test.ts`：新增模型测试并更新已迁移文案断言，保留旧兼容测试。
- `scripts/admin-navigation-browser-test.mjs`、`scripts/operations-browser-test.mjs`：更新真实浏览器入口与权限/打印回归。
- `scripts/run-admin-ui-browser-tests.mjs`：只读本地设置模拟器、临时进程凭据及自动清理。
- `agents.md` 与本报告：记录壳层边界及维护工具实际能力。

## 验证命令与证据边界

1. `git diff --check`。
2. `npm run typecheck`。
3. `node --experimental-strip-types --test tests/*.test.ts`：255 项通过，0 失败，0 跳过。
4. `npm run build`。
5. `node scripts/run-admin-ui-browser-tests.mjs`：四角色 × 390/768/1440px；禁用 Feature；商品标签上下文；到货失败与重试 ID；本次标签数量；标签/小票预览和桌面 PDF 输出。

浏览器所有后台 API 被拦截，服务端设置只访问本地只读模拟器。测试断言导航不发业务写请求，模拟到货请求沿用原 payload 和幂等 ID。未对真实数据库执行交易，也未以 UI 测试替代真实权限/RPC/并发验收；本轮未部署。

## 仍复用的旧组件及未实现的新能力

- POS、库存作业、商品完整编辑/拍照上新、标签、分类、供应商、CSV、图片工具仍保留在原 dashboard 中，未大规模拆分业务逻辑。
- 在线订单继续使用 OnlineOrdersManager；全部来源视图是两个现有列表的界面组合，不是跨来源统一排序/分页 API。
- 日结仍是现有门店 POS 日报，不暗示已汇总线上收入。
- 旧 check 明细代码和旧导航辅助函数保留兼容；普通入口使用商品筛选。原批量 AI 补全通过缺资料/缺译文筛选后的按钮继续可达。
- 员工管理、完整备份恢复沿用维护者工具；未新增浏览器凭据管理或恢复接口。
- 没有开发新的退货单、换货单、退款支付、持久化标签历史或新到货单。

React 复核重点是派生导航不复制授权、抽屉事件清理、异步标签加载失败不报告成功，以及沿用库存操作 ID；不对旧 dashboard 做无关重构。
