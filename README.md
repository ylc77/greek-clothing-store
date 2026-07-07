# Fashion Boutique 服装店系统

这是一个面向希腊服装零售店的可复用网站与库存管理系统，包含双语商品展示、后台商品管理、ERP 库存、POS、Skroutz XML Feed、员工权限和可配置客户版本。

## 主要功能

- 前台希腊语 / 英语切换
- 首页、分类页、商品详情页和多图展示
- 商品、分类、尺码、颜色、价格与库存管理
- ERP 库存、库存流水与对账
- POS 收银、订单、日报、小票与条码标签
- CSV 批量导入
- Skroutz XML Feed：`/feed.xml`
- 店铺资料、Logo、首页图片与法律页面配置
- Supabase Auth 员工账号与角色权限
- Basic / Standard / Advanced / Custom 功能版本
- 可选 DeepSeek 翻译、AI 导购和 OpenAI 商品造型图

技术栈：Next.js 15、React 19、TypeScript、Tailwind CSS、Supabase、Sharp、Vercel。

## 新客户部署方式

本项目采用轻量 migration 工作流。`supabase/migrations/20260702000000_baseline_store_schema.sql` 负责空库基础结构，后续 migration 依次增加 ERP、POS、管理员、客户版本和 Legal Settings。

所有 Supabase CLI 命令必须在当前客户部署所使用的项目根目录执行，并确认该目录包含 `supabase/migrations`。执行任何 link 或 push 前先运行：

```bash
pwd
git status
ls supabase/migrations
```

必须确认：

- 当前目录是本项目根目录。
- `git status` 没有无法解释的异常改动。
- `supabase/migrations` 目录存在。
- 能看到 baseline 以及后续 ERP、POS、admin、feature settings、legal settings migrations。

不要在错误目录执行 `npx supabase link`、`npx supabase db push --dry-run` 或 `npx supabase db push`。

新客户不需要手动拼接 SQL，标准流程只有：

```powershell
npx supabase link --project-ref <客户项目-ref>
npx supabase db push --dry-run
npx supabase db push
```

基础 migration 已通过一次本地 `npx supabase db reset` 空库验证。`supabase/client-init.sql` 仅保留为历史备用文件，不是正式长期部署入口，也不要与 migration 流程混用。

## 1. 部署前准备

准备以下账号和资料：

- GitHub、GitLab 或 Bitbucket 仓库访问权限
- Supabase 账号和一个新项目的创建权限
- Vercel 账号和项目创建权限
- Node.js 20 或更高版本
- npm
- 店铺名称、Logo、首页图片、地址、电话、WhatsApp、Instagram、营业时间
- 希腊公司法定名称、VAT、GEMI、联系邮箱和隐私政策资料
- 可选：DeepSeek API Key、OpenAI API Key

首次操作前确认工作目录：

```powershell
git status
node --version
npm --version
```

安装依赖并完成基础检查：

```powershell
npm install
npm run typecheck
npm run build
```

## 2. 创建 Supabase 项目

1. 登录 [Supabase Dashboard](https://supabase.com/dashboard)。
2. 新建项目，选择客户所属组织、区域和数据库密码。
3. 保存数据库密码到密码管理器，不要写入仓库、README、聊天记录或截图。
4. 打开项目的 **Connect** 或 **Settings → API Keys** 页面。
5. 记录以下内容：
   - Project URL，例如 `https://xxxx.supabase.co`
   - Publishable key；旧项目也可使用 legacy `anon` key
   - Secret key；旧项目也可使用 legacy `service_role` key

当前应用的服务端环境变量名仍是 `SUPABASE_SERVICE_ROLE_KEY`，新客户部署时优先填写 legacy `service_role` key。如需改用新的 Secret key，必须先在独立测试环境验证：

- 服务端 Supabase admin client 初始化正常。
- 后台商品新增、编辑、删除正常。
- 图片上传、替换、删除正常。
- 库存 / ERP 操作正常。
- POS 相关 RPC 正常。
- 员工账号相关功能正常。
- Feed 生成正常。

安全规则：

- Publishable / `anon` key 可以提供给浏览器，但公开表必须正确启用 RLS 和访问策略。
- Secret / `service_role` key 会绕过 RLS，只能放在 Vercel 服务端环境变量中。
- Secret / `service_role` key 绝不能使用 `NEXT_PUBLIC_` 前缀。
- Secret / `service_role` key 绝不能提交到 Git。
- Secret / `service_role` key 绝不能写入 README、截图、聊天记录或前端代码。

Supabase 官方参考：[API Keys](https://supabase.com/docs/guides/getting-started/api-keys)、[Database Migrations](https://supabase.com/docs/guides/deployment/database-migrations)。

## 3. 初始化 Supabase 数据库

### 3.1 轻量 CLI 部署

Supabase CLI 通过 npm 运行时要求 Node.js 20 或更高版本。先查看当前命令帮助，不要凭旧文档猜测参数：

```powershell
npx supabase --help
npx supabase db push --help
npx supabase migration list --help
```

登录并关联刚创建的客户项目：

```powershell
npx supabase login
npx supabase link --project-ref <客户项目-ref>
```

先确认关联的项目名称和 ref，确保不是其他客户或测试项目。随后查看待执行内容：

```powershell
npx supabase migration list
npx supabase db push --dry-run
```

只有在项目身份与 SQL 列表都确认无误后才执行：

```powershell
npx supabase db push
```

迁移按文件名时间顺序执行：

1. `20260702000000_baseline_store_schema.sql`
2. `20260703_add_erp_inventory_phase_1.sql`
3. `20260704_add_pos_phase_1_tables.sql`
4. `20260705000100_add_pos_rpc_functions.sql`
5. `20260705000200_add_admin_users.sql`
6. `20260707000100_add_feature_settings.sql`
7. `20260707105854_add_legal_settings.sql`

不要在成功采用 migration 工作流后再直接通过远程 SQL Editor 或 Table Editor 修改 schema，否则 migration 历史可能失去同步。

### 3.2 维护者空库验证

只有新增或修改 migration 时才需要本地验证，不是每次给客户部署都要重复设计数据库：

```powershell
npx supabase start
npx supabase db reset --local --no-seed
```

本仓库如已在 `supabase/config.toml` 中配置独立 5532x 本地端口，应优先使用该配置，避免与其他 Supabase 项目占用默认端口。执行 `npx supabase start` 前，需要确认 Docker Desktop 正常运行。

本地空库验证前先检查：

```bash
cat supabase/config.toml
docker ps --format "table {{.Names}}\t{{.Ports}}"
```

确认：

- 本地 db port 是否与其他项目冲突。
- Studio port 是否与其他项目冲突。
- API port 是否与其他项目冲突。
- Docker Desktop 当前是否正在运行其他 Supabase 项目，例如 `huaren_life_plus`、`restaurant` 或 `clothing_web`。

如果端口冲突，不要强行启动、停止或修改其他项目；只调整当前仓库的 `supabase/config.toml`，并在 `AGENTS.md` 中记录端口约定。

### 3.3 数据库检查

至少验证：

- 所有 migration 均显示为已执行。
- `products.id` 为 `bigint`。
- `product_variants.product_id` 为 `bigint`，并正确引用 `products.id`。
- `MAIN_STORE` 库存位置存在。
- `admin_users` 和 `feature_settings` 已启用 RLS。
- `feature_settings` 只有 `id = 1` 的一行，默认版本为 `advanced`。
- `anon` / `authenticated` 不能读取后台专用表。
- `service_role` 能执行应用需要的后台操作。

仓库内可参考的只读检查：

- `supabase/erp-phase-1-production-readonly-checks.sql`
- `supabase/erp-phase-1-reconciliation-checks.sql`
- `supabase/pos-phase-1-production-readonly-checks.sql`
- `supabase/pos-phase-1e-production-readonly-checks.sql`
- `supabase/pos-runtime-health-checks.sql`
- `supabase/feature-settings-readonly-checks.sql`

这些检查应在 Supabase SQL Editor 中逐段执行并阅读结果，不要只看“查询成功”。

### 3.4 Supabase Storage 验证

数据库 migrations 跑通不等于图片系统一定可用。新客户部署必须单独验收 Supabase Storage：

- 商品图片 bucket 存在。
- Logo / 首页图使用的 bucket 或路径存在。
- 前台公开图片可以正常访问。
- 后台可以上传商品图片。
- 后台可以替换商品图片。
- 后台可以删除商品图片。
- Logo 上传和首页图上传正常。
- Storage policies 不允许 `anon` / `authenticated` 任意写入或删除。
- `service_role` 或服务端后台流程具备必要的上传、更新、删除能力。

## 4. 配置本地环境变量

复制模板：

```powershell
Copy-Item .env.example .env.local
```

填写必要变量：

```env
NEXT_PUBLIC_SITE_URL=http://localhost:3010
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable-key-or-legacy-anon-key>

ADMIN_PASSWORD=<强随机 owner 应急密码>
SUPABASE_SERVICE_ROLE_KEY=<secret-key-or-legacy-service-role-key>

USE_POS_RPC=false
```

可选变量：

```env
ADMIN_STAFF_PASSWORD=
ADMIN_INVENTORY_PASSWORD=
ADMIN_READONLY_PASSWORD=

DEEPSEEK_API_KEY=
DEEPSEEK_TRANSLATION_MODEL=deepseek-chat

OPENAI_API_KEY=
OPENAI_IMAGE_MODEL=gpt-image-1
```

法律页面变量请完整查看 `.env.example`。正式上线前至少填写企业名称、地址、VAT、GEMI、联系邮箱、电话、数据控制者、数据处理商和最后更新日期。

注意：

- `.env.local` 不得提交到 Git。
- `ADMIN_PASSWORD` 应使用密码管理器生成，并只作为 owner 应急入口。
- 正式员工优先使用 Supabase Auth + `public.admin_users`，不要共享 owner 密码。
- `USE_POS_RPC` 初次部署保持 `false`，通过测试项目和 POS 健康检查后再评估开启。
- 本机端口 `3000` 可能属于其他项目，本仓库使用显式端口 `3010` 验证。

## 5. 本地验证

启动应用：

```powershell
npm run dev -- --port 3010
```

打开：

- `http://localhost:3010`
- `http://localhost:3010/admin`
- `http://localhost:3010/admin/settings`
- `http://localhost:3010/feed.xml`

然后执行：

```powershell
npm run typecheck
npm run build
$env:BASE_URL='http://localhost:3010'
$env:ADMIN_PASSWORD='<本地测试密码>'
npm run check:site
```

不要仅根据端口响应判断验证成功；必须确认页面标题、店铺内容和项目身份确实属于本仓库。

## 6. 创建并关联 Vercel 项目

### 6.1 Dashboard 方式

1. 登录 [Vercel](https://vercel.com)。
2. 选择 **Add New → Project**。
3. 导入本仓库。
4. Framework Preset 选择或自动识别为 **Next.js**。
5. Root Directory 保持仓库根目录。
6. Build Command 使用 `npm run build`，Install Command 使用 `npm install`。
7. 暂时不要点击正式交付；先配置下一节环境变量。

### 6.2 CLI 方式

如本机没有全局 Vercel CLI，可以使用 `npx vercel@latest`。先登录并确认账号：

```powershell
npx vercel@latest login
npx vercel@latest whoami
npx vercel@latest link
```

关联完成后检查 `.vercel/project.json` 中的项目名是否属于当前客户。该目录是本地关联信息，不应作为跨客户模板复制。

Vercel 官方参考：[Git 部署](https://vercel.com/docs/git)、[环境变量](https://vercel.com/docs/environment-variables)。

## 7. 配置 Vercel 环境变量

在 **Project → Settings → Environment Variables** 添加 `.env.example` 中适用的变量。

必须添加到 Production：

- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `ADMIN_PASSWORD`
- `SUPABASE_SERVICE_ROLE_KEY`
- `USE_POS_RPC=false`
- 所有已填写的法律页面变量

按功能添加：

- DeepSeek：`DEEPSEEK_API_KEY`、`DEEPSEEK_TRANSLATION_MODEL`
- OpenAI 图片：`OPENAI_API_KEY`、`OPENAI_IMAGE_MODEL`
- 角色应急密码：`ADMIN_STAFF_PASSWORD`、`ADMIN_INVENTORY_PASSWORD`、`ADMIN_READONLY_PASSWORD`

环境范围建议：

- **Production**：客户正式 Supabase 项目和正式密钥。
- **Preview**：专用测试 Supabase 项目，禁止连接其他客户的正式数据库。
- **Development**：本地或专用开发项目。

第一次部署时还没有最终域名，可先使用 Vercel 预计域名；部署成功后把 `NEXT_PUBLIC_SITE_URL` 改为最终正式域名，并重新部署。环境变量修改不会自动改变已经生成的旧部署。

CLI 拉取 Development 环境变量：

```powershell
npx vercel@latest env pull .env.local --yes
```

拉取后只检查变量名是否齐全，不要在终端、截图或工单中输出密钥值。

## 8. 部署到 Vercel

推荐使用 Git 集成：

1. 向非生产分支推送，Vercel 自动创建 Preview。
2. 在 Preview 完成页面、API 和数据验证。
3. 合并到生产分支，Vercel 自动创建 Production 部署。

也可以使用 CLI：

```powershell
# Preview
npx vercel@latest

# Production
npx vercel@latest --prod
```

检查部署状态：

```powershell
npx vercel@latest ls --yes
npx vercel@latest inspect <deployment-url>
```

必须确认：

- Status 为 `Ready`。
- Target 为 `production`。
- Git commit 是预期提交。
- 正式 alias 指向该部署。
- 页面不是 Vercel Authentication 或访问保护登录页。

## 9. 首次后台配置

1. 打开 `https://<正式域名>/admin`。
2. 使用 `ADMIN_PASSWORD` 登录 owner 应急入口。
3. 进入店铺设置，填写店名、Logo、首页图片、地址、营业时间和联系方式。
4. 设置 WhatsApp、Instagram、Google Maps 和 Skroutz 信息。
5. 在版本配置中选择客户购买的 Basic、Standard 或 Advanced，并保存。
6. 创建 Supabase Auth 员工账号。
7. 将 Auth 用户的 UUID、邮箱、角色和启用状态写入 `public.admin_users`；角色只能是 `owner`、`staff`、`inventory`、`readonly`。
8. 使用每个员工账号分别登录，确认权限边界正确。

首次上传 Logo 或商品图片时，服务端会检查并创建公开的 `product-images` Storage bucket。上传后仍需在 Supabase Storage 中确认 bucket 存在、文件可访问，并确认没有把服务端密钥暴露给浏览器。

## 10. 上线验收

### 前台

- [ ] 首页 HTTP 200，页面不是空白或其他项目。
- [ ] 希腊语和英语切换正常。
- [ ] 至少一个分类页和一个商品详情页正常。
- [ ] Logo、首页图片和商品图片正常加载。
- [ ] 价格、库存状态、尺码和颜色正确。
- [ ] WhatsApp、Instagram、Google Maps 链接已替换。
- [ ] 法律页面资料完整。
- [ ] `/sitemap.xml` 正常。
- [ ] 客户版本启用 Skroutz 时 `/feed.xml` 返回 XML；未启用时按预期返回 404。

### 后台与权限

- [ ] `/admin` 和 `/admin/settings` 正常显示登录界面。
- [ ] 未登录访问 `/api/admin/features` 返回 HTTP 401，而不是平台登录页的 200。
- [ ] owner 可以读取和保存版本配置。
- [ ] 非 owner 员工不能修改版本配置。
- [ ] 被版本关闭的功能不显示入口，直接调用对应 API 返回 403。
- [ ] 可以新增、编辑、下架商品并上传图片。
- [ ] CSV 导入、库存、POS、条码、AI、备份按客户版本正确启用或禁用。

### 数据库与业务

- [ ] ERP 对账结果为 0 异常。
- [ ] POS runtime health check 为 0 异常。
- [ ] POS checkout dry run 成功。
- [ ] 测试订单、作废、日报和库存流水一致。
- [ ] 关闭再开启功能不会删除历史数据。
- [ ] Supabase Security Advisor 中的发现已逐项审阅。
- [ ] 已记录 Supabase project ref、Vercel project、正式域名、当前 commit 和回滚方式。

三个客户版本的详细验收见 `docs/feature-tier-acceptance-checklist.md`。

## 11. 自定义域名与重新部署

1. 在 Vercel **Project → Settings → Domains** 添加客户域名。
2. 按 Vercel 提示配置 DNS。
3. 等待证书和域名状态正常。
4. 将 `NEXT_PUBLIC_SITE_URL` 更新为 `https://<客户域名>`。
5. 重新触发 Production 部署。
6. 使用客户域名重新执行完整 smoke test。

## 12. 回滚与故障处理

### Vercel 回滚

如果新版本发生应用故障，可在 Vercel Dashboard 将 alias 回滚到上一个已验证部署，或先查看 CLI 当前支持的回滚参数：

```powershell
npx vercel@latest rollback --help
```

回滚应用不会自动回滚 Supabase schema。

### Supabase 故障

- migration 失败后立即停止，不要反复执行未知 SQL。
- 先运行 `npx supabase migration list` 检查本地和远程历史。
- 不要在不理解后果时运行 `migration repair`。
- schema 回滚必须通过新的、经过审阅的 migration 完成。
- 涉及数据恢复时，先确认备份和恢复点，再进行操作。

### 常见问题

- **Vercel 构建成功但页面无数据**：检查三个 Supabase 环境变量是否属于同一个客户项目。
- **后台 API 返回 500**：检查 `SUPABASE_SERVICE_ROLE_KEY` 是否只配置在服务端环境。
- **图片上传失败**：检查 `product-images` bucket、文件类型和大小。
- **Preview 修改了正式数据**：Preview 错误连接了 Production Supabase；立即停止测试并更换为专用测试项目。
- **本地打开了错误网站**：端口 3000 被其他项目占用；改用 3010 并确认页面身份。
- **Supabase CLI 报环境变量名含异常字符**：检查 `.env.local` 是否带 UTF-8 BOM；CLI 运行前应移除 BOM，但不要输出或提交密钥。
- **默认 5432x 端口被占用**：先检查当前 `supabase/config.toml`；如果其中已配置独立 5532x 端口，则使用该配置，不要停止其他项目。
- **`db push` 失败**：先检查 `supabase migration list` 和 dry-run 输出；不要改用 `client-init.sql` 拼接结构。

## 13. 日常发布流程

1. 在独立分支开发。
2. 数据库变化先创建 migration，并在空本地库和测试项目验证。
3. 运行 `npm run typecheck`、`npm run build` 和相关 smoke test。
4. 推送 Preview 并完成验收。
5. 由一名负责人执行数据库 migration。
6. migration 验证通过后再发布或 promote 对应应用版本。
7. 检查正式域名、API、Vercel 日志和 Supabase 健康状态。
8. 记录 commit、deployment URL、migration 和验收结果。

## 常用命令

```powershell
npm install
npm run dev -- --port 3010
npm run typecheck
npm run build
npm run check:site
npm run check:skroutz

npx supabase --help
npx supabase migration list
npx supabase db push --dry-run

npx vercel@latest whoami
npx vercel@latest link
npx vercel@latest env pull .env.local --yes
npx vercel@latest ls --yes
```

## 相关文档

- `docs/feature-tier-plan.md`
- `docs/feature-tier-acceptance-checklist.md`
- `docs/client-guide-zh.md`
- `docs/maintenance-zh.md`
- `docs/launch-checklist-zh.md`
- `supabase/erp-phase-1-production-checklist.md`
- `supabase/pos-phase-1-production-checklist.md`
- `supabase/pos-phase-1e-production-checklist.md`
