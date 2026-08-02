# 服装店项目报价方案

## 1. 当前项目已完成的功能清单

### 前台功能

- 首页展示
- 分类页
- 商品详情页
- 商品图片展示
- 多语言前台，偏 Greek + English
- 联系页面
- Privacy Policy / Terms / Cookie Policy / Refund Policy 等基础法律页面
- Cookie Banner 结构
- Footer 法律链接
- 购物车、货到付款和到店自取
- `/sitemap.xml`
- `/robots.txt`
- AI 客服入口，需配置 OpenAI / DeepSeek 等 API Key 后使用

### 后台功能

- 商品管理
- 商品新增 / 编辑 / 下架 / 删除保护
- 图片上传
- 分类管理
- 店铺设置
- CSV 导入
- 在线订单管理
- 库存管理 tab
- 手动库存调整
- 库存流水查看
- 低库存提醒
- 库存对账状态
- 库存 CSV 导出
- POS 收银
- POS dryRun 预检
- POS 订单历史
- POS 订单详情
- POS 订单作废
- POS 日报
- 小票预览
- 浏览器打印小票
- Barcode 生成 API
- 标签打印 UI
- 员工账号 / 后台权限系统已有基础结构，正式交付前需确认生产环境配置

### 数据库 / 后端功能

- Supabase 数据库
- Supabase Storage 图片上传
- ERP 库存表：
  - `product_variants`
  - `inventory_balances`
  - `stock_movements`
  - `inventory_locations`
  - `audit_logs`
- POS 表：
  - `sales_orders`
  - `sales_order_items`
  - `payments`
- POS RPC transaction：
  - `pos_checkout_rpc`
  - `pos_void_rpc`
- 公开商品查询缓存
- 后台写入后缓存刷新
- SKU 修改保护
- permanent delete 库存流水保护
- Barcode 唯一性保护
- ERP / POS 只读健康检查 SQL
- RLS / service_role 权限设计

### 图片 / 文件上传

- 商品图片上传
- 店铺 Logo / Hero 图片设置
- Supabase Storage
- Next Image 优化
- 图片 fallback
- 上传图片 cacheControl 优化

### 支付、订单、打印、通知

已完成：

- POS 收银订单
- POS cash / card / other 付款记录
- POS 订单作废
- 小票预览
- 浏览器打印小票
- 商品标签浏览器打印

未完成：

- 正式线上支付，例如 Stripe / Viva
- 银行 POS / Viva / myPOS API 联动
- 正式税务发票
- myDATA
- ESC/POS 本地打印桥
- 邮件 / SMS / WhatsApp 自动通知

### 部署和配置

- Next.js App Router
- Vercel 部署结构
- Supabase 数据库和 Storage
- `.env.example` 已包含主要环境变量
- 支持 Supabase、后台密码、`USE_POS_RPC`、AI API Key、法律页面业务信息等配置
- `backups/*.sql` 应忽略，避免数据库备份提交到 GitHub

## 2. 项目对客户的实际价值

### 能帮客户解决的问题

- 让传统服装店拥有自己的线上商品展示网站
- 统一管理商品、图片、分类、库存
- 支持实体店 POS 收银
- 支持扫码收银和商品标签打印
- 支持库存流水追踪
- 支持低库存提醒
- 支持站内购物车、货到付款和到店自取
- 支持后台快速维护商品
- 支持订单记录和作废
- 减少人工 Excel 管库存的错误
- 为后续 myDATA / 电子发票 / 银行 POS 联动打基础

### 适合的客户类型

- 雅典本地服装店
- 鞋包店
- 饰品店
- 小型买手店
- 希望同时经营实体店和网店的商家
- 希望用自有网站接收在线订单的零售店
- 不想一开始购买复杂 ERP 的中小商家

### 相比普通展示网站的优势

普通展示网站通常只有页面展示。本项目已经接近“在线商店 + 后台 + ERP 库存 + POS 扫码 + 标签打印”的一体化系统。

核心优势：

- 不只是展示商品，还能管理商品
- 不只是线上网站，还能服务实体店
- 有库存流水和对账能力
- 有 POS 收银流程
- 有条码和标签能力
- 有后续扩展 myDATA / 电子发票 / 支付联动的技术地基

## 3. 三档报价方案

报价币种：EUR  
定位：希腊雅典本地中小商家  
策略：前期低价获客，但保持专业感

### 基础版

适合客户：

- 刚开店的小型服装店
- 需要官网、商品后台和尺码库存快查
- 由店主单人维护
- 暂时不需要 POS 收银

包含功能：

- 首页
- 分类页
- 商品详情页
- 商品后台管理
- 拍照上新与新增 / 编辑
- 图片上传
- 分类管理
- 供货商与供货商 SKU（选填）
- 尺码库存快查
- 库存作业、手动调整、流水和对账
- 快速售出扣库存
- 购物车、货到付款和到店自取
- 在线订单管理
- 联系页面
- 基础法律页面模板
- Cookie Banner 结构
- 基础 SEO
- `/sitemap.xml`
- `/robots.txt`
- Vercel + Supabase 基础部署

不包含：

- POS 收银
- POS 扫码扣库存和销售记录
- Barcode 标签打印
- CSV 批量导入
- AI 商品与前台导购
- 员工权限
- 维护数据导出
- myDATA
- 电子发票
- 银行 POS 联动
- 正式线上支付
- 打印机适配

报价建议：

- 一次性制作费用：`€900 - €1,500`
- 建议早期成交价：`€1,200`
- 月维护费用：`€40 - €80 / 月`
- 免费维护期：`14 天`
- 交付周期：`7 - 14 天`

### 标准版

适合客户：

- 已经有一定商品数量的服装店
- 需要实体店扫码快速扣减系统库存
- 想打印商品标签
- 需要员工协作和批量导入

包含功能：

- 基础版全部功能
- POS 扫码搜索与 Dry Run 预检
- POS 确认后扣减系统库存
- POS 销售记录与详情
- POS 作废恢复库存
- POS 营业日报
- 销售记录小票预览与浏览器打印
- CSV 导入
- Barcode 生成
- 商品标签筛选、预览和打印
- 员工账号与角色权限

不包含：

- AI 商品文案、翻译、图片和前台导购
- 维护数据导出
- myDATA
- 电子发票
- 银行 POS 联动
- ESC/POS 打印机适配
- 复杂退款 / 退货
- 采购入库
- 多仓库

报价建议：

- 一次性制作费用：`€2,200 - €3,500`
- 建议早期成交价：`€2,800`
- 月维护费用：`€90 - €180 / 月`
- 免费维护期：`30 天`
- 交付周期：`3 - 5 周`

### 高级版

适合客户：

- 需要实体店运营能力并希望通过自有网店接单
- 希望使用 AI 加快商品资料、翻译和导购内容维护
- 需要完整现有模块和维护数据导出

包含功能：

- 标准版全部功能
- AI 商品文案、希腊语 / 英语翻译和资料补全
- AI 商品图片能力（需要对应 API Key）
- 前台 AI 导购
- 维护数据导出入口
- 高级上线检查
- 生产环境部署协助
- 基础操作培训

不包含：

- 正式税务发票
- myDATA
- 电子发票服务商 API
- 银行 POS / Viva / myPOS 联动
- 正式线上支付
- ESC/POS 本地打印桥
- 自动切纸 / 开钱箱
- 复杂退款 / 部分退货
- 采购入库
- 多门店 / 多仓库
- 会计系统集成

报价建议：

- 一次性制作费用：`€4,500 - €7,500`
- 建议早期成交价：`€5,800`
- 月维护费用：`€250 - €450 / 月`
- 免费维护期：`60 天`
- 交付周期：`6 - 10 周`

## 4. 可选加购项

### myDATA / 电子发票服务商对接

`€1,500 - €4,000 起`

前提：

- 客户提供服务商 API 文档
- 会计师确认发票类型
- 明确是否需要零售收据、发票、作废、退款、QR Code、MARK

### 银行 POS / Viva / myPOS 联动

`€1,000 - €3,000 起`

取决于：

- 服务商 API 是否开放
- 是否需要支付请求推送到刷卡机
- 是否需要 myDATA 联动

### ESC/POS 本地打印桥

`€800 - €2,000 起`

适合：

- 需要自动打印
- 需要自动切纸
- 需要开钱箱
- 浏览器打印不稳定的店铺

### 真实硬件上门调试

`€150 - €400 / 次`

包含：

- 扫码枪测试
- 标签打印机测试
- 小票机测试
- 浏览器打印设置
- 店员基础培训

### 线上支付 Stripe / Viva Checkout

`€600 - €1,500 起`

不包含支付平台手续费。

## 5. 交付前需要处理的问题

正式卖给客户前，建议处理或确认：

1. 清理演示商品、测试订单、测试 SKU
2. 确认生产环境员工账号已经配置
3. 确认 `admin_users` 相关数据库 migration 已执行
4. 确认没有使用默认后台密码
5. 确认 OpenAI / DeepSeek API Key 是否配置
6. 确认法律页面里的公司资料已填写
7. 法律页面需客户或会计师确认
8. 小票当前不是正式税务发票
9. 尚未接 myDATA
10. 尚未接电子发票服务商
11. 尚未接银行 POS / Viva / myPOS API
12. 尚未完成真实扫码枪验收
13. 尚未完成真实标签打印机验收
14. 尚未完成真实小票机验收
15. Cookie Banner 需要确认所有 analytics / marketing scripts 在同意前不加载
16. 需要确认 Vercel / Supabase 环境变量没有混用测试和生产
17. 需要确认数据库备份策略
18. 建议接入错误监控，例如 Sentry
19. 仓库里如有未跟踪文件，例如 `agents.md`，交付前需要确认是否提交或忽略

## 6. 给客户看的简洁报价文案

### 中文版本

我们提供一套适合服装店的官网 + 后台管理 + 库存 + POS 收银系统。

系统可以帮助商家在线接单、管理尺码库存、打印商品标签、扫码记录销售并同步扣减系统库存，也可以按高级版启用 AI 工具。线下真实收款仍由实体收银机完成。

报价方案：

- 基础版：`€900 - €1,500`  
  适合需要双语官网、商品管理和尺码库存快查的单人小店。
- 标准版：`€2,200 - €3,500`  
  推荐实体店使用，包含 POS 扫码扣库存、销售记录与作废、CSV、Barcode 标签和员工账号。
- 高级版：`€4,500 - €7,500`  
  在标准版之上增加 AI 商品与导购工具和维护数据导出。

说明：当前系统不包含正式税务发票、myDATA、银行 POS 联动和电子发票服务商对接。这些功能可以根据客户需求后续定制开发。

### English Version

We provide a custom website, admin dashboard, inventory system and POS solution for fashion and retail stores.

The system helps merchants accept online orders, manage size-level inventory, print barcode labels, scan sales and update system stock. AI tools are available in the Advanced Plan; in-store payment remains on the physical cash register.

Pricing options:

- Basic Plan: `€900 - €1,500`  
  Suitable for owner-operated shops that need a bilingual storefront, product management and size-level inventory lookup.
- Standard Plan: `€2,200 - €3,500`  
  Recommended for physical stores that need POS barcode stock deduction, sale records and voids, CSV import, barcode labels and staff accounts.
- Advanced Plan: `€4,500 - €7,500`  
  Adds AI product and shopping-assistant tools, and maintenance data export to the Standard Plan.

Note: This version does not include official tax invoicing, myDATA, bank POS integration or electronic invoice provider integration. These can be added later as custom development.

### Ελληνική έκδοση

Προσφέρουμε μια προσαρμοσμένη λύση για καταστήματα μόδας και λιανικής, που περιλαμβάνει ιστοσελίδα, διαχείριση προϊόντων, αποθήκη και POS.

Το σύστημα βοηθά τον έμπορο να παρουσιάζει προϊόντα online, να διαχειρίζεται απόθεμα ανά μέγεθος, να εκτυπώνει barcode labels και να καταγράφει πωλήσεις με σάρωση ώστε να ενημερώνεται το απόθεμα. Η πραγματική πληρωμή συνεχίζει να γίνεται στην ταμειακή μηχανή.

Πακέτα τιμών:

- Basic Plan: `€900 - €1,500`  
  Για μικρά καταστήματα που χρειάζονται δίγλωσση ιστοσελίδα, διαχείριση προϊόντων και γρήγορο έλεγχο αποθέματος ανά μέγεθος.
- Standard Plan: `€2,200 - €3,500`  
  Για φυσικά καταστήματα που χρειάζονται σάρωση barcode για αφαίρεση αποθέματος, ιστορικό και ακύρωση πωλήσεων, CSV, labels και λογαριασμούς προσωπικού.
- Advanced Plan: `€4,500 - €7,500`  
  Περιλαμβάνει επιπλέον εργαλεία AI για προϊόντα και εξαγωγή δεδομένων συντήρησης.

Σημείωση: Η παρούσα έκδοση δεν περιλαμβάνει επίσημη φορολογική τιμολόγηση, myDATA, σύνδεση με τραπεζικό POS ή πάροχο ηλεκτρονικής τιμολόγησης. Αυτές οι λειτουργίες μπορούν να προστεθούν αργότερα ως custom development.

## 7. 推荐销售策略

前期建议不要一开始卖太贵，可以用“演示版 + 定制交付”的方式成交。

推荐话术：

> 这不是普通展示网站，而是一套可以继续扩展成在线商店 + ERP + POS + 发票系统的商业基础平台。第一版可以先帮你上线官网、购物车、后台、库存和 POS，后续再根据你店里的实际流程接电子发票、银行 POS 和打印设备。

建议优先成交：

- 标准版客户
- 高级版早期客户
- 有实体店、商品数量较多、希望用自有网店接单的客户

不建议一开始承诺：

- 完整 myDATA 合规
- 自动税务发票
- 银行 POS 强绑定
- 离线收银
- 多门店复杂 ERP
- 完整会计系统

这些应该作为二期或三期定制项目报价。
