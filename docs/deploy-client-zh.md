# 新客户部署说明

> **新客户**：从头部署，使用 `client-init.sql` 一键初始化。
> **老客户升级**：不要执行 `client-init.sql`！已有真实数据会被覆盖。使用尚未应用的 `supabase/migrations`；只有具体升级说明明确要求时才使用专用 patch。

## 1. 新建 Supabase 项目
1. 登录 [supabase.com](https://supabase.com)
2. 新建项目，记下项目 URL 和 anon key
3. 进入 Settings → API，复制 `service_role key`

## 2. 初始化数据库
1. Supabase → SQL Editor → 新建查询
2. 复制 `supabase/client-init.sql` 全部内容，粘贴执行
3. （可选）如需演示商品，再执行 `supabase/demo-products.sql`

执行 `client-init.sql` 后开发者凭据故意保持未初始化；此时 Store Settings、Legal Settings 和版本功能写入会安全拒绝，不存在模板默认开发者密码。

## 3. 维护者初始化客户专属开发者凭据

1. 在维护者自己的客户项目目录配置该客户的 `NEXT_PUBLIC_SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY`；只保存在 Git 忽略的本机配置和 Vercel 服务端。
2. 从 Supabase URL 确认 project ref。
3. 执行：

```powershell
npm run developer:status -- --project-ref 客户项目ref
npm run developer:bootstrap -- --project-ref 客户项目ref
```

4. CLI 再次显示并确认目标项目，生成每客户唯一密码。
5. 密码只显示一次，立即保存到维护者密码管理器，不写入文件或 Vercel。
6. 重复 bootstrap 会拒绝，不会覆盖现有凭据。

客户电脑不需要运行这些命令。交付时不要向普通商家提供开发者密码、service role 或维护者基础设施权限。

## 4. 新建 Vercel 项目
1. 登录 [vercel.com](https://vercel.com)
2. Import 本项目 GitHub 仓库
3. 配置环境变量（见下方）

## 5. 环境变量
```
NEXT_PUBLIC_SITE_URL=https://你的域名.vercel.app
NEXT_PUBLIC_SUPABASE_URL=https://你的项目.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=你的anon key
ADMIN_PASSWORD=设置一个密码
SUPABASE_SERVICE_ROLE_KEY=你的service_role_key
DEEPSEEK_API_KEY=你的DeepSeek API Key
```

## 6. 配置店铺信息
1. 访问 `https://你的域名.vercel.app/admin`
2. 用商家员工账号进入普通后台；`ADMIN_PASSWORD` 只作为维护者紧急 owner fallback
3. 维护者使用单独保存的开发者密码进入「店铺设置」，修改店铺名称、电话、WhatsApp、Instagram、地址等
4. 上传 Logo 和首页大图

## 7. 管理分类
1. 进入「分类管理」Tab
2. 默认已有 8 个一级分类和 23 个二级分类
3. 可根据需要修改、停用或新增

## 8. 导入商品
1. 进入「新增/编辑」手动添加
2. 或进入「CSV 导入」下载模板，批量导入

## 9. 检查 feed.xml
1. 访问 `https://你的域名.vercel.app/feed.xml`
2. 确认 XML 正常输出
3. 进入后台「Skroutz Feed」查看统计

## 10. 绑定域名（可选）
Vercel → Settings → Domains → 添加自定义域名

## 11. 交付检查清单
- [ ] 首页正常打开，不白屏
- [ ] Logo 和首页大图正常显示
- [ ] 分类页正常，所有分类可点击
- [ ] 至少 4 件上架商品
- [ ] 商品详情页：图片、价格、尺码、Skroutz 按钮正常
- [ ] 英语 / 希腊语切换正常
- [ ] 后台登录正常，密码已更换
- [ ] developer status 为 Initialized=true、Must rotate=false
- [ ] 商家 owner/staff/inventory/readonly 无法修改 Store/Legal/Feature Settings
- [ ] 可新增/编辑/下架商品
- [ ] 图片上传正常
- [ ] CSV 导入导出正常
- [ ] /feed.xml 可公网访问
- [ ] 店铺设置已填写完整（名称、联系方式、地址、营业时间）
- [ ] WhatsApp / Instagram / Google Maps 链接已更新

## 12. 客户需要提供的资料
- Logo 图片（PNG，透明背景，512×512）
- 首页大图（1200×900 或 1600×1200，服装风格图）
- WhatsApp 号码
- Instagram 链接
- 店铺地址
- 营业时间
- 店铺简介（中/英/希腊语可选）
- 商品数据和图片

## 13. 凭据轮换、丢失恢复和客户转移

- 丢失开发者密码时，维护者使用该客户的 service role 在自己的电脑运行 `npm run developer:rotate -- --project-ref 客户项目ref`；不新增公开重置 API，不通过邮件发送密码。
- 轮换后旧密码和所有旧 Cookie 立即失效。
- 建议至少每年轮换一次；维护人员变化、疑似泄露或客户项目转移时立即轮换。
- 转移给新维护者时先轮换，再移交 Supabase/Vercel/仓库权限，并撤销旧维护者权限。
- 如果 status 显示未初始化，使用 bootstrap；显示 Must rotate=true，使用 rotate。

## 14. 每月维护建议
- 检查 /feed.xml 是否正常
- 导出 CSV 备份商品数据
- 更新商品库存和价格
- 新增当季新品
- 停售商品设为下架
- 确认联系方式和营业时间准确
