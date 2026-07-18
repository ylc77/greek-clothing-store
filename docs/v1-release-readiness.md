# v1.0 发布就绪结论

更新时间：2026-07-19

发布基线：`master` / `d3023226754b0f55e2cc8d3e3461a01f55ca0728`

正式案例地址：<https://greek-clothing-store.vercel.app>

## 结论先行

| 范围 | 状态 | 结论 |
| --- | --- | --- |
| Basic 模板 | `READY` | 前台、商品、图片、分类、供应商、尺码库存、库存事务、双语页面、权限和备份恢复均已通过本地、CI、隔离 Preview 与正式案例验收。 |
| Standard 模板 | `CONDITIONAL` | 软件功能已通过；交付每家门店前仍需使用该客户的扫码枪、标签机、连续纸和小票打印机完成硬件验收。 |
| Advanced 模板 | `CONDITIONAL` | 软件 Skroutz、AI、CSV、POS 与权限门禁已通过；继承 Standard 的真实硬件条件，Skroutz 上报前还必须替换为客户真实品牌、MPN、EAN 与商品合规资料。 |
| 正式 Vercel / Supabase 案例 | `TECHNICALLY VERIFIED` | 数据库升级、环境变量、密钥、部署、Feed、浏览器、日志和 Daily site monitor 已通过。当前 Legal Settings 尚未发布，案例可展示模板能力，但不能作为真实商家已完成法律合规或可直接营业的证明。 |

## 正式上线证据

- 在任何正式写入前完成数据库、Auth 与 64 个 Storage 对象的受保护备份；在隔离本地 Supabase 完成恢复并继续执行全部 migration。
- 恢复验收保持 28 个商品、34 个 Variant、34 个余额、41 条库存流水、4 张订单、4 条明细和 4 笔付款；库存对账无异常。
- 27 份 migration 已在正式 Supabase 顺序登记，本地与远程 history 完全一致；`client-init.sql` 与 migration 链无漂移。
- 正式数据库的 POS、Inventory、Product、CSV Import 和 Operations runtime health 均为 `ready=true`。
- `product_reconciliation_rpc` 返回 `healthy=true`，投影差异、缺 Variant、缺余额、初始流水差异和非法预留列表均为空。
- Vercel Production 已删除弱 `ADMIN_PASSWORD`，配置 `AUTH_RATE_LIMIT_SECRET`、三个事务 RPC 开关以及同一正式 Supabase 项目的 URL、publishable key 和服务端 Secret key。
- 每客户开发者凭据已初始化并轮换到版本 2；真实浏览器验证 Store Settings、Legal Settings 登录成功，Cookie 为 HttpOnly / Secure / SameSite=Strict，登出后立即失效。
- 已创建 v1 专用 Supabase Secret key并更新 Vercel；旧默认 Secret key 已撤销，撤销后正式数据库健康检查和首页继续正常。
- Production deployment `dpl_69KyTrk6ay9a51sK7MLq6JEeotCM` 为 Ready，并绑定正式 Vercel aliases。
- 首页、分类、商品、Contact、法律页面、sitemap、robots 和严格 Skroutz Feed 检查通过。
- 390px、768px、1440px 的 Greek/English metadata、安全响应头、无障碍、横向溢出以及标签/小票打印布局检查通过。
- 未登录调用 Store Settings、商品写入、POS checkout 和库存调整 API 均返回 401，未产生业务写入。
- 最近 30 分钟 Production 部署无 HTTP 500、无 error 级运行日志。
- GitHub Daily site monitor 手动运行 `29661228859` 已转绿，包含严格 Feed 和浏览器检查。
- PR #12 的四项 required CI 和 Vercel Preview 全绿；空库、client-init、旧客户升级、数据库/Storage 恢复和完整事务安全套件均通过。

## 正式案例数据边界

- 商家展示名和页脚统一为 `Athens Wardrobe`，用于模板案例展示，不代表已登记的法律主体。
- 为证明严格 Feed 端到端可运行，仅补齐一个演示商品的品牌、MPN、校验格式 EAN 和已核验图片尺寸；未修改其 SKU、价格、Variant 或库存。
- 该演示商品资料不得直接用于真实 Skroutz 商家上报。客户交付时必须替换成供应商或品牌方提供的真实标识。
- 正式验收没有创建、作废或删除订单，没有调整库存，没有上传或删除 Storage 对象。

## 尚未解除的客户交付条件

1. Legal Settings 仍显示“法律信息未完成”，尚无正式发布版本。真实商用前必须填写法律主体、AFM/VAT、联系方式、隐私、配送、退货、退款和 14 天撤回权条款，完成五项确认并发布；必要时由希腊/欧盟律师、会计师或合规专业人士审查。
2. 当前案例使用 Vercel 默认域名。绑定客户域名时需同步更新 `NEXT_PUBLIC_SITE_URL`、DNS、搜索引擎和 Skroutz Feed 地址。
3. Standard / Advanced 的扫码枪、标签机、连续纸和小票打印机必须按客户真实硬件再次验收。
4. 本系统 POS 仅记录内部扫码销售并扣减系统库存，不替代真实税务收银机、myDATA、会计系统或支付终端。

## 发布决定

- 允许将代码和服装店模板标记为 `v1.0.0`：**是**。
- 允许把正式 Vercel/Supabase 案例描述为“技术上线已验证”：**是**。
- 允许把案例描述为“真实商家法律合规和硬件均已完成”：**否**。
- 允许在未替换真实法律、商品和硬件资料前直接交付客户营业：**否**。
