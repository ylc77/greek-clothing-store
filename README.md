# Fashion Boutique 服装店系统

面向希腊服装零售店的双语网站与后台系统，包含商品展示、库存、POS、Skroutz Feed、员工权限、法律页面和客户版本控制。

## 新客户快速部署

> 目标：创建 Supabase → 执行一次 SQL → 部署 Vercel → 填写店铺资料。

客户电脑不需要安装 Docker、Supabase CLI 或项目源码。网站运行在 Vercel，数据库运行在 Supabase；部署可以在你自己的电脑或任何有仓库和账号权限的电脑完成。客户日常只需要浏览器。

只有本地打印助手或未来自托管服务才需要在客户电脑安装程序。

### 一、创建 Supabase 项目

1. 登录 [Supabase](https://supabase.com/dashboard)。
2. 点击 **New project**。
3. 填写客户项目名称，例如 `clothing-client-athens`。
4. 设置数据库密码并保存到密码管理器。
5. 选择离客户较近的区域。
6. 等待项目创建完成。

建议每个客户使用独立 Supabase 项目，避免不同客户的数据混在一起。

### 二、一键初始化数据库

1. 在 Supabase Dashboard 打开 **SQL Editor → New query**。
2. 打开仓库中的 `supabase/client-init.sql`。
3. 全选并复制到 SQL Editor。
4. 点击 **Run**。
5. 等待执行完成，确认没有红色错误。

重要说明：

- `supabase/client-init.sql` 已包含当前完整表结构、bigint 商品 ID、RLS、RPC、Storage bucket、默认分类、ERP、POS、管理员、客户版本和 Legal Settings。
- 它只用于全新的空 Supabase 项目。
- 不要在已有客户数据的数据库重复执行。
- 新客户不需要手动逐个执行 `supabase/migrations`。
- 执行完成后 `developer_access` 保持空表，店铺设置、法律设置和版本功能写入会安全拒绝；模板不会自动提供默认开发者密码。

### 三、复制 Supabase 配置

在 Supabase 项目的 **Connect** 或 **Settings → API Keys** 页面复制：

- Project URL
- Publishable key 或 legacy `anon` key
- Legacy `service_role` key

当前代码的服务端变量名是 `SUPABASE_SERVICE_ROLE_KEY`，部署时优先填写 legacy `service_role` key。

安全规则：

- Publishable / `anon` key 可用于 `NEXT_PUBLIC_SUPABASE_ANON_KEY`。
- `service_role` 只能放在 Vercel 服务端环境变量中。
- `service_role` 绝不能使用 `NEXT_PUBLIC_` 前缀。
- 不要把 `service_role` 写入 Git、README、截图、聊天记录或前端代码。

### 四、初始化该客户专属的开发者凭据

这一步由维护者在自己的项目目录执行，不需要客户电脑参与。先把该客户的 Supabase URL 和 service role/secret key 放入本机、已被 Git 忽略的 `.env.local`，然后确认 URL 中的 project ref，例如 `https://abcdefgh.supabase.co` 的 ref 是 `abcdefgh`。

```powershell
npm run developer:status -- --project-ref abcdefgh
npm run developer:bootstrap -- --project-ref abcdefgh
```

CLI 会显示目标 project ref，并要求再次输入确认；随后为该客户生成独立随机 salt、hash 和 credential version。随机密码只显示一次，立即保存到维护者密码管理器。再次执行 bootstrap 会被拒绝，不会覆盖已有凭据。

如果需要输入自己生成的高强度密码，使用 `--password-stdin`，不要把密码作为普通命令行参数。开发者明文密码不得写入 PostgreSQL、`.env.local`、Vercel、Git、浏览器存储、截图、聊天记录或日志。

### 五、部署到 Vercel

1. 登录 [Vercel](https://vercel.com)。
2. 点击 **Add New → Project**。
3. 导入本 GitHub 仓库。
4. Framework Preset 使用 **Next.js**。
5. 添加以下环境变量：

```env
NEXT_PUBLIC_SITE_URL=https://你的域名.vercel.app
NEXT_PUBLIC_SUPABASE_URL=https://你的项目.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=你的-publishable-或-anon-key
SUPABASE_SERVICE_ROLE_KEY=你的-service-role-key
ADMIN_PASSWORD=设置一个强密码
USE_POS_RPC=true
USE_PRODUCT_RPC=true
USE_CSV_IMPORT_RPC=true
```

POS 使用前必须确认数据库已包含以下事务 RPC migrations（新客户的 `client-init.sql` 已自动包含）：

- `20260705000100_add_pos_rpc_functions.sql`
- `20260715100000_harden_pos_checkout_rpc.sql`
- `20260715100001_reconcile_pos_void_rpc.sql`

`USE_POS_RPC=true` 是正式运行的必需配置。若配置不是 `true`、migration 未部署、函数缺失或 `service_role` 无执行权限，后台会显示红色阻断提示，checkout / void API 返回 503，并且不会创建订单、付款、库存变化或库存流水。系统不会自动回退到非事务 JavaScript 多步写入。

库存调整和“快速售出”还必须包含 `20260715102000_transactional_inventory_operations.sql`。这两个正式写入入口只调用 `inventory_apply_rpc`：库存余额、库存流水、幂等记录和兼容的 `products.stock` / `products.size_stock` 投影在同一个数据库事务内完成。RPC 缺失、不可执行或不可用时 API 返回 503，不会回退到前端或服务端多步写入。

商品新增和编辑还必须包含 `20260715143949_transactional_product_operations.sql`，并设置 `USE_PRODUCT_RPC=true`。正式商品写入只允许调用事务 RPC；配置不是 `true`、migration 未部署、函数无执行权限或 RPC 不可用时，商品 API 返回 503，不会创建或部分修改商品、Variant、库存余额、库存流水。系统不会回退到历史 JavaScript 多步双写。

CSV 导入还必须包含 `20260716100000_transactional_csv_import_jobs.sql`，并同时设置 `USE_PRODUCT_RPC=true` 与 `USE_CSV_IMPORT_RPC=true`。配置、migration、RPC 执行权限或服务不可用时，导入 API 返回 503，且不会回退到直接写表或 Node.js 多步 upsert。

CSV 会先完成整份文件预检，再建立可恢复的持久 Job，并按行事务提交。商品模式必须显式选择 `create_only`（默认，仅新增）、`update_existing`（仅更新）或 `upsert`（新增或更新）；库存模式必须选择 `metadata_only`（不改库存）或 `set_inventory`（明确按盘点数量设置库存）。可选翻译发生在最终预览和提交之前，不在数据库事务内调用。网络中断或刷新后应恢复原 Job；失败行可以下载并安全重试，成功行不会重复执行。

当前按小型服装店和 Vercel 请求边界设置为：最大 1 MiB、500 行、100 列、单 Cell 32 KiB、每商品最多 20 个图片 URL 和 100 个尺码。超过限制会在建立 Job 前明确拒绝，应拆分文件，不会先尝试写入再超时。

`inventory_balances` 是库存数量的权威来源；`products.stock` 和 `products.size_stock` 只是在同一数据库事务内更新的旧页面兼容投影，不能作为独立库存写入入口。商品图片上传/删除和商品永久删除不属于本批事务边界。

“快速售出”是仅限 owner 的快速扣库存工具，适合店主临时登记一件已售商品；它不会创建 POS 订单、订单明细或付款记录，也不能代替正常 POS 扫码结账。店员应使用 POS 扫码流程，不能直接调用快速售出 API。

`ADMIN_PASSWORD` 是仅供维护者使用的服务器端紧急 owner 密码，每个客户建议设置不同值，不要告诉购买系统的商家。商家日常使用通过 Supabase Auth 创建的员工账号，不使用这个环境变量密码。

店铺设置、法律设置和客户版本功能使用刚才 bootstrap 生成的独立开发者密码。Vercel 环境变量中不配置该明文；数据库只保存不可逆 scrypt hash 和会话失效版本。

如果希望商家始终无法自行修改这些内容，Supabase / Vercel 项目所有权、`service_role`、源码仓库写权限也应由维护者保管。拥有这些基础设施最高权限的人始终可以直接修改数据库或代码，应用内密码无法限制基础设施所有者。

可选 AI 功能：

```env
DEEPSEEK_API_KEY=
DEEPSEEK_TRANSLATION_MODEL=deepseek-chat
OPENAI_API_KEY=
OPENAI_IMAGE_MODEL=gpt-image-2
```

AI 模特图默认使用最多两张真实商品参考图，通过 GPT Image 2 生成 `1024×1536` 竖版、`medium` 品质、WebP 85% 压缩的图片。服务端会在上传 Storage 前校验格式和尺寸，不符合标准的结果不会写入商品多图。

6. 点击 **Deploy**。
7. 部署完成后打开正式网址。
8. 如果绑定了自定义域名，把 `NEXT_PUBLIC_SITE_URL` 改为最终域名并重新部署一次。

### 六、首次后台配置

1. 打开 `https://你的域名/admin`。
2. 维护者使用 `ADMIN_PASSWORD` 登录，并为商家创建所需的员工账号；不要把紧急 owner 密码交给商家。
3. 进入 **店铺设置**，再用维护者专属的开发者密码解锁，填写店铺名称、地址、电话、营业时间和联系方式。
4. 上传 Logo 和首页图片。
5. 设置 WhatsApp、Instagram、Google Maps 和 Skroutz。
6. 添加商品或通过 CSV 导入商品。
7. 进入 **Settings → Legal Settings**，使用同一个开发者密码解锁，填写商家法律信息并发布 `v1`。
8. 根据客户购买内容选择 Basic、Standard 或 Advanced。

当前三档版本：

- **Basic 基础版**：双语前台、商品 / 图片 / 分类 / 供货商、尺码库存快查、库存作业、调整、流水和对账。
- **Standard 标准版（推荐实体店）**：包含基础版，并增加 POS 扫码扣库存、销售记录与作废恢复、日报、销售记录小票、条码标签、CSV 导入和员工账号。
- **Advanced 高级版**：包含标准版，并增加 Skroutz Feed 与前台入口、AI 商品 / 图片 / 导购工具和维护数据导出。

POS 模块只负责系统内扫码销售记录和库存同步，不代替真实收银机、银行 POS、税务小票或 myDATA。

### 七、上线检查

前台：

- [ ] 首页、分类页和商品详情页可以打开。
- [ ] 希腊语 / 英语切换正常。
- [ ] Logo、首页图片和商品图片正常显示。
- [ ] WhatsApp、Instagram 和地图链接正确。
- [ ] Privacy、Terms、Cookie、Contact、Refund、Return、Shipping 页面可以打开。
- [ ] `/feed.xml` 按客户版本正常输出或关闭。

后台：

- [ ] 后台可以登录。
- [ ] `npm run developer:status -- --project-ref 客户项目ref` 显示 `Initialized: true`、`Must rotate: false`。
- [ ] 商家员工账号不能进入或修改店铺设置、法律设置。
- [ ] 维护者开发者密码可以解锁店铺设置和法律设置，退出或关闭浏览器后需要重新解锁。
- [ ] 可以新增、编辑和下架商品。
- [ ] 可以上传、替换和删除商品图片。
- [ ] Logo 和首页图上传正常。
- [ ] 库存、POS、条码、CSV 和员工权限按客户版本正常。
- [ ] Legal Settings 已完成并发布正式版本。

Supabase Storage：

- [ ] `product-images` bucket 存在。
- [ ] 前台公开图片可以访问。
- [ ] 普通访客不能任意上传、修改或删除图片。
- [ ] 后台服务端可以上传、替换和删除图片。

## 常见问题

### 客户电脑需要安装项目吗？

不需要。Vercel 和 Supabase 都是云服务，客户电脑只需浏览器。你可以在自己的电脑完成所有客户部署。

### 每个客户都要重新设计数据库吗？

不需要。每个新客户都执行同一份 `supabase/client-init.sql`，然后填写该客户的环境变量和后台资料。

### 可以对已有客户执行 client-init.sql 吗？

不可以。`supabase/migrations` 是已有客户升级的权威来源；只有部署说明明确指定时才使用专用 patch，避免破坏数据。

当前事务 migrations 已按依赖关系使用单调递增时间戳：POS checkout、POS void、事务库存、开发者凭据、商品事务、CSV Job。已有客户先备份并确认链接的 project ref，再运行 `db push --dry-run` 检查只包含预期 migrations，最后执行 `db push`；不要执行 `client-init.sql`，也不要手工修改 migration history。升级代码部署时同时设置 `USE_PRODUCT_RPC=true` 和 `USE_CSV_IMPORT_RPC=true`。

### 图片上传失败怎么办？

检查 `product-images` bucket、Vercel 的 `SUPABASE_SERVICE_ROLE_KEY`、文件类型和大小。数据库初始化成功不代表 Storage 上传一定已经验收。

### 开发者密码丢失或需要轮换怎么办？

只要维护者仍持有该客户的 service role/secret key，就在自己的客户项目目录运行：

```powershell
npm run developer:status -- --project-ref abcdefgh
npm run developer:rotate -- --project-ref abcdefgh
```

轮换成功后旧密码和所有旧开发者 Cookie 立即失效。不要新增公开重置接口，也不要通过邮件或聊天发送开发者密码。建议至少每年轮换一次；维护人员变化、疑似泄露或客户基础设施转移时立即轮换。

如果客户项目正式移交给另一位维护者，应先轮换开发者凭据，再移交 Supabase/Vercel/仓库权限，并撤销旧维护者的 service role/secret key 和账号访问。普通商家 owner 不获得开发者密码或 service role。

## 开发维护说明

以下内容只给维护者使用，新客户部署不需要理解。

- `supabase/migrations` 是数据库开发和升级的权威来源。
- `supabase/client-init.sql` 是根据 migrations 生成的新客户空库部署快照。
- POS checkout / void 正式写入只允许调用事务 RPC；`USE_POS_RPC=false` 仅作为阻断 POS 写入的紧急开关，不是非事务 fallback。
- 库存调整和快速售出正式写入只允许调用 `inventory_apply_rpc`；每次用户操作必须保留同一个业务 ID，超时或响应丢失后的重试必须复用该 ID。
- 快速售出是 owner-only 的库存工具，不产生 POS 订单或付款；需要销售记录时必须使用 POS 扫码结账。
- 商品新增和编辑正式写入只允许调用商品事务 RPC，并要求 `USE_PRODUCT_RPC=true`；RPC 不可用时必须返回 503，不能恢复 Node.js 多步写入。
- CSV 导入要求 `USE_CSV_IMPORT_RPC=true` 和 `20260716100000_transactional_csv_import_jobs.sql`；整份文件先预检，行内商品、Variant、余额、流水、兼容投影和结果记录必须一起提交或回滚，RPC 不可用时禁止 fallback。
- CSV 的 `create_only` / `update_existing` / `upsert` 与 `metadata_only` / `set_inventory` 必须由用户显式选择；外部翻译只在提交前执行，最终 payload 冻结后再计算 fingerprint。
- 商品库存以 `inventory_balances` 为权威，`products.stock` / `products.size_stock` 只允许作为事务内兼容投影。图片操作和永久删除仍在本批事务边界之外。
- 后台“导出 CSV”只是完整的商品资料导出，不是 PostgreSQL 灾难恢复备份；数据库备份与恢复仍需单独执行和演练。
- `public.developer_access` 空表表示未初始化；有记录时只保存 scrypt hash、随机 credential version、整数 password version 和轮换时间，不保存明文。
- 新客户运行 `npm run developer:bootstrap -- --project-ref ...`；已有客户升级后统一进入 `must_rotate`，运行 `npm run developer:rotate -- --project-ref ...` 才能重新访问受保护设置。
- 店铺设置和法律设置不能改回普通 owner/员工权限；相关 API 必须继续要求开发者会话。
- 新增或修改 migration 后，运行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-client-init.ps1
npx supabase db reset --local --no-seed
```

- `client-init.sql` 和完整 migration 链都必须能在空库执行。
- 本地 Supabase 端口以 `supabase/config.toml` 为准；不要停止其他项目的容器来抢占端口。
- `supabase/client-init.sql` 不用于已有客户升级。

## 常用开发命令

```powershell
npm install
npm run dev -- --port 3010
npm run typecheck
npm run build
npm run test:pos
npm run test:inventory
npm run test:inventory-install-paths
npm run test:developer
npm run test:developer-install-paths
npm run check:site
npm run check:skroutz
```

## 相关文档

- `docs/client-guide-zh.md`
- `docs/maintenance-zh.md`
- `docs/launch-checklist-zh.md`
- `docs/feature-tier-acceptance-checklist.md`
