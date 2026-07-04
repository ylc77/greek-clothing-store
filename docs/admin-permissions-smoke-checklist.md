# 后台员工权限验收清单

本文档用于部署前后检查后台角色权限是否符合预期。当前系统仍以密码模式为主，尚未切换到正式员工账号系统。

## 当前角色

### 店主 / 管理员

环境变量：

- `ADMIN_PASSWORD`

预期：

- 可以登录后台。
- 可以看到全部后台 tab。
- 可以新增 / 编辑商品。
- 可以上传图片。
- 可以导入 CSV。
- 可以管理分类。
- 可以调整库存。
- 可以生成条码和打印标签。
- 可以 POS 收银。
- 可以作废 POS 订单。
- 可以导出 CSV 备份。
- 可以进入店铺设置。

### 店员

环境变量：

- `ADMIN_STAFF_PASSWORD`

预期：

- 可以登录后台。
- 可以看到 POS 收银。
- 可以看到 POS 订单。
- 可以看到商品列表 / 库存只读信息。
- 可以执行 POS checkout。
- 不能作废订单。
- 不能新增 / 编辑商品。
- 不能上传图片。
- 不能导入 CSV。
- 不能修改分类。
- 不能进入店铺设置。
- 不能导出备份。
- 不能永久删除商品。

### 库存管理员

环境变量：

- `ADMIN_INVENTORY_PASSWORD`

预期：

- 可以登录后台。
- 可以查看商品列表。
- 可以查看库存管理。
- 可以调整库存。
- 可以查看库存流水。
- 可以生成 variant barcode。
- 可以打印标签。
- 不能 POS checkout。
- 不能作废订单。
- 不能新增 / 编辑商品。
- 不能上传图片。
- 不能导入 CSV。
- 不能修改分类。
- 不能进入店铺设置。
- 不能导出备份。
- 不能永久删除商品。

### 只读角色

环境变量：

- `ADMIN_READONLY_PASSWORD`

预期：

- 可以登录后台。
- 可以查看商品列表。
- 可以查看库存只读信息。
- 可以查看 POS 订单。
- 不能 POS checkout。
- 不能作废订单。
- 不能调整库存。
- 不能生成条码。
- 不能新增 / 编辑商品。
- 不能上传图片。
- 不能导入 CSV。
- 不能修改分类。
- 不能进入店铺设置。
- 不能导出备份。
- 不能永久删除商品。

## API 验收矩阵

下面的状态码是期望结果。未配置对应角色密码时，可以跳过该角色测试。

| API | owner | staff | inventory | readonly |
| --- | --- | --- | --- | --- |
| `GET /api/admin/session` | 200 | 200 | 200 | 200 |
| `GET /api/admin/products` | 200 | 200 | 200 | 200 |
| `GET /api/admin/categories` | 200 | 200 | 200 | 200 |
| `GET /api/admin/inventory` | 200 | 200 | 200 | 200 |
| `GET /api/admin/inventory/movements` | 200 | 401 | 200 | 401 |
| `GET /api/admin/inventory/reconciliation` | 200 | 401 | 200 | 401 |
| `POST /api/admin/inventory/adjust` | 200 | 401 | 200 | 401 |
| `GET /api/admin/pos/search` | 200 | 200 | 401 | 200 |
| `POST /api/admin/pos/checkout` | 200 | 200 | 401 | 401 |
| `GET /api/admin/pos/orders` | 200 | 200 | 401 | 200 |
| `GET /api/admin/pos/orders/[id]` | 200 | 200 | 401 | 200 |
| `POST /api/admin/pos/orders/[id]/void` | 200 | 401 | 401 | 401 |
| `POST /api/admin/variants/generate-barcodes` | 200 | 401 | 200 | 401 |
| `PUT /api/admin/variants/[id]/barcode` | 200 | 401 | 200 | 401 |
| `POST /api/admin/products` | 200 | 401 | 401 | 401 |
| `PUT /api/admin/products/[id]` | 200 | 401 | 401 | 401 |
| `PUT /api/admin/products/bulk` | 200 | 401 | 401 | 401 |
| `POST /api/admin/products/import` | 200 | 401 | 401 | 401 |
| `POST /api/admin/images` | 200 | 401 | 401 | 401 |
| `GET /api/admin/backup` | 200 | 401 | 401 | 401 |
| `PUT /api/admin/settings` | 200 | 401 | 401 | 401 |

## 手动 UI 验收

### 店主登录

1. 打开 `/admin`。
2. 使用 `ADMIN_PASSWORD` 登录。
3. 确认全部 tab 可见。
4. 确认店铺设置和导出 CSV 可见。
5. 确认 POS 订单里 completed 订单可以看到“作废”按钮。

### 店员登录

1. 使用 `ADMIN_STAFF_PASSWORD` 登录。
2. 确认能看到 POS 收银和 POS 订单。
3. 确认看不到商品新增、CSV、图片上传、分类管理。
4. 确认看不到店铺设置和导出 CSV。
5. 确认 POS 订单里看不到“作废”按钮。
6. 执行 POS dryRun。
7. 如需真实验收，只使用测试 SKU 执行 checkout。

### 库存管理员登录

1. 使用 `ADMIN_INVENTORY_PASSWORD` 登录。
2. 确认能看到库存管理和标签打印。
3. 确认看不到 POS 收银。
4. 使用测试 variant 做库存调整。
5. 使用测试 variant 生成 barcode。

### 只读登录

1. 使用 `ADMIN_READONLY_PASSWORD` 登录。
2. 确认只能查看商品、库存和 POS 订单。
3. 确认没有任何写入按钮。

## 未授权检查

不带 `x-admin-password` 请求以下接口，应该返回 `401`：

- `GET /api/admin/session`
- `GET /api/admin/products`
- `GET /api/admin/inventory`
- `POST /api/admin/pos/checkout`
- `POST /api/admin/inventory/adjust`
- `POST /api/admin/variants/generate-barcodes`

## 生产开启建议

1. 先只配置 `ADMIN_PASSWORD`。
2. 部署后确认店主后台正常。
3. 再配置 `ADMIN_STAFF_PASSWORD`，用测试 SKU 验收 POS checkout。
4. 再配置 `ADMIN_INVENTORY_PASSWORD`，用测试 variant 验收库存调整和标签生成。
5. `ADMIN_READONLY_PASSWORD` 只用于演示或外部协作，不建议给真实店员使用。

## 回滚方式

如员工权限出现异常：

1. 从 Vercel Production 环境变量中清空：
   - `ADMIN_STAFF_PASSWORD`
   - `ADMIN_INVENTORY_PASSWORD`
   - `ADMIN_READONLY_PASSWORD`
2. 重新部署。
3. 系统会回到只接受 `ADMIN_PASSWORD` 的模式。

## 当前限制

- 当前仍不是正式员工账号系统。
- 当前没有员工姓名、操作人身份和登录历史。
- POS checkout 写入的 `created_by` 仍然是 `admin`。
- 后续若要正式商用，应升级为 Supabase Auth 或等价账号系统，并记录真实员工身份。
