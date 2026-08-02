# 客户版本与功能开关设计

## 1. 目标

项目继续保持一套代码，通过客户版本和功能开关交付不同档次，避免复制出基础版、标准版、高级版三套长期分叉的代码。

功能开关必须同时控制：

- 后台菜单和操作入口是否显示。
- 对应服务端 API 是否允许调用。
- 相关页面是否允许访问。

只隐藏按钮不等于禁用功能。即使用户知道 API 地址，服务端也必须再次检查功能是否已启用。

员工权限与客户版本是两层独立限制：

- 客户版本决定这个客户购买了哪些模块。
- 员工角色决定某个员工能否使用客户已经购买的模块。
- 最终权限 = 客户已启用功能 AND 员工具有对应权限。

## 2. 推荐版本

### 基础版 Basic

适合单人维护、重点使用网站与尺码库存快查的小型服装店。

启用：

- 前台官网、分类页、商品详情页。
- 商品列表、拍照上新、新增编辑、图片、分类、供货商和上下架。
- 尺码库存快查、库存作业、手动调整、流水、对账和快速售出。
- 店铺设置和法律页面（仅维护者可修改）。
- 基础法律页面、Contact、Sitemap。

默认关闭：

- POS 收银、订单、日报和作废。
- Barcode 生成和标签打印。
- CSV 批量导入。
- AI 文案、翻译和图片功能。
- 员工账号。

### 标准版 Standard

推荐实体服装店日常使用，覆盖扫码扣库存、纠错、标签和员工协作。

包含基础版，并启用：

- POS 扫码搜索、Dry Run、确认后扣减系统库存。
- POS 销售记录、订单详情、作废恢复库存和营业日报。
- 浏览器销售记录小票预览和打印（不是正式税务发票）。
- Barcode 生成和浏览器标签打印。
- CSV 批量导入。
- 员工账号与现有角色权限。

默认关闭：

- AI 商品、图片和前台导购功能。
- 维护数据导出。
- 尚未完成的税务发票、myDATA、银行 POS 联动和硬件打印桥。
- Standard 的正式交付还必须完成真实扫码枪、标签打印机、连续纸偏移、浏览器小票和离线条码解码验收；只有浏览器预览或自动化测试时标记为 `CONDITIONAL`，不能宣称硬件已兼容。

### 高级版 Advanced

适合需要 AI 商品工具、AI 导购和维护数据导出的客户。

包含标准版，并启用：

- AI 翻译、商品文案、导购信息、商品图片和前台 AI 导购。
- 仅维护者 / owner 可见的数据导出入口。
- 所有当前已稳定的运营模块。

以下功能仍属于后续定制，不应因选择高级版而自动承诺：

- myDATA 和正式电子发票。
- 银行 POS、Viva 或 myPOS 联动。
- 在线支付。
- ESC/POS、本地打印桥和真实硬件适配。
- Advanced 继承 Standard 的全部真实硬件门禁；缺少硬件验收时同样只能标记为 `CONDITIONAL`。
- 复杂退款、部分退货、采购、多仓库。

## 3. 功能键设计

建议使用稳定的代码键，不直接用中文菜单名称：

| 功能键 | 模块 | 主要后台入口或能力 |
| --- | --- | --- |
| `storefront` | 前台官网 | 首页、分类页、商品详情页 |
| `product_management` | 商品管理 | 商品列表、新增编辑、图片、分类 |
| `inventory` | 尺码库存管理 | 快查、库存作业、调整、流水、对账和快速售出 |
| `pos_checkout` | POS 扫码扣库存 | POS 搜索、Dry Run、Checkout；不代替真实收银机 |
| `pos_orders` | POS 销售记录 | 系统内销售历史和详情 |
| `pos_void` | POS 作废恢复库存 | 纠正误操作并恢复库存 |
| `pos_reports` | POS 营业日报 | 系统销售汇总，不是税务报表 |
| `receipt_printing` | 销售记录小票 | 浏览器预览和打印，不是正式税务发票 |
| `barcode_labels` | 条码与标签打印 | Variant Barcode API、筛选、预览和打印 |
| `csv_import` | CSV 批量导入 | 商品、尺码和库存 CSV 导入 |
| `staff_accounts` | 员工账号与角色 | Supabase Auth 员工账号和角色权限 |
| `ai_tools` | AI 商品与导购 | 翻译、文案、资料补全、图片和前台导购 |
| `backup_tools` | 维护数据导出 | 仅维护者 / owner 的导出入口 |

当前 `USE_POS_RPC` 和 `USE_VARIANT_INVENTORY` 是技术迁移开关，不属于客户售卖版本开关，不能放在同一个设置页面让普通商家修改。

## 4. 数据模型建议

下一阶段建议新增单行配置表 `feature_settings`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | bigint | 固定单行主键 |
| `plan` | text | `basic` / `standard` / `advanced` / `custom` |
| `features` | jsonb | 功能键到 boolean 的映射 |
| `updated_by` | text | 最后修改人 |
| `created_at` | timestamptz | 创建时间 |
| `updated_at` | timestamptz | 更新时间 |

约束与安全边界：

- 启用 RLS。
- 不给 anon 或 authenticated 公开读写 policy。
- 只允许服务端 service role 访问。
- 前端通过受保护的 `/api/admin/features` 获取和保存。
- 只有独立开发者设置会话可以修改，普通 owner 或员工账号不能保存客户版本。
- 保存预设版本时，将完整功能快照写入 `features`，避免以后预设变化时无意改变旧客户配置。

## 5. 服务端结构

建议新增服务端模块 `lib/features.ts`：

- 定义 `FeatureKey` 和版本预设。
- `getFeatureSettings()` 读取当前配置。
- `isFeatureEnabled(key)` 检查功能。
- `requireFeature(request, key)` 为 Route Handler 返回统一的 403 响应。
- 配置不存在或读取失败时使用安全的 Basic 功能集，不能短暂显示全部高级模块。

建议的 API：

- `GET /api/admin/features`：返回版本和功能状态。
- `PUT /api/admin/features`：owner 保存版本预设或自定义开关。

高风险写入 API 必须优先加保护：

- POS checkout、void 和日报。
- 库存调整。
- Barcode 生成和修改。
- CSV 导入。
- AI 生成接口。

只读 API 也应逐步加保护，避免隐藏菜单后仍能直接读取未购买模块的数据。

## 6. 后台设置页

在现有 `/admin/settings` 中新增“版本与功能”区域，避免再创建一个零散设置页面。

页面内容：

- 当前版本：Basic / Standard / Advanced / Custom。
- 三个版本预设按钮和适用客户说明。
- 按“所有版本共同具备 / 实体店日常运营 / 渠道与增值能力”分组。
- 双语前台、商品资料和尺码库存属于固定核心，不能关闭。
- 每个开关显示影响范围。
- 保存前确认提示。
- 明确标记 `USE_POS_RPC`、`USE_VARIANT_INVENTORY` 不属于此页面。

后台导航根据功能配置过滤，但仍继续叠加现有 `AdminPermission`：

- `pos` 需要 `pos_checkout` + `pos:checkout`。
- `posOrders` 需要 `pos_orders` + `pos:read`。
- `posDaily` 需要 `pos_reports` + `pos:read`。
- `inventory` 需要 `inventory` + `inventory:read`。
- `labels` 需要 `barcode_labels` + `labels:write`。
- `csv` 需要 `csv_import` + 商品写权限。

## 7. 前台与公共接口边界

- 基础商品展示保持可用，除非整个项目被配置成仅后台模式。
- `/feed.xml` 已永久停用并返回 410，不再属于任何客户版本。
- `ai_tools=false` 时，公开 AI 客服和后台 AI API 都应禁用。
- `ai_tools=false` 时，前台悬浮按钮、商品页 AI 按钮和后台全部 AI 操作也应隐藏。
- 首页、商品页和后台不得显示 Skroutz 文案或入口。
- `staff_accounts=false` 时，非 owner 员工账号和角色密码不能继续调用后台 API。
- 法律页面、Contact、Sitemap 不应作为付费开关关闭，它们属于基本上线能力。
- 关闭模块只停止入口和调用，不删除历史订单、库存流水或 Barcode 数据。

## 8. 实施顺序

### Feature-B：配置地基

1. 生成并测试 `feature_settings` migration。
2. 新增 `lib/features.ts`。
3. 新增只读和保存 API。
4. 保持所有现有功能默认开启，避免首次部署后突然消失。

### Feature-C：后台设置与导航

1. 在店铺设置页加入版本与功能区域。
2. 后台登录后加载功能配置。
3. 过滤桌面和移动端菜单。
4. 当前 tab 被关闭时自动回到可用首页。

### Feature-D：API 强制保护

1. 先保护所有写入 API。
2. 再保护模块只读 API。
3. 统一返回 `403` 和“当前版本未启用该功能”。
4. 验证直接访问 API 无法绕过菜单限制。

### Feature-E：版本验收

分别测试 Basic、Standard、Advanced：

- 菜单是否正确。
- API 是否正确拒绝。
- 员工权限是否仍然生效。
- 切换版本不会删除数据。
- 前台、后台和在线订单行为符合版本定义。

## 9. 风险与注意事项

- 当前后台集中在大型 `admin-dashboard.tsx` 中，功能过滤要小步接入，避免一次性重构整个组件。
- 不能把功能开关仅保存在浏览器 localStorage，否则可被轻易绕过。
- 不能把客户版本只做成环境变量，否则商家无法在后台查看，且每次变更都需要重新部署。
- 不能允许员工账号修改客户购买版本。
- 已关闭模块的历史数据必须保留，客户升级后应能恢复使用。
- 正式销售合同中的功能名称应与本文件和报价文档保持一致，避免“高级版”被理解为包含尚未开发的税务或支付能力。

## 10. 本阶段结论

推荐继续保持一套代码库，以数据库功能配置控制客户版本，并在现有员工权限之上执行二次检查。下一步应实施 Feature-B 配置地基，暂不先做菜单隐藏；只有服务端配置和校验能力稳定后，再接入后台 UI。
