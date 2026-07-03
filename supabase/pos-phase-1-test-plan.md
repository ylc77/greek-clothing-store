# POS Phase 1 测试执行计划

本文件用于 POS 第一阶段数据库地基验证。当前阶段只测试 `sales_orders`、`sales_order_items`、`payments` 三张表，不实现 POS API，不实现 UI，不接电子发票，不接 myDATA。

## 1. 基本原则

- 不直接在 production 执行 POS migration。
- production 只允许运行只读检查 SQL。
- 先在测试 Supabase 项目执行 `supabase/pos-phase-1-migration-draft.sql`。
- 不修改 `products`、`product_variants`、`inventory_balances`、`stock_movements` 的旧结构。
- 不切换 `USE_VARIANT_INVENTORY`。
- service_role key 只能在服务端使用，不能暴露到浏览器、client component 或 `NEXT_PUBLIC_` 环境变量。

## 2. Production 只读预检查

在 production SQL Editor 里只运行：

```txt
supabase/pos-phase-1-production-readonly-checks.sql
```

预期结果：

- `products.id` 类型检查返回 0 行。
- `product_variants.id` 存在检查返回 0 行。
- `product_variants.product_id` 类型检查返回 0 行。
- `inventory_balances` 存在检查返回 0 行。
- `stock_movements` 存在检查返回 0 行。
- `sales_orders / sales_order_items / payments` 已存在检查返回 0 行。
- duplicate barcode 返回 0 行。
- duplicate variant_sku 返回 0 行。
- negative inventory_balances 返回 0 行。
- ERP reconciliation 返回 0 行。

如果任意检查返回数据，暂停 POS migration，先处理数据或结构问题。

## 3. 测试库准备

1. 创建新的测试 Supabase 项目，建议命名为 `greek-clothing-store-pos-test`。
2. 执行当前项目的新客户初始化 SQL 或复制 production schema。
3. 导入一小批 production-like 测试数据：
   - products
   - product_variants
   - inventory_locations
   - inventory_balances
   - stock_movements
4. 确认测试库 ERP 对账 SQL 返回 0。

测试库可以使用少量商品数据，不需要完整 production 数据，但必须覆盖：

- ONE SIZE 商品
- 多尺码商品
- 有 barcode 的 variant
- 没有 barcode 的 variant
- 有库存商品
- 缺货商品

## 4. 测试库执行 POS migration

在测试库 SQL Editor 里执行：

```txt
supabase/pos-phase-1-migration-draft.sql
```

执行后验证三张表存在：

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('sales_orders', 'sales_order_items', 'payments')
order by table_name;
```

预期返回：

```txt
payments
sales_order_items
sales_orders
```

## 5. RLS 和权限验证

### 5.1 anon / authenticated

使用 anon 或 authenticated 客户端请求 POS 三张表，预期不能读取数据。

需要验证：

- `sales_orders` 不可公开读取
- `sales_order_items` 不可公开读取
- `payments` 不可公开读取

### 5.2 service_role

使用服务端 service_role 验证：

- 可以 select 三张表
- 可以 insert 测试订单
- 可以 insert 测试订单明细
- 可以 insert 测试付款
- 可以 update 测试订单状态
- 可以 delete 测试数据

service_role key 只能在服务端测试，不得放入浏览器控制台、client component 或 `NEXT_PUBLIC_` 环境变量。

## 6. 基础写入验证

在测试库手动插入一笔最小 POS 测试数据：

1. 插入 `sales_orders`
2. 插入对应 `sales_order_items`
3. 插入对应 `payments`
4. 查询订单、明细、付款是否能关联
5. 删除测试数据或回滚测试库

注意：本阶段不测试扣库存，因为 checkout API 还没有实现。库存扣减会在 POS Phase 1-B 中通过服务端 API 验证。

## 7. 不影响旧系统验证

测试库执行 POS migration 后，需要确认：

- 旧前台首页仍能读取 products。
- 分类页仍能读取 products。
- 商品详情页仍能读取 products。
- 后台商品管理仍能读取 products。
- 后台库存管理 tab 仍能读取 ERP inventory。
- `/feed.xml` 仍能正常生成。
- ERP 对账 SQL 仍返回 0。

因为 POS Phase 1-A 只新增表，不修改旧表，所以理论上不应影响旧系统。

## 8. 回滚方案

测试库失败时，可以直接清理测试库或删除测试 Supabase 项目。

如果需要在测试库手动回滚 POS 三张表，可以按依赖顺序处理：

```sql
drop table if exists public.payments;
drop table if exists public.sales_order_items;
drop table if exists public.sales_orders;
```

注意：以上只适用于测试库。production 不应随意执行 drop。

## 9. 禁止进入 Production 的情况

出现以下任一情况，不允许进入 production：

- production 只读检查不是全部通过。
- 测试库执行 migration 报错。
- 测试库 POS 三张表无法创建。
- anon/authenticated 可以读取 POS 表。
- service_role 无法读写 POS 表。
- ERP 对账 SQL 出现异常。
- 旧前台、后台或 `/feed.xml` 出现异常。
- 尚未确认 production 数据库备份。

## 10. Production 前最终确认

进入 production 前必须确认：

- production 只读检查全部 0。
- production 已备份。
- migration 已在测试库通过。
- 执行期间暂停后台商品和库存操作。
- 当前阶段不启用 POS UI。
- 当前阶段不实现 checkout API。
- 当前阶段不接发票/myDATA。

## 11. 后续阶段摘要：POS Phase 1-B

POS Phase 1-B 才会实现服务端 API：

- `GET /api/admin/pos/search`
- `POST /api/admin/pos/checkout`
- 使用 `idempotency_key` 防止重复结账
- 创建 `sales_orders`
- 创建 `sales_order_items`
- 创建 `payments`
- 扣 `inventory_balances`
- 写 `stock_movements`
  - `movement_type = 'sale'`
  - `source_type = 'pos_sale'`
- 同步回 `products.stock / products.size_stock`

本阶段不实现上述 API。
