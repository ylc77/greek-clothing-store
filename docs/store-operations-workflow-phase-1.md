# 门店连续工作流：Phase 0 / Phase 1

## 范围与基线

- 分支：`feat/store-operations-workflow`，基于 master `94c1827`。
- 原工作目录存在未提交的支付/配送及导航改动，因此使用独立 worktree，未重置或覆盖原文件。只迁入与本阶段相关的导航壳层，未包含 Viva/BOX NOW 改动。
- 已读取 agents.md、后台、导航、颜色尺码编辑器、标签预览、到货策略、库存/条码/POS Routes、认证及用户/打印指南。
- 初始 `npm ci`、typecheck、build 通过。最初 inventory / POS / barcode / operations 的单元部分通过，数据库部分因 Docker 引擎未运行失败，未跳过断言。
- npm ci 的依赖审计报告已有 2 项：browserslist high、postcss-selector-parser low。此次不做依赖升级，不能据此宣称发布安全审计全绿。
- Docker 恢复后仅启动原有 `clothing_web` 本地容器（API 55321 / DB 55322），没有 reset、没有清空数据库、没有连接远程客户库。集成测试使用原脚本的隔离测试记录、故障注入及清理机制。

## 调用关系（未改事务/权限）

1. 商品新增/拍照上新 → 现有 product POST/PUT → 原 product RPC → 服务端最终 product/variants → 标签队列。没有最终 variants 时读取已有库存接口并严格按服务端商品 ID 过滤；没有 ID 时拒绝猜测。
2. 缺失 Barcode → 原 generate-barcodes Route → labels:write + barcode_labels → 原批量服务/RPC；每批最多 100 个服务端 Variant ID，稳定派生业务 ID；逐项验证最终条码，绝不覆盖已有条码。
3. 到货 → 原库存 adjust Route → inventory:write + inventory Feature → inventory_apply_rpc → 成功后按本次 quantity 排队。同一 operation ID 在队列内去重，包括清空后的重放。
4. POS 扫码 → useBarcodeScanner → 原 pos/search Route/RPC → 精确 Barcode 唯一匹配自动加入。其他结果人工核对。购物车不写库存。
5. 结账 → 现有 dryRun → clientRequestId → pos_checkout_rpc。作废仍走原 void RPC。没有修改 API payload、预留库存校验、幂等、库存流水或 legacy 投影。
6. 队列 → LabelPrintPreview → 浏览器打印。没有设备 API、静默打印、财政票据或支付调用。

## 导航映射与角色

| 旧能力 | 新入口 |
| --- | --- |
| 常用操作 | 工作台，按角色显示高频操作 |
| pos | 扫码收银 |
| stockOperations receiving | 到货入库 |
| dashboard / quickAdd / add / check | 商品库存 → 商品，顶部按钮/资料筛选 |
| stockLookup / inventory | 商品库存 → 库存，流水次级展开 |
| stockOperations stocktake | 商品库存 → 盘点 |
| posOrders / onlineOrders | 订单售后 → 全部订单，来源筛选 |
| posDaily | 订单售后 → 日结 |
| return | 订单售后中的原库存加回指引，不是新退款事务 |
| labels | 上下文标签队列、商品行打印、更多管理补打 |
| quickSale | owner 更多管理 → 库存紧急扣减（不创建销售单） |
| categories / suppliers / csv / images | 更多管理的折叠分组 |

Advanced 档桌面：owner 6 个入口；staff 工作台/扫码收银/商品库存/订单售后；inventory 工作台/到货入库/商品库存/订单售后/更多管理；readonly 工作台/商品库存/订单售后。所有入口继续受原权限与 Feature 过滤。

owner 默认工作台，staff 默认 POS，inventory 默认到货，readonly 默认工作台。沿用小屏隐藏 POS/CSV/批量图片的原限制，小屏 staff 回工作台。普通员工不显示系统诊断，采购成本继续按原权限控制。开发者设置没有改成 owner 权限。

## 实现模块

- `lib/admin-navigation.ts`：六个一级入口、旧功能映射、角色首页。
- `components/admin-shell.tsx` / `admin-sidebar.tsx` / `workspace-page.tsx` / `admin-more-page.tsx`：壳层和高频入口。
- `lib/barcode-scanner.ts` / `hooks/use-barcode-scanner.ts`：快速字符识别、Enter 完成、串行处理、激活/卸载时中止未完成搜索、焦点恢复。
- `lib/operation-label-queue.ts` / `hooks/use-operation-label-queue.ts` / `components/operation-label-queue.tsx`：来源、数量、同规格合并、业务 ID 去重、编辑/移除/清空、刷新前提醒。
- `components/admin-dashboard.tsx`：调用上述模块，保留原业务组件和受保护请求；未一次性拆解大组件。
- `components/label-print-preview.tsx`：PT-1509 Profile 提示、校准页、渲染完成后才允许打印。
- 用户指南、打印硬件日志、Phase E 说明以及导航/操作自动化测试同步更新。
- 测试隔离：`next.config.ts`、测试启动脚本、`.gitignore`；仅测试子进程指定隔离目录，正常构建仍是 `.next`。

## 操作前后

之前：多个入口切换 → 自行查找规格 → 手工维护标签份数 → 到 POS 再搜索。

现在：工作台进入到货/上新 → 成功后显示本次标签队列 → 核对份数并打印 → POS 连续扫描 → 原事务结账。

首次 S=2 / M=3 共 5 张；已有库存 20 补货 3，仅增加 3 张。商品编辑补打每个提交规格默认一张，不把整份现有库存重印。队列不持久化到数据库，浏览器刷新前提醒；关闭打印窗口不自动清队列。

## 自动化与实物边界

单元覆盖：快速字符缓冲/Enter、慢速输入与过短/超长输入、同码重复、队列合并/重放/清空/编辑、首次数量与补货增加量、角色默认页和隐藏紧急扣减。

浏览器模拟覆盖：390/768/1440 三个视口 × 四角色、功能关闭、次级页签上限、成本/诊断隐藏、页面无溢出、上下文标签、失败不排队、重试原 ID、精确扫码自动加入、连续扫码加量、无匹配后焦点恢复、慢速输入不自动触发、三种视口标签/小票预览。模拟接口不写真实数据库。

最终本地结果：

| 命令/检查 | 实际结果 |
| --- | --- |
| npm ci | 通过；附带上述 2 项依赖审计告警 |
| npm run typecheck | 通过 |
| npm run test:admin-navigation | 7/7 通过 |
| npm run test:inventory | 12 单元 + 22/22 集成通过；包含并发、预留、故障回滚、角色、RPC 不可用 |
| npm run test:pos | 5 单元 + 18/18 集成通过；包含 checkout/void 并发、幂等、故障注入 |
| npm run test:barcode | 7 单元通过；批量并发/幂等/现有条码保护通过，清理残留为零 |
| npm run test:operations | 25/25 单元、6 组数据库集成、32 份 migration 静态一致性与数据库安全检查通过 |
| npm run test:store-workflow-browser | 12 角色/视口组合 + 功能关闭 + 标签上下文/重试 + 扫码场景 + 3 视口打印预览通过；模拟数据库写入计数为零 |
| npm run build | 通过（Next.js 15.5.21） |
| git diff --check | 通过 |
| npm run test:developer-secrets | 462 个源码、migration、文档、测试、snapshot 和浏览器 bundle 文件扫描通过 |

真实 PT-1509、真实扫码枪、远程 Preview 业务验收与 Production 均未被上述测试证明。曾失败的环境测试记录保留在下节，不将它们改写为首次即通过。

## 已发现并处理的测试环境问题

最初同时启动两个同目录 Next dev，出现 404；随后串行运行发现模拟 UI 的 Basic 缓存污染真实本地库存测试，返回员工 Feature 关闭。没有放宽权限；改为独立 `.next-admin-ui` / `.next-inventory-test` 后库存 22/22 通过。生成缓存的删除尝试被执行策略拒绝，未删除；隔离方案不需要删除原缓存。

## 尚未实现 / 风险

- 未实际连接 PT-1509 或扫码枪，未确认真实打印比例、长条码可读性、出纸或误码率。
- 标签队列为内存状态；刷新/退出可能丢失，未引入入库批次数据库或打印历史。
- 新建商品的图片仍是原独立上传流程；失败按原提示补传，不重新创建商品。
- 未增加新退换货事务、ESC/POS、本地桥、myDATA、支付终端或商城重构。
- 尚存依赖审计提示，不能把本阶段通过等同于所有发布门禁通过。
- 远程 Preview 必须另行确认环境身份；不得把构建成功或登录页面视为真实员工业务验收。

## 硬件验收步骤

1. 隔离测试商品、PT-1509 正确驱动、50×30 纸张、100% 比例、0 边距、关闭页眉页脚。
2. 校准页实测 20×5 mm，扫码为 PT1509-TEST；分别验证 40×30 和 60×40。
3. 首次 S=2/M=3 打印恰好 5 张；补货 +3 打印恰好 3 张。
4. 核对每张 Barcode、颜色、尺码、名称和价格；最长真实 SKU 不截断且可扫码。
5. 同码扫描三次数量为 3；错误码后立即扫描正确码；超库存被拒绝。
6. 本地测试环境结账、重放、作废、对账；完成后清理精确测试记录，保留测试日志。

## 回滚

仅回退本分支提交即可恢复原导航与界面。没有数据库 migration、RPC 或 API 合约变更，不需要数据库回滚。回滚前完成/放弃未打印队列，并核对所有结果未知的原业务操作；不要删除库存流水或重置业务 ID。真实库存成功操作不会因界面回滚而撤销。
