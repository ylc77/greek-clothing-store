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

### 四、部署到 Vercel

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
USE_POS_RPC=false
```

可选 AI 功能：

```env
DEEPSEEK_API_KEY=
DEEPSEEK_TRANSLATION_MODEL=deepseek-chat
OPENAI_API_KEY=
OPENAI_IMAGE_MODEL=gpt-image-1
```

6. 点击 **Deploy**。
7. 部署完成后打开正式网址。
8. 如果绑定了自定义域名，把 `NEXT_PUBLIC_SITE_URL` 改为最终域名并重新部署一次。

### 五、首次后台配置

1. 打开 `https://你的域名/admin`。
2. 使用 `ADMIN_PASSWORD` 登录。
3. 填写店铺名称、地址、电话、营业时间和联系方式。
4. 上传 Logo 和首页图片。
5. 设置 WhatsApp、Instagram、Google Maps 和 Skroutz。
6. 添加商品或通过 CSV 导入商品。
7. 进入 **Settings → Legal Settings**，填写商家法律信息并发布 `v1`。
8. 根据客户购买内容选择 Basic、Standard 或 Advanced。

### 六、上线检查

前台：

- [ ] 首页、分类页和商品详情页可以打开。
- [ ] 希腊语 / 英语切换正常。
- [ ] Logo、首页图片和商品图片正常显示。
- [ ] WhatsApp、Instagram 和地图链接正确。
- [ ] Privacy、Terms、Cookie、Contact、Refund、Return、Shipping 页面可以打开。
- [ ] `/feed.xml` 按客户版本正常输出或关闭。

后台：

- [ ] 后台可以登录。
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

不可以。已有客户升级只能执行尚未应用的 migration 或专用 patch，避免破坏数据。

### 图片上传失败怎么办？

检查 `product-images` bucket、Vercel 的 `SUPABASE_SERVICE_ROLE_KEY`、文件类型和大小。数据库初始化成功不代表 Storage 上传一定已经验收。

## 开发维护说明

以下内容只给维护者使用，新客户部署不需要理解。

- `supabase/migrations` 是数据库开发和升级的权威来源。
- `supabase/client-init.sql` 是根据 migrations 生成的新客户空库部署快照。
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
npm run check:site
npm run check:skroutz
```

## 相关文档

- `docs/client-guide-zh.md`
- `docs/maintenance-zh.md`
- `docs/launch-checklist-zh.md`
- `docs/feature-tier-acceptance-checklist.md`
