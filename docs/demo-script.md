# v1.0 Commercial Demo Script

## Demo Positioning

This is a Chinese demo script for presenting the clothing store v1.0 commercial demo version to a shop owner or client.

Suggested tone:

- Practical
- Business-focused
- Not too technical
- Focus on daily shop workflows

## Short Opening Pitch

这是一套专门为服装店准备的商品展示网站和轻量后台系统。

前台可以展示商品、分类、价格、尺码和库存，并支持购物车、货到付款和到店自取；后台可以管理商品、图片、库存、CSV 和在线订单，同时也有实体店 POS、库存流水、条码标签和小票打印预览。

这不是一个只给客户看的网页，而是一个可以帮小店同时管理线上展示和线下收银的完整演示系统。

## Recommended Demo Flow

### 1. Storefront Home Page

Open the home page.

Talking points:

- 这是顾客看到的网站首页。
- 首页展示店铺形象、主视觉图、分类入口和推荐商品。
- 手机和电脑都可以浏览，适合本地顾客直接查看商品。

Suggested line:

```txt
顾客打开网站后，第一眼看到的是店铺形象和主要分类，不需要下载 App，也不需要复杂操作。
```

### 2. Category Page

Open a category page, such as `/women` or `/shoes`.

Talking points:

- 商品可以按分类展示。
- 价格、图片、库存状态清楚。
- 顾客可以快速找到想看的类型。

Suggested line:

```txt
分类页适合展示不同品类，比如女装、鞋子、包包。以后商家只需要在后台维护商品，前台会自动更新。
```

### 3. Product Detail Page

Open a real product detail page.

Talking points:

- 展示商品图、价格、SKU、尺码和库存。
- 可以引导顾客通过 WhatsApp 咨询。
- 商品详情页支持规格选择、库存状态、加入购物车和 AI 咨询。

Suggested line:

```txt
每个商品都有独立详情页，方便顾客查看，也方便之后提交到比价平台或做搜索引擎收录。
```

### 4. Admin Login

Open `/admin`.

Talking points:

- 后台是给商家使用的管理系统。
- 商品、库存、POS、在线订单和标签都集中在一个地方。

Suggested line:

```txt
商家不需要分别打开很多系统，日常运营主要都在这个后台完成。
```

### 5. Product Management

Show the product list.

Talking points:

- 商品列表能看到 SKU、图片、分类、价格、库存和状态。
- 可以新增、编辑、复制、下架商品。
- 后台支持图片上传和 CSV 导入。

Suggested line:

```txt
如果店里来了一批新衣服，可以在后台新增商品、上传图片、填写尺码库存，也可以用 CSV 批量导入。
```

### 6. Inventory Management

Open the inventory tab.

Talking points:

- 每个尺码或变体都有独立库存。
- 可以查看当前库存、可用库存、低库存和库存流水。
- 手动调库存必须填写原因，方便以后追踪。

Suggested line:

```txt
库存不是简单地写一个总数，而是按尺码和变体管理。每次调整都会有记录，方便查账。
```

### 7. Barcode And Label Printing

Open the label printing tab.

Talking points:

- 系统可以给商品变体生成 barcode。
- 第一版规则是 `barcode = variant_sku`。
- 可以预览标签并用浏览器打印。
- 后续有真实标签机后再做硬件验收。

Suggested line:

```txt
服装店最怕尺码和颜色卖错，所以每个尺码都应该有自己的条码。之后贴上标签，扫码就能准确扣库存。
```

### 8. POS Checkout DryRun

Open the POS checkout tab.

Use dryRun only.

Talking points:

- POS 可以按 barcode、SKU 或商品名搜索。
- 加入购物车后可以预检订单。
- dryRun 会检查库存和价格，但不会真实扣库存。

Suggested line:

```txt
这里是实体店收银界面。演示时我们先用预检模式，它会检查价格和库存，但不会真的创建订单或扣库存。
```

### 9. POS Order History

Open POS orders.

Talking points:

- 可以查看 POS 订单历史。
- 可以打开订单详情。
- 可以查看付款、商品明细和对应库存流水。
- 测试订单可以作废并把库存加回。

Suggested line:

```txt
每笔线下销售都会留下订单记录，也会写入库存流水。万一点错，可以通过作废流程把库存恢复。
```

### 10. Receipt Preview

Open receipt preview from an order detail.

Talking points:

- 可以预览销售小票。
- 浏览器可以直接打印。
- 当前小票不是正式税务发票。

Suggested line:

```txt
这里可以打印普通销售小票，但它还不是正式税务发票。正式发票和 myDATA 会放在后续阶段接入。
```

### 11. Online Shopping

Open a product page, add an in-stock Variant to the cart, then open `/checkout` and the admin `在线订单` page.

Talking points:

- 顾客可以选择有库存的尺码或颜色并加入购物车。
- 第一版支持货到付款和到店自取。
- 后台可以查看订单，库存由事务流程安全预留和扣减。

Suggested line:

```txt
顾客可以直接在网站下单，商家在后台处理在线订单；第一版先使用货到付款和到店自取，不依赖第三方支付。
```

### 12. Documentation

Open or mention:

- `docs/commercial-demo-checklist.md`
- `docs/admin-user-guide.md`

Talking points:

- 已经有演示前检查清单。
- 已经有后台使用草案。
- 后续可以继续整理成给商家的正式操作手册。

Suggested line:

```txt
这套系统不只是功能做出来了，也开始整理操作文档，方便之后交付给真实商家使用。
```

## Do Not Perform During Live Demo

Avoid these actions during a client-facing demo:

- Real production checkout, unless using a test product.
- Void a real customer order.
- Permanently delete products.
- Bulk CSV import.
- Bulk barcode generation on real products.
- Manual inventory adjustment on real products.
- Change Vercel or Supabase environment variables.
- Claim that myDATA or official invoice integration is finished.
- Claim that ESC/POS or printer SDK is finished.

## Deferred Feature Explanation

Use this wording if the client asks about tax invoices:

```txt
目前这个版本已经完成商品、库存、POS 和普通小票演示。正式电子发票和希腊 myDATA 需要先确定服务商，比如 SoftOne、Epsilon Net、Oxygen 或其他本地服务商。确定 API 文档后，再做下一阶段对接。
```

Use this wording if the client asks about real thermal printers:

```txt
现在支持浏览器打印小票和标签。真实热敏打印机、标签机和扫码枪需要拿到硬件后测试。如果浏览器打印稳定，就可以先用；如果不稳定，再做 ESC/POS 或本地打印桥。
```

Use this wording if the client asks about employee accounts:

```txt
当前演示版是管理员后台。真实店铺上线前，可以继续增加员工权限，比如店员只能收银，店长可以调库存，管理员可以管理商品和系统设置。
```

## One-Minute Demo Summary

```txt
这套系统把服装店的线上展示和线下管理放在一起。

顾客可以在前台浏览商品、分类、价格和库存并提交订单；商家可以在后台管理商品、图片、库存和在线订单。

线下店员可以用 POS 收银，系统会自动扣库存、记录订单和库存流水；如果点错，也可以作废订单并恢复库存。

系统还支持 barcode 和标签打印的基础流程，后续接上扫码枪和标签机，就可以做到扫码卖货。

目前 v1.0 是商用演示版，适合展示完整业务闭环。正式发票、myDATA、员工权限和更复杂的退款采购，会放在后续阶段继续完善。
```

## Final Positioning

Recommended closing line:

```txt
这个版本已经不是普通展示网站，而是一个服装店线上展示 + 后台管理 + 库存 + POS 的轻量一体化系统。它适合先给真实商家演示和试用，再根据硬件、发票和员工流程继续迭代。
```
