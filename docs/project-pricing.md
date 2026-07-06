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
- `/feed.xml`
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
- Skroutz Feed 管理
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
- 支持 Skroutz Feed
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
- 需要接 Skroutz 的零售店
- 不想一开始购买复杂 ERP 的中小商家

### 相比普通展示网站的优势

普通展示网站通常只有页面展示。本项目已经接近“官网 + 后台 + ERP 库存 + POS 收银 + 标签打印 + Skroutz Feed”的一体化系统。

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
- 只需要官网展示和简单商品后台
- 暂时不需要 POS 收银
- 暂时不需要复杂库存系统

包含功能：

- 首页
- 分类页
- 商品详情页
- 商品后台管理
- 图片上传
- 分类管理
- 联系页面
- 基础法律页面模板
- Cookie Banner 结构
- 基础 SEO
- `/sitemap.xml`
- `/robots.txt`
- Vercel + Supabase 基础部署

不包含：

- POS 收银
- ERP 库存流水
- Barcode 标签打印
- Skroutz Feed 深度配置
- 员工权限
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
- 想管理库存
- 想打印商品标签
- 想接 Skroutz
- 暂时不需要完整收银闭环

包含功能：

- 基础版全部功能
- ERP 库存管理
- 变体库存
- 尺码 / 颜色库存
- 库存流水
- 手动库存调整
- 低库存提醒
- 库存对账状态
- CSV 导入
- Skroutz Feed
- Barcode 生成
- 商品标签打印 UI
- 库存 CSV 导出
- 后台基础权限结构
- AI 商品文案 / 翻译功能，需客户提供 API Key

不包含：

- POS 收银正式启用
- POS 订单历史
- POS 作废
- 小票打印
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

- 有实体店收银需求的服装店
- 需要官网 + 后台 + ERP + POS 一体化
- 希望扫码卖货、扣库存、打印小票
- 后续准备接 myDATA / 电子发票服务商

包含功能：

- 标准版全部功能
- POS 收银
- POS dryRun 预检
- POS 订单历史
- POS 订单详情
- POS 作废订单
- POS 日报
- POS RPC transaction
- 付款方式记录：cash / card / other
- 小票预览
- 浏览器打印小票
- 58mm / 80mm 小票样式
- POS health check
- ERP / POS 对账 SQL
- 后台员工账号基础结构
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

系统可以帮助商家展示商品、管理库存、打印商品标签、进行线下收银、查看订单记录，并支持 Skroutz Feed。相比普通展示网站，这套系统更适合实体店和网店一起经营。

报价方案：

- 基础版：`€900 - €1,500`  
  适合只需要官网展示和商品后台的小型商家。
- 标准版：`€2,200 - €3,500`  
  适合需要库存管理、CSV 导入、Skroutz Feed、Barcode 和标签打印的商家。
- 高级版：`€4,500 - €7,500`  
  适合需要 ERP 库存、POS 收银、订单历史、小票打印和完整后台系统的实体店。

说明：当前系统不包含正式税务发票、myDATA、银行 POS 联动和电子发票服务商对接。这些功能可以根据客户需求后续定制开发。

### English Version

We provide a custom website, admin dashboard, inventory system and POS solution for fashion and retail stores.

The system helps merchants display products online, manage inventory, print barcode labels, run in-store checkout, track orders and generate Skroutz feeds. Compared with a normal showcase website, this solution is designed for both online and physical store operations.

Pricing options:

- Basic Plan: `€900 - €1,500`  
  Suitable for small shops that need a product website and basic admin dashboard.
- Standard Plan: `€2,200 - €3,500`  
  Suitable for stores that need inventory management, CSV import, Skroutz Feed, barcode generation and label printing.
- Advanced Plan: `€4,500 - €7,500`  
  Suitable for physical stores that need ERP inventory, POS checkout, order history, receipt printing and a complete admin system.

Note: This version does not include official tax invoicing, myDATA, bank POS integration or electronic invoice provider integration. These can be added later as custom development.

### Ελληνική έκδοση

Προσφέρουμε μια προσαρμοσμένη λύση για καταστήματα μόδας και λιανικής, που περιλαμβάνει ιστοσελίδα, διαχείριση προϊόντων, αποθήκη και POS.

Το σύστημα βοηθά τον έμπορο να παρουσιάζει προϊόντα online, να διαχειρίζεται απόθεμα, να εκτυπώνει barcode labels, να κάνει πωλήσεις στο φυσικό κατάστημα, να βλέπει παραγγελίες και να δημιουργεί Skroutz Feed. Σε αντίθεση με μια απλή ιστοσελίδα παρουσίασης, αυτή η λύση είναι σχεδιασμένη για online και φυσικό κατάστημα μαζί.

Πακέτα τιμών:

- Basic Plan: `€900 - €1,500`  
  Για μικρά καταστήματα που χρειάζονται ιστοσελίδα προϊόντων και βασικό admin.
- Standard Plan: `€2,200 - €3,500`  
  Για καταστήματα που χρειάζονται διαχείριση αποθήκης, CSV import, Skroutz Feed, barcode και εκτύπωση labels.
- Advanced Plan: `€4,500 - €7,500`  
  Για φυσικά καταστήματα που χρειάζονται ERP αποθήκη, POS checkout, ιστορικό παραγγελιών, απόδειξη παραγγελίας και πλήρες admin σύστημα.

Σημείωση: Η παρούσα έκδοση δεν περιλαμβάνει επίσημη φορολογική τιμολόγηση, myDATA, σύνδεση με τραπεζικό POS ή πάροχο ηλεκτρονικής τιμολόγησης. Αυτές οι λειτουργίες μπορούν να προστεθούν αργότερα ως custom development.

## 7. 推荐销售策略

前期建议不要一开始卖太贵，可以用“演示版 + 定制交付”的方式成交。

推荐话术：

> 这不是普通展示网站，而是一套可以继续扩展成 ERP + POS + Skroutz + 发票系统的商业基础平台。第一版可以先帮你上线官网、后台、库存和 POS，后续再根据你店里的实际流程接电子发票、银行 POS 和打印设备。

建议优先成交：

- 标准版客户
- 高级版早期客户
- 有实体店、商品数量较多、想接 Skroutz 的客户

不建议一开始承诺：

- 完整 myDATA 合规
- 自动税务发票
- 银行 POS 强绑定
- 离线收银
- 多门店复杂 ERP
- 完整会计系统

这些应该作为二期或三期定制项目报价。
