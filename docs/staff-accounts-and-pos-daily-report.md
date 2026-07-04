# 正式员工账号和 POS 日报说明

## 员工账号系统

当前后台支持两种登录方式：

- 员工账号：使用 Supabase Auth 邮箱和密码登录。
- 应急密码：继续使用 `ADMIN_PASSWORD`，只作为店主或开发者兜底入口。

员工账号需要配合 `public.admin_users` 表使用。账号本身在 Supabase Auth 里创建，权限角色写在 `admin_users` 表里。

## 角色权限

- `owner`：完整后台权限，包括商品、库存、POS、作废、标签、分类、设置、备份和 AI。
- `staff`：适合收银员，可看商品、库存、POS 收银和 POS 订单。
- `inventory`：适合仓库或理货人员，可看商品、调整库存、打印标签。
- `readonly`：只读查看商品、库存、POS 订单和 Feed。

## 数据库草案

草案文件：

`supabase/admin-users-migration-draft.sql`

执行前建议先在测试库验证：

1. 创建 Supabase Auth 测试用户。
2. 在 `public.admin_users` 插入该用户 `id`、邮箱和角色。
3. 用该账号登录 `/admin`。
4. 确认不同角色只能看到对应后台入口。
5. 确认没有权限的 API 返回 401。

## POS 日报

新增接口：

`GET /api/admin/pos/reports/daily`

参数：

- `date=YYYY-MM-DD`
- `timezoneOffsetMinutes`

日报显示：

- 完成订单数
- 作废订单数
- 售出件数
- 销售额
- 折扣
- 作废金额
- 净销售
- 付款方式汇总
- 热销商品
- 运行健康检查

## 验收清单

1. 店主账号可登录后台。
2. 员工账号可登录后台。
3. 收银员账号只能看到 POS 相关入口。
4. 库存账号能进入库存和标签打印。
5. 只读账号不能执行写入操作。
6. POS 日报能按日期刷新。
7. POS 日报的订单数、金额和订单历史一致。
8. 未登录请求后台 API 返回 401。
9. `ADMIN_PASSWORD` 应急登录仍可用。

## 安全边界

- `SUPABASE_SERVICE_ROLE_KEY` 只能放在服务端和 Vercel 环境变量里。
- 不允许使用 `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY`。
- 前端只拿 Supabase Auth session token。
- 前端不能直接写 POS、ERP、admin_users 表。
- `admin_users` 不给 anon/authenticated 开公开 policy。
