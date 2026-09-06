# 在线付款与配送 API 接入

本模版已经包含 Viva Smart Checkout、BOX NOW Locker 和到店自取的应用接口。新客户不需要修改订单、库存或数据库代码；先在服务商后台取得该客户自己的凭据，再配置环境变量和后台开关即可。

## 安全边界

- 每个客户使用独立的 Viva、BOX NOW、Supabase 和 Vercel 项目及凭据。
- Client Secret、Webhook Key、`CRON_SECRET` 只放在 Vercel 服务端环境变量，不使用 `NEXT_PUBLIC_` 前缀。
- `NEXT_PUBLIC_BOXNOW_PARTNER_ID` 是 BOX NOW 官方 Locker Widget 所需的公开 Partner ID，可以发送到浏览器；它不是服务端 API Secret。
- 先使用 Viva Demo 和 BOX NOW Stage 验收，不能直接拿真实客户订单测试 Production。
- 未配置、认证失败、RPC 缺失或后台功能未开启时，结账和运单写入会返回 503 并停止，不会回退到非事务流程。

## 1. 数据库与站点基础配置

新客户空库执行 `supabase/client-init.sql`；已有客户只执行 migration 升级。确认包含：

```text
20260802120000_online_store_orders.sql
20260820121706_viva_boxnow_online_checkout.sql
```

配置：

```dotenv
NEXT_PUBLIC_SITE_URL=https://客户域名
USE_ONLINE_ORDER_RPC=true
AUTH_RATE_LIMIT_SECRET=每客户独立且至少32位的随机值
CRON_SECRET=每客户独立且至少32位的随机值
```

## 2. Viva Smart Checkout

先在 Viva Demo 创建该商家的支付来源，填写：

```dotenv
VIVA_API_BASE_URL=https://demo-api.vivapayments.com
VIVA_ACCOUNTS_BASE_URL=https://demo-accounts.vivapayments.com
VIVA_CHECKOUT_BASE_URL=https://demo.vivapayments.com/web/checkout
VIVA_CLIENT_ID=
VIVA_CLIENT_SECRET=
VIVA_SOURCE_CODE=
VIVA_MERCHANT_ID=
VIVA_WEBHOOK_VERIFICATION_KEY=
```

在 Viva 支付来源或账户后台配置当前客户域名：

```text
成功返回：https://客户域名/checkout/success
失败返回：https://客户域名/checkout/failure
Webhook：https://客户域名/api/webhooks/viva
```

成功页和失败页只显示返回状态，不能作为付款成功证据。正式付款状态仅由 Webhook 到达后再次向 Viva 查询交易，并核对 Merchant、Source、订单号、金额、EUR 币种和成功状态后确认。

## 3. BOX NOW

从 BOX NOW Stage 合同或商户后台取得该客户的 API 与 Locker Widget 参数：

```dotenv
BOXNOW_API_BASE_URL=
BOXNOW_CLIENT_ID=
BOXNOW_CLIENT_SECRET=
BOXNOW_PARTNER_ID=
BOXNOW_ORIGIN_ID=
NEXT_PUBLIC_BOXNOW_PARTNER_ID=
```

`BOXNOW_ORIGIN_ID` 对应该客户实际发货门店/仓库。当前模版按一张订单一个预付包裹创建运单，不请求 BOX NOW 代收货款。后台支持创建运单、读取 PDF 标签、刷新状态和安全取消；不确定的请求结果保留为待核对状态，不会伪造成功。

如果客户只提供到店自取，可以暂不配置 BOX NOW，并在后台关闭 BOX NOW。Viva 仍用于在线付款。

## 4. 配置与连接检查

仅检查变量是否完整，不输出任何凭据：

```powershell
npm run commerce:status
```

只执行 OAuth/API 身份验证，不创建付款、订单或运单：

```powershell
npm run commerce:verify -- --provider viva
npm run commerce:verify -- --provider boxnow
npm run commerce:verify -- --provider all
```

本地 Supabase 启动后验证数据库能力和应用的 fail-closed 状态：

```powershell
npm run test:online-orders-runtime
```

## 5. 后台启用顺序

连接检查通过后，再由维护者进入 Store Settings：

1. 填写商家地址、电话、邮箱和取货信息。
2. 开启在线购物。
3. 开启 Viva 在线付款。
4. 按合同开启 BOX NOW 和/或到店自取。
5. 填写 BOX NOW 最低订单额、运费、免运费门槛，以及单笔件数、最大重量和长宽高限制。已填写包装数据且超过限制的商品会在报价和数据库事务两层阻止 BOX NOW；未填写包装数据时仍以商品的配送方式设置为准。
6. 发布客户法律信息和当前版本。
7. 打开后台在线订单健康检查，必须显示全部就绪后才允许正式接单。

## 6. 上线前真实验收

- Viva Demo：支付成功、失败、用户取消、重复回调、响应丢失后重试。
- BOX NOW Stage：Locker 选择、创建运单、标签 PDF、状态刷新和取消。
- 到店自取：已付款、备货完成、延长取货期限、完成取货。
- 库存：最后一件并发购买只允许一个成功；取消和完成不会重复释放或扣减库存。
- 日志：不得出现 Client Secret、Webhook Key、访问 Token、完整付款请求体或客户隐私数据。
- 切换 Production 时仅替换该客户的环境变量和服务商后台域名，不修改业务代码。
