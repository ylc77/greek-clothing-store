# 后台权限 Phase 1-A 设计记录

本文档记录后台权限第一小步的实现边界。当前目标是先建立权限模型，不立刻改变现有后台登录体验。

## 当前实现

- 后台仍然使用 `ADMIN_PASSWORD`。
- 旧的 `adminPasswordIsValid(...)` 行为保持不变：只有店主 / 管理员密码可以通过。
- 新增 `lib/admin-auth.ts`，集中定义后台角色和权限。
- 已预留 `ADMIN_STAFF_PASSWORD`、`ADMIN_INVENTORY_PASSWORD`、`ADMIN_READONLY_PASSWORD`，但只有已经迁移过的只读 API 会接受这些密码。
- 未迁移的写入、删除、设置、导入、备份等接口仍然只接受 `ADMIN_PASSWORD`。

## 已接入的低风险接口

- `GET /api/admin/session`
- `GET /api/admin/products`
- `GET /api/admin/categories`
- `GET /api/admin/inventory`
- `GET /api/admin/inventory/movements`
- `GET /api/admin/inventory/reconciliation`
- `GET /api/admin/pos/search`
- `GET /api/admin/pos/orders`
- `GET /api/admin/pos/orders/[id]`

## 已接入的受控写入接口

- `POST /api/admin/inventory/adjust`：需要 `inventory:write`。
- `POST /api/admin/variants/generate-barcodes`：需要 `labels:write`。
- `PUT /api/admin/variants/[id]/barcode`：需要 `labels:write`。
- `POST /api/admin/pos/checkout`：需要 `pos:checkout`。
- `POST /api/admin/pos/orders/[id]/void`：需要 `pos:void`，当前只有 `owner` 拥有。

## 已接入的后台 UI 行为

- 登录时会先调用 `GET /api/admin/session` 验证密码并取得当前角色。
- 非店主角色只显示自己有权限访问的后台 tab。
- 商品列表里的批量操作、移动端编辑 / 复制 / 上下架 / 永久删除入口对非店主隐藏。
- 桌面商品表里的编辑 / 复制 / 上下架 / 永久删除入口对非店主隐藏。
- 店员角色可以看到 POS 收银和 POS 订单，但看不到作废订单入口。
- 顶部店铺设置和 CSV 备份导出入口只对店主显示。

## 仍未开放给员工角色的功能

以下功能仍然只接受 `ADMIN_PASSWORD` 或只有 `owner` 权限：

- POS 订单作废。
- 快速售出。
- 商品新增 / 编辑。
- 商品批量上下架。
- CSV 导入。
- 图片上传 / 删除。
- 店铺设置。
- 分类保存。
- 备份导出。
- 永久删除。
- AI 写入。

## 预留角色

- `owner`：店主 / 管理员，拥有全部权限。
- `staff`：店员，适合 POS 收银和基础查询。
- `inventory`：库存管理员，适合库存调整、标签打印和商品查看。
- `readonly`：只读查看，适合演示或外部协作。

## 权限方向

- 商品查看：`products:read`
- 商品写入：`products:write`
- 商品永久删除：`products:delete`
- 库存查看：`inventory:read`
- 库存调整：`inventory:write`
- POS 查看：`pos:read`
- POS 收银：`pos:checkout`
- POS 作废：`pos:void`
- 标签打印 / 条码写入：`labels:write`
- 分类管理：`categories:write`
- 店铺设置：`settings:write`
- Feed 查看：`feed:read`
- 备份导出：`backup:read`
- AI 写入：`ai:write`

## 后续接入顺序

1. 增加后台登录会话状态，返回当前角色和可见菜单。
2. 先把 POS 相关 API 接入 `pos:*` 权限。
3. 再把库存调整和标签打印接入 `inventory:*` / `labels:write` 权限。
4. 商品新增编辑接入 `products:write`。
5. 永久删除、店铺设置、CSV 导入、备份导出继续限制为 `owner`。
6. 最后再考虑 Supabase Auth 或正式员工账号系统。

## 安全边界

- 不能把 `SUPABASE_SERVICE_ROLE_KEY` 暴露到浏览器。
- 不能让前端直接写 ERP / POS 表。
- 在所有 API 完成权限迁移前，不应启用员工密码。
- 新角色上线前必须逐个 API 验证 401 / 403 行为。
- 具体手动验收步骤见 `docs/admin-permissions-smoke-checklist.md`。
