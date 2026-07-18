# v1 客户部署检查清单

## 身份与目录

- [ ] 当前目录是该客户项目根目录，`git status` 无异常。
- [ ] `supabase/migrations` 存在并能看到 21 份 migration。
- [ ] 已记录客户代号、Supabase ref/region、Vercel project ID、代码 commit/tag，不含秘密。
- [ ] 资源属于该客户，不复用其他客户数据库、key、密码、域名或备份。

## Supabase

- [ ] 新空库只执行一次 `client-init.sql`；已有库只走 migration upgrade。
- [ ] `MAIN_STORE` 存在；Feature 默认 `advanced`；`developer_access` 初始为空。
- [ ] POS、库存、商品、CSV、operations runtime health 为 ready。
- [ ] `product-images` bucket 存在，公开只读，匿名/登录用户不能任意写删。
- [ ] RLS、grants、RPC execute 和 service-role-only 私有表验收通过。

## Vercel 与秘密

- [ ] Supabase URL、publishable key 和 service/secret key 属于同一项目。
- [ ] service/secret key 无 `NEXT_PUBLIC_` 前缀，只存在服务端且未进入 Git/日志/截图。
- [ ] `AUTH_RATE_LIMIT_SECRET` 每客户唯一且至少 32 字符。
- [ ] 三个事务开关均为 `true`。
- [ ] 如使用应急密码，符合强度并与其他客户/角色不同。
- [ ] `NEXT_PUBLIC_SITE_URL` 与实际域名一致；环境变量更新后已重新部署。

## 业务

- [ ] developer bootstrap 完成，密码只进入维护者密码管理器。
- [ ] Store Settings、Legal Settings 和版本功能已按客户确认。
- [ ] 多尺码、ONE SIZE、图片、库存、POS/CSV（适用时）、法律、Feed（适用时）通过。
- [ ] owner/staff/inventory/readonly 权限正确，owner 不能进入 developer-only 设置。
- [ ] 390/768/1440 页面、日志、monitor 和测试数据清理通过。
- [ ] 已建立并验证首次备份。
- [ ] 客户已收到使用手册；未收到 developer 密码、service key 或基础设施 owner 权限。
- [ ] 真实硬件未验收时 Standard/Advanced 明确标记 `CONDITIONAL`。
