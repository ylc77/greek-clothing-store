# POS Phase 1 Production Checklist

本清单用于 production 执行 `supabase/migrations/20260704_add_pos_phase_1_tables.sql` 前后确认。当前阶段只新增 POS 三张基础表，不实现 POS API，不实现 UI，不接发票，不接 myDATA。

## 执行前确认

- [ ] 确认当前目标是 production clothes store，不是测试库，不是 Wok Dragon。
- [ ] `supabase/pos-phase-1-production-readonly-checks.sql` 全部通过。
- [ ] production 数据库已备份。
- [ ] `supabase/pos-phase-1-migration-draft.sql` 已在测试库 `greek-clothing-store-test` 验证通过。
- [ ] 测试库验证过：
  - [ ] `sales_orders` 创建成功。
  - [ ] `sales_order_items` 创建成功。
  - [ ] `payments` 创建成功。
  - [ ] RLS 已启用。
  - [ ] anon / authenticated 无读写权限。
  - [ ] service_role 有 select / insert / update / delete 权限。
  - [ ] 测试订单、明细、付款插入成功。
  - [ ] `idempotency_key` unique 约束能阻止重复订单。
  - [ ] 测试数据已清理。
  - [ ] ERP 对账仍为 0。
- [ ] 执行期间暂停后台商品、库存、CSV、快速售出等操作。
- [ ] 确认本阶段不启用 POS UI。
- [ ] 确认本阶段不实现 checkout API。
- [ ] 确认本阶段不扣库存、不写 POS sale movement。
- [ ] 确认本阶段不接发票、不接 myDATA。
- [ ] 确认 `USE_VARIANT_INVENTORY=false`。

## 正式执行文件

只执行：

```txt
supabase/migrations/20260704_add_pos_phase_1_tables.sql
```

不要执行草案文件到 production，除非已经确认内容完全一致。

## 执行后验证

### 1. POS 表存在

- [ ] `sales_orders` 存在。
- [ ] `sales_order_items` 存在。
- [ ] `payments` 存在。

### 2. 关键字段和约束

- [ ] `sales_orders.id` 是 `uuid`。
- [ ] `sales_orders.order_number` 是 unique not null。
- [ ] `sales_orders.idempotency_key` 是 unique not null。
- [ ] `sales_order_items.product_id` 是 `bigint`。
- [ ] `sales_order_items.product_id` references `public.products(id)`。
- [ ] `sales_order_items.variant_id` references `public.product_variants(id)`。
- [ ] `payments.order_id` references `public.sales_orders(id)`。
- [ ] check constraints 存在。
- [ ] indexes 存在。

### 3. RLS / 权限

- [ ] `sales_orders` RLS 已启用。
- [ ] `sales_order_items` RLS 已启用。
- [ ] `payments` RLS 已启用。
- [ ] 没有 anon / authenticated public policy。
- [ ] anon / authenticated 无 select / insert / update / delete 权限。
- [ ] service_role 有 select / insert / update / delete 权限。

### 4. 旧系统验证

- [ ] 首页正常。
- [ ] 分类页正常。
- [ ] 商品详情页正常。
- [ ] 后台商品管理正常。
- [ ] 后台库存管理 tab 正常。
- [ ] `/feed.xml` 正常。
- [ ] ERP 对账仍为 0。

### 5. 数据安全确认

- [ ] migration 没有修改 `products` 旧字段。
- [ ] migration 没有修改 `product_variants` / `inventory_balances` / `stock_movements` 结构。
- [ ] migration 没有创建 `invoice_documents`。
- [ ] migration 没有创建 `provider_api_logs`。
- [ ] migration 没有接 myDATA。
- [ ] migration 没有 drop 任何表。

## 如果失败

- 如果 production 只读检查未通过，不执行 migration。
- 如果 migration 执行失败，停止继续操作，记录错误信息。
- 如果 POS 表部分创建但验证失败，先不要继续接 API/UI，人工审查后再决定是否回滚。
- 如果旧前台、后台、feed 或 ERP 对账异常，停止进入 POS Phase 1-B。

## 后续阶段

POS Phase 1-B 才实现：

- `GET /api/admin/pos/search`
- `POST /api/admin/pos/checkout`
- `idempotency_key` 防重复结账
- 创建 `sales_orders / sales_order_items / payments`
- 扣 `inventory_balances`
- 写 `stock_movements`
  - `movement_type = 'sale'`
  - `source_type = 'pos_sale'`
- 同步回 `products.stock / products.size_stock`
