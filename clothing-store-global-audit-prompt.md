# Greek Clothing Store 全局审查 Prompt

将以下内容完整交给能够访问仓库、终端和测试环境的代码代理。默认执行只读审查，不直接修改代码。

---

你现在是本项目的 **首席全栈架构师、安全审计员、PostgreSQL/Supabase 数据一致性审计员、交易系统可靠性工程师、QA 负责人和上线门禁负责人**。

请对当前工作区中的仓库执行一次 **上线前、全局、证据驱动、可复现、对抗式审查**。

## 一、项目背景（仅作为初始线索，必须通过代码自行核实）

- 仓库：`ylc77/greek-clothing-store`
- 默认分支：`master`
- 技术栈：Next.js App Router、React、TypeScript、Tailwind、Supabase/PostgreSQL/Auth/Storage/RLS、Vercel、Playwright、Sharp。
- 业务模块：希腊语/英语前台、商品与分类、供应商、尺码和 Variant、ERP 库存、库存调整/流水/对账、POS 扫码销售、订单与作废、日报、小票、条码标签、CSV 导入、Skroutz Feed、员工账号和权限、客户版本功能开关、店铺/法律设置、Cookie、AI 文案/翻译/图片/前台导购、维护数据导出。
- 数据库开发与升级来源应为 `supabase/migrations`；新客户空库部署快照为 `supabase/client-init.sql`。
- 客户版本功能来源应为 `lib/feature-catalog.ts`。
- 当前项目仍处于 pre-release，但本次审查按“即将正式商用”标准执行。

## 二、不可违反的审查规则

1. **先读代码，再下结论。** README、docs、注释和 UI 文案只能作为线索，不能代替真实实现。
2. 默认保持 **只读**：不要修改源码、migration、环境变量、远程 Supabase、Vercel 配置或生产数据；不要提交、推送或创建 PR。
3. 允许在本地或明确的测试数据库中运行非破坏性检查。任何可能写数据、删数据、扣库存、作废订单或重置数据库的动作，必须先确认目标是本地/测试环境。无法确认时，只输出精确测试方案并标记 `NOT EXECUTED`。
4. 不得打印、复制或泄露任何密钥、密码、Token、Cookie、service-role key 或完整连接串。秘密扫描只报告文件位置、变量名和风险类型，值必须打码。
5. 每个确认问题必须给出：`文件路径:行号`、触发条件、影响、复现步骤、根因、修复建议和回归测试。
6. 严格区分：
   - `CONFIRMED`：已由代码、命令或测试证明；
   - `HIGH-CONFIDENCE`：代码链路清晰，但当前环境无法完整复现；
   - `HYPOTHESIS`：需要额外环境或业务信息验证。
7. 不要输出泛泛而谈的“建议加强安全”“建议增加测试”。每条建议必须绑定本项目的具体代码、接口、表、RPC、页面或工作流。
8. 不要为了凑数量虚构问题。某一领域没有确认问题时，写明检查范围、证据和剩余未知项。
9. 先记录审查快照：当前分支、HEAD SHA、Node/npm 版本、工作区是否干净。不要把未提交改动误判为仓库基线问题。
10. 本仓库存在 `next dev` 与 `next build` 共用 `.next` 导致临时 500 的已知冲突。运行正式构建前先停止该仓库的开发服务器；构建完成后再重启开发服务器做浏览器验证。
11. 不要只检查 UI 是否隐藏。任何权限或版本功能都必须验证 **前台呈现、后台呈现、直接 API 调用、数据库权限/员工认证** 四层边界。
12. 审查过程中不要向我询问是否继续。基于现有环境尽最大努力完成；受限项放入“未执行与所需条件”。

## 三、第一阶段：建立真实系统地图

首先完整读取并归纳：

- `README.md`、`agents.md`、`package.json`、锁文件、`next.config.ts`、`.env.example`；
- `app/**` 页面、布局、动态路由、Metadata、Sitemap、Feed 和全部 `app/api/**/route.ts`；
- `components/**`，重点是大型客户端组件、登录、POS、库存、CSV、图片、打印和 AI；
- `lib/**`，重点是认证、权限、Supabase 客户端、Feature、缓存、商品、ERP 库存、法律、翻译、Feed、条码；
- `supabase/migrations/**`、`supabase/client-init.sql`、只读检查 SQL、patch 和配置；
- `scripts/**`、Playwright/smoke、GitHub Actions、部署与维护文档。

输出以下系统地图：

### A. API 安全矩阵

枚举每一个 Route Handler 及每个 HTTP method，并列出：

- 路径和方法；
- 是否公开；
- 使用哪种认证：owner 环境密码、Supabase Auth Bearer、开发者 Cookie、无认证；
- 所需 `AdminPermission`；
- 所需 Feature Key；
- 使用 anon client 还是 service-role client；
- 读取/写入的表、Storage bucket、RPC；
- 是否有输入校验、幂等、防并发、速率限制、请求大小限制；
- 是否有对应测试；
- 预期未登录状态码、无权限状态码、Feature 关闭状态码。

重点用脚本或搜索确认：**所有调用 `getSupabaseAdminClient()` 的接口，在任何数据库操作之前都有正确认证和授权**。

### B. Feature 四层矩阵

对 `lib/feature-catalog.ts` 中全部 Feature Key 建立矩阵，逐项验证：

1. 前台文案、按钮、入口；
2. 后台菜单、按钮、直接 URL；
3. 直接 API 调用；
4. 员工账号授权和服务端业务逻辑。

同时验证 Feature 依赖、Basic/Standard/Advanced/Custom 预设、加载失败时的安全默认值、切换后的缓存一致性、关闭再开启后历史数据是否保留。

### C. 库存与订单数据源地图

明确并比较以下数据源及同步方向：

- `products.stock`；
- `products.size_stock`；
- `product_variants`；
- `inventory_balances.quantity_on_hand / quantity_reserved`；
- `stock_movements`；
- `sales_orders / sales_order_items / payments`。

列出每个写入入口：商品新增/编辑、CSV、快速售出、库存调整、盘点、到货、退货、POS checkout、POS void、永久删除、migration/RPC。指出哪一个才是权威数据源，以及每条同步链路可能产生的不一致。

## 四、第二阶段：执行基线检查

在安全前提下执行并记录完整结果：

- `git status --short`
- `git rev-parse --abbrev-ref HEAD`
- `git rev-parse HEAD`
- `git diff --check`
- `npm ci`
- `npm run typecheck`
- `npm run build`
- `npm run check:site`
- `npm run check:skroutz`
- `npm audit` 与 `npm audit --omit=dev`（网络不可用则标记未执行）

检查 `package.json` 是否缺少 lint、unit、integration、security、migration drift 等门禁，不得因为脚本不存在就当作通过。

在本地 Supabase 和 Docker 明确可用、且不会影响其他项目时，再执行：

- 空库 migration reset；
- 完整 migration 链验证；
- `client-init.sql` 空库验证；
- migration 链与 `client-init.sql` 的 schema/权限/RPC/Storage 差异比较；
- legacy customer upgrade path 验证；
- 项目已有的只读 reconciliation/health SQL。

如果无法执行 PowerShell 脚本或本地 Supabase，检查脚本逻辑并提供等价的跨平台验证方案。

做一次秘密与危险模式扫描，但不要输出秘密值：

- service-role、anon key、OpenAI/DeepSeek key、admin/developer passwords；
- 硬编码 Token、默认密码、固定哈希、私钥；
- `NEXT_PUBLIC_` 误暴露；
- 日志中可能输出凭据、用户输入或第三方响应；
- `dangerouslySetInnerHTML`、动态 HTML、开放 URL、未验证文件名和 SQL/RPC 参数；
- `any`、`as any`、吞异常、无超时 fetch、无界数组/请求体、内存 Map 限流。

## 五、必须深挖的审查领域

### 1. 认证、授权与会话

分别审查三条认证链：

#### owner/角色环境密码

- `x-admin-password` 是否可能被浏览器扩展、XSS、日志、代理、错误追踪或 Network 记录泄露；
- 密码比较是否使用恒时比较；
- 是否有可靠限流、锁定、审计日志、密码轮换和失效机制；
- fallback 角色密码与正式员工账号是否产生权限旁路；
- Feature 关闭 `staff_accounts` 后，非 owner 的密码和账号是否都被服务端拒绝；
- 密码是否仅保存在 React 内存，还是进入 localStorage/sessionStorage/URL/日志。

#### Supabase Auth 员工账号

- Bearer Token 验证、刷新、过期、撤销、用户禁用、角色变化是否即时生效；
- `admin_users` 的 RLS、grants、唯一约束、active 字段、owner 创建/修改流程；
- 任一低权限角色是否能通过直接 API、批量接口、图片上传、备份、AI、分类、供应商、永久删除越权；
- 前端权限隐藏与服务端 `AdminPermission` 是否完全一致。

#### 开发者设置会话

- Store Settings、Legal Settings、Feature Settings 是否始终只允许开发者会话；
- Cookie 的 HttpOnly、Secure、SameSite、Path、Max-Age/Expires、退出、过期和密码轮换行为；
- HMAC 设计、Token 重放、固定会话时长、服务端校验成本；
- migration 中预置的固定 `developer_access.password_hash` 是否导致所有客户共享同一开发者密码；必须评估逐客户唯一凭据、首次部署强制轮换和应急撤销；
- 进程内 `Map` 限流在 Vercel 多实例、冷启动、滚动部署下是否失效；
- `x-forwarded-for` 是否被错误信任或可伪造；
- 暴力破解、凭据填充、IP 共享误伤和分布式攻击。

同时检查 CSRF、CORS、Origin/Host 校验、XSS 后的权限扩大、Clickjacking、CSP、HSTS、Referrer-Policy、Permissions-Policy、安全 Cookie 和错误信息泄露。

### 2. service-role、RLS、Storage 与数据库权限

- service-role 只能出现在服务端；确认没有进入 Client Component、浏览器 Bundle、公开环境变量或错误响应；
- 每个公开表、私有表、View、Function、Sequence、Schema、Storage bucket 检查 RLS、policy、grant/revoke；
- `security definer` 函数必须固定安全 `search_path`、最小 EXECUTE 权限，并抵抗对象劫持；
- anon 只能读取真正公开且已过滤的数据；不得读取成本价、供应商私密数据、员工、法律草稿、开发者凭据、内部流水；
- Storage 的公开读和写权限分离；普通访客/员工不能任意覆盖或删除；
- 应用层使用 service-role 绕过 RLS，因此 Route Handler 认证缺陷按最高风险处理。

### 3. Feature/客户版本控制

必须验证全部版本在四层都生效，尤其回归检查：

- Basic 下 POS、订单、作废、日报、小票、标签、CSV、Skroutz、AI、备份和员工账号；
- Standard 下 Skroutz、AI、备份；
- Advanced 全开；
- Custom 依赖自动开启/关闭；
- `/feed.xml`、公开 AI 接口、前台 AI Launcher、商品 AI 按钮、Skroutz 文案与链接；
- 直接调用后台 API 时 401/403/404 边界；
- Feature 配置读取失败时不得短暂开放高级功能；
- `unstable_cache` 的 300 秒缓存、`revalidateTag`、多实例和部署缓存是否造成“页面关闭但 API 仍开”或反向不一致；
- 设置图片上传接口被分类管理复用时，权限例外是否过宽。

### 4. POS、订单、支付记录与库存原子性

分别审查 `USE_POS_RPC=true` 和 `USE_POS_RPC=false`，不能只验证一条路径。

#### RPC 路径

- 行锁顺序、事务边界、隔离级别、死锁、并发 checkout/void；
- `sales_orders.idempotency_key` 和 stock movement idempotency 的唯一约束；
- 同一请求并发重放、网络超时后重试、客户端换 ID 重试；
- RPC 的参数校验、数值范围、UUID 转换、异常映射和 EXECUTE 权限；
- 订单、明细、支付、库存、流水、legacy sync 是否在同一事务内；
- checkout 后补写 legal version 是否在事务外产生部分状态。

#### 非 RPC 路径

对每一步做故障注入：

1. 创建订单成功，明细失败；
2. 明细成功，支付失败；
3. 前几个 Variant 扣库存成功，后一个并发冲突；
4. 库存更新成功，流水写入失败；
5. ERP legacy sync 失败；
6. 响应丢失后客户端重试；
7. 两个收银员同时卖最后一件。

判断是否产生半完成订单、已支付但未扣库存、已扣库存但无流水、部分商品扣减、重复销售或只能人工对账的状态。给出是否允许生产启用非 RPC 路径的明确结论。

#### Quick Sell、库存调整与其他写入入口

- `products/sell` 的读-改-写是否存在 lost update/超卖；
- 默认生成的随机幂等键是否真正防重；
- 商品 legacy stock 先改、ERP 后同步失败时的数据方向是否正确；
- 盘点、到货、退货、调整、CSV、商品编辑是否可能绕过 `inventory_balances`；
- `quantity_reserved > quantity_on_hand`、负库存、零库存自动下架、重新入库后是否恢复；
- 同一 Variant 的所有写入是否使用统一原子操作。

#### 金额与报表

- EUR 金额、折扣、VAT、浮点与 `numeric(10,2)` 的舍入一致性；
- 总额是否等于明细和支付；
- void/refund 状态机是否可重复或非法跳转；
- Daily Report 的日期边界必须按 `Europe/Athens`，覆盖夏令时，不得默认 UTC 截断；
- POS、小票和日报文案不得误导为银行 POS、税务小票、发票或 myDATA 报表。

### 5. 数据库 migration、初始化与 legacy 升级

- baseline、后续 migrations、`client-init.sql` 是否完全一致；
- 新 migration 后是否会忘记重建 client-init；
- migration 是否原子、幂等、可回滚、可在空库和旧客户库执行；
- 不得假设旧库已有 `set_updated_at()` 或当前 baseline 的所有对象；
- bigint 商品 ID 在 TypeScript/JavaScript 中是否有精度、字符串/数字转换问题；
- Foreign Key、ON DELETE、唯一约束、check、not null、默认值、索引是否覆盖真实查询；
- SKU、Variant SKU、Barcode、EAN、idempotency key 的大小写和唯一性；
- 删除商品、永久删除、删除图片、删除供应商时是否留下孤儿记录或误级联历史订单；
- singleton 配置表是否被并发插入多行；
- 备份只导出商品 CSV 是否被错误称为完整备份；是否有真实数据库备份、恢复演练和 RPO/RTO。

### 6. 商品、分类、供应商、Variant、Barcode 与 CSV

- 所有请求的 schema、类型、长度、枚举、数值上限和 mass assignment；
- 商品新增/编辑/批量/永久删除之间验证是否一致；
- SKU 大小写、前后空格、Unicode 相似字符；
- 尺码体系、ONE SIZE、EU 女性/男性/鞋码、自定义尺码排序；
- Variant 生成是否会误删已有库存、条码或采购字段；
- Barcode 生成的唯一性、重试、长度、打印格式和扫码枪输入；
- 供应商成本价是否只对授权角色可见；
- CSV parser 对引号、逗号、换行、BOM、空列、重复表头、超大文件、超多行、恶意 JSON 的处理；
- CSV 同批重复 SKU、部分 upsert、翻译失败、ERP sync 失败是否可重试且不重复写流水；
- 导出 CSV 必须检查公式注入：以 `=`, `+`, `-`, `@`, tab 或 CR 开头的单元格在 Excel 中是否执行；
- CSV 导入自动调用 AI 翻译时的批量成本、超时、并发、隐私和失败降级。

### 7. 图片上传、处理与公开 URL

对商品图片和设置/分类图片两条上传链分别检查：

- 单文件和总请求大小、文件数量、解析超时、内存峰值；
- MIME、扩展名、magic bytes、伪装文件；
- 超大像素/解压炸弹、畸形图片、Sharp 崩溃或耗尽 serverless 内存；
- SVG/HTML/脚本内容是否可能原样进入公开 bucket；
- Sharp 失败后是否安全，不能把未经验证的原文件直接公开；
- `name`、SKU、文件扩展名和 Storage path 是否可注入目录、异常字符或覆盖其他资源；
- 公共 bucket 自动创建/强制改 public 是否符合最小权限；
- 上传成功、数据库更新失败时的孤儿文件；数据库更新成功、删除失败时的残留；
- upsert、Gallery index、并发上传、Cache-Control 一年和 URL `?v=` 的一致性；
- 外部图片 URL、Next Image remotePatterns、错误域名回退和隐私风险。

### 8. AI、第三方 API 与成本滥用

覆盖公开 AI 导购、后台翻译、商品文案、Meta、图片生成：

- Feature 关闭后的 UI 和 API；
- 公开接口是否可被匿名刷量；进程内 IP Map 在 Vercel 上是否有效；
- IP 取值是否规范化，`x-forwarded-for` 多地址和伪造；
- message、measurements、productContext、产品数量和字段长度上限；
- 上游 fetch 的超时、AbortSignal、非 2xx、429、配额、JSON 解析和重试；
- 输出必须做严格 schema 校验，不能信任模型 JSON；
- 用户 Prompt、商品名、描述、材料、Store Settings 中的提示注入和数据外泄；
- 中文内部字段绝不能出现在顾客回复；
- 用户身高、体重、胸围、腰围、臀围等数据是否发送给第三方、是否有隐私披露、最小化和保留策略；
- 模型幻觉导致错误价格、库存、尺码、退货、配送或付款承诺；
- AI 返回的 SKU、URL、文本在前端渲染时的 XSS/链接安全；
- 每 IP、每会话、每日店铺预算、最大 token、并发和熔断；
- 无 API Key、上游故障和 Feature 配置故障时的安全降级。

### 9. 前台、国际化、SEO、Skroutz 与法律页面

- 希腊语/英语切换、URL、Cookie/localStorage、SSR/CSR hydration；
- 顾客页面不得泄露中文后台字段或内部备注；
- 首页、分类、详情、Contact、Privacy、Terms、Cookie、Refund、Return、Shipping、404、空数据和错误态；
- Metadata、canonical、Open Graph、sitemap、robots、动态商品 URL、重复内容；
- Feed XML 的转义、非法字符、UTF-8、价格/VAT、库存、URL、图片、测试 SKU、Feature 关闭、缓存和大数据量；
- Skroutz 字段和图片要求必须以实际规范/客户配置验证，不能只信本地文档；
- Cookie banner 是否真的阻止非必要 Cookie/第三方调用，而非只显示同意文案；
- Privacy/Terms 是否披露 Supabase、Vercel、DeepSeek/OpenAI、WhatsApp/Instagram/Maps 等第三方数据流；
- 法律信息草稿/发布版本、必填字段、版本历史和前台读取；
- 只做技术与合规缺口识别，涉及希腊/EU 法律结论时标记“需律师确认”，不要冒充法律意见。

### 10. UX、可访问性、响应式、打印与设备流程

- 键盘操作、焦点、ARIA、label、错误提示、对比度、触控目标、Loading/disabled；
- 手机、平板、桌面后台导航；
- POS 扫码枪快速输入、重复扫描、回车行为、网络延迟和误触；
- 关键破坏操作的确认、二次确认和可恢复性；
- 小票和标签打印 CSS、分页、尺寸、浏览器差异、缺字、条码清晰度；
- 现有大型 `components/admin-dashboard.tsx` 的状态耦合、重复请求、渲染性能、可测试性和回归风险；
- 空列表、慢网、Supabase 不可用、AI 不可用、Storage 不可用时的界面。

### 11. 性能、缓存与可运维性

- Server/Client Component 边界、bundle 体积、代码分割；
- N+1 查询、无界 `select('*')`、分页、过滤、排序和缺失索引；
- admin dashboard 在大商品量/Variant 量下的 O(n²) 操作；
- Serverless 函数时长、内存、Sharp、CSV、AI 和大型 JSON；
- `unstable_cache`、`revalidateTag`、`revalidatePath` 的一致性和失败行为；
- Supabase/AI/Storage 的超时、重试、熔断和用户可理解错误；
- 结构化日志、request/correlation ID、审计日志、告警和敏感信息脱敏；
- 当前 GitHub Actions 是否只有定时 smoke，而缺少 PR 上的 typecheck/build/test/security/migration 门禁；
- 依赖更新、锁文件、Node 版本、分支保护、Secret scanning、Dependabot/SAST；
- 备份、恢复演练、运行手册、回滚、Feature 回滚和数据库回滚。

## 六、必须设计或执行的对抗测试

至少覆盖以下场景；能安全执行就执行，否则给出精确脚本/步骤：

1. 未登录逐一扫描全部 `/api/admin/**` 方法。
2. readonly/staff/inventory/owner 四角色逐接口权限矩阵。
3. Feature Basic/Standard/Advanced/Custom 下直接调用所有受控 API。
4. 开发者 Cookie 缺失、伪造、过期、修改 nonce、修改 expiry、密码轮换后旧 Cookie。
5. 多实例/冷启动下登录和 AI 限流绕过模型。
6. 两个并发 checkout 抢最后一件库存。
7. 相同 idempotency key 并发请求、超时重试、不同 key 重复提交。
8. checkout 每一步故障注入和数据一致性查询。
9. checkout 与 void 并发、双重 void、void 后重试。
10. Quick Sell 并发扣减同一 SKU/尺码。
11. CSV 超大行数、同批重复 SKU、带换行/引号、公式注入、非法 size JSON。
12. 图片伪装 MIME、畸形图片、超大像素、小文件解压炸弹、多文件内存压力、恶意文件名/name。
13. AI Prompt injection、超长输入、恶意商品字段、上游非 JSON/429/500/超时。
14. Feed XML 特殊字符：`& < > " '`, 希腊语、Emoji、空字段、超长字段。
15. Europe/Athens 午夜和夏令时切换时的日报边界。
16. migration 空库、legacy 库、重复执行、失败中断、client-init 漂移。
17. 商品永久删除后订单历史、库存流水、图片和外键完整性。
18. 网络中断/刷新/双击下的 POS、库存调整、上传和保存。

## 七、严重级别定义

- `P0 / Critical`：无需认证的 service-role 能力、远程代码执行、秘密泄露、可批量破坏/读取所有客户数据、确定性严重资金/库存丢失。
- `P1 / High`：权限绕过、跨角色越权、可重复超卖/重复加库存、订单/支付/库存高概率不一致、生产默认路径不具事务性、所有客户共享敏感凭据。
- `P2 / Medium`：有限条件下的数据错误、成本滥用、DoS、隐私/合规缺口、重要功能故障、缺少关键恢复能力。
- `P3 / Low`：低影响 UX、可维护性、性能或防御纵深问题。
- `Info`：确认无直接缺陷，但应记录的设计限制或未来风险。

严重度必须结合可利用性、影响范围、发生概率、检测难度和恢复成本，不得只按理论分类。

## 八、最终输出格式

最终报告必须按以下顺序输出：

### 1. 审查快照

- 分支、HEAD、日期、环境；
- 已执行/未执行命令；
- 审查限制；
- 工作区是否有预存改动。

### 2. 上线结论

只能选择一个：

- `BLOCK`：不应商用上线；
- `CONDITIONAL GO`：满足列出的阻断条件后可上线；
- `GO`：未发现阻断问题，仍列出剩余风险。

给出不超过 10 条最关键理由。

### 3. 系统与信任边界图

用 Mermaid 或清晰文本画出：浏览器、Next.js/Vercel、Supabase anon/service-role/Auth/Storage/Postgres、DeepSeek/OpenAI、Skroutz、员工/owner/developer。

### 4. Top Risks

列出最重要的 10–20 个问题，按 P0→P3 排序。

### 5. 完整 Findings 表

每条使用以下字段：

- ID；
- 状态：CONFIRMED / HIGH-CONFIDENCE / HYPOTHESIS；
- 严重度；
- 类别；
- 标题；
- 证据 `path:line`；
- 受影响角色/Feature/数据；
- 攻击或故障场景；
- 业务影响；
- 精确复现；
- 根因；
- 最小修复；
- 理想修复；
- 回归测试；
- 修复依赖与风险。

### 6. 四张矩阵

- API 认证/权限/Feature 矩阵；
- Feature 四层覆盖矩阵；
- 数据一致性与写入入口矩阵；
- 测试覆盖与缺口矩阵。

### 7. 修复路线图

按以下批次排序，考虑依赖关系：

- `立即，0–24 小时`；
- `上线前必须完成`；
- `上线后 1–2 周`；
- `长期重构`。

每项给出预估工作量：S / M / L，并标明是否涉及数据库 migration、数据修复、环境变量、部署或客户操作。

### 8. Release Gates

至少给出可机器验证的门禁。建议包括但不限于：

- 全部 admin API 未认证扫描无旁路；
- 角色权限矩阵通过；
- Feature 四层矩阵通过；
- 生产 POS 使用已验证的事务 RPC，或 POS 功能保持禁用；
- checkout/void 并发与故障注入通过；
- Quick Sell/库存调整无 lost update；
- RLS/grants/security-definer 审查通过；
- 每客户开发者凭据唯一且可轮换；
- migration、client-init 和 legacy upgrade 三条路径通过；
- ERP reconciliation 和 POS health 为 0；
- typecheck、build、lint、unit、integration、E2E、security checks 进入 PR CI；
- 恢复演练通过。

### 9. 未执行与未知项

明确列出缺少哪些账号、变量、测试库、Docker、浏览器、第三方配额或真实硬件，并说明如何补齐。不得把未执行写成通过。

### 10. 下一步补丁计划

只给出按文件排序的补丁计划和测试计划，**暂时不要修改代码**。优先修复 P0/P1，再处理 P2/P3。

## 九、特别关注的项目级风险假设

以下只是必须验证的假设，不得直接当作结论：

- `USE_POS_RPC=false` 时 POS 多步写入可能留下半完成订单和人工对账状态；
- Quick Sell 的读-改-写可能在并发下 lost update；
- migration 预置固定 developer password hash 可能导致跨客户共享凭据；
- Vercel 上进程内 `Map` 限流可能被冷启动和多实例绕过；
- Feature 缓存可能造成前台、后台和 API 短时间不同步；
- 设置/分类上传接口可能存在无界文件、MIME 伪装、Path/name 和 Sharp fallback 风险；
- 公开 AI 接口可能存在成本滥用、Prompt injection、PII 外发和上游异常处理不足；
- CSV 导出可能存在公式注入，CSV 导入可能存在部分成功后 ERP 不一致；
- 当前安全响应头、PR CI、单元/集成测试和完整恢复演练可能不足；
- 超大型 AdminDashboard 可能产生状态耦合、重复请求、难以测试和高回归风险。

请现在开始。先输出审查快照和系统地图，然后继续执行检查，不要只给计划。
