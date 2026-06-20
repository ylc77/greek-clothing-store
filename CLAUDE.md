# CLAUDE.md

## 项目概述

本项目是一个面向希腊雅典本地 boutique / 服装店的小型商品展示网站。

当前项目不是完整支付电商，主要目标是：

* 展示服装店商品
* 管理商品图片、价格、尺码、库存和分类
* 支持后台添加、编辑、删除商品
* 支持 CSV 批量导入商品
* 支持商品自动翻译
* 支持英文和希腊语前台展示
* 支持中文后台管理
* 支持生成 Skroutz 可用的 `feed.xml`
* 支持 Instagram / WhatsApp 联系入口
* 支持作为实体服装店的线上商品展示页面

不要重做项目，不要从零开始搭建。

---

## 技术栈

本项目使用：

* Next.js / React
* TypeScript
* Supabase 数据库
* Supabase Storage 图片存储
* Vercel 部署
* 后台简单密码保护或 admin 保护
* DeepSeek API / 后端翻译接口
* Skroutz XML feed

重要原则：

* 不要把 API Key 写死在前端。
* 不要把 Supabase service role key 暴露到浏览器。
* 商品、图片、价格、库存、尺码等数据应该来自 Supabase，不要写死在代码里。
* 固定 UI 文案可以用 i18n 或代码管理。
* 商品内容必须通过数据库和后台管理。

---

## 当前生产网站

Production URL:

```text
https://greek-clothing-store.vercel.app
```

重要页面：

```text
/
 /admin
/feed.xml
/product/[sku]
```

不要破坏这些页面和路由。

---

## 项目定位

这个网站是给希腊雅典本地服装店使用的模板。

主要适合：

* 女装店
* 男装店
* 鞋店
* 包包店
* 行李箱店
* 首饰 / 墨镜 / 配饰店
* 小型 boutique
* 需要对接 Skroutz 的本地商家

当前不做在线支付，不做复杂订单系统，不做多门店库存同步。

---

## 核心业务规则

### 1. 商品数据规则

商品数据必须来自 Supabase `products` 表。

不要把商品写死在代码里。

商品字段建议包括：

```text
sku
name_cn
name_gr
name_en
description_cn
description_gr
description_en
category
price
stock
sizes
image_url
image_urls / gallery_images
is_active
created_at
updated_at
```

如果现有字段名称不同，先检查当前数据库结构，再做最小修改。

不要随意删除字段或重建 products 表。

---

### 2. 商品分类规则

固定分类包括：

```text
men
women
shoes
bags
luggage
hats
jewelry
other
```

前台可以显示为英文 / 希腊语。

后台固定中文显示，例如：

```text
男装
女装
鞋子
包包
行李箱
帽子
首饰
其他
```

不要随意改分类 key，否则可能影响：

* 商品筛选
* CSV 导入
* Skroutz feed
* 旧商品数据
* 前台导航

---

### 3. 多语言规则

前台主要支持：

* English
* Greek

后台固定中文。

商品内容使用数据库字段：

```text
name_cn
name_en
name_gr
description_cn
description_en
description_gr
```

前台读取规则：

```text
英文界面：优先 name_en / description_en，fallback 到中文
希腊语界面：优先 name_gr / description_gr，fallback 到英文，再 fallback 到中文
```

不要让英文界面混入希腊语，除非是 fallback 兜底。
不要让希腊语界面混入乱码。

---

### 4. 希腊语编码规则

`feed.xml` 和网页必须正确支持希腊语。

XML 必须使用：

```xml
<?xml version="1.0" encoding="UTF-8"?>
```

Response header 应该包含：

```text
Content-Type: application/xml; charset=utf-8
```

不要使用这些方式错误处理希腊语文本：

```text
TextEncoder
encodeURIComponent
decodeURIComponent
escape
unescape
Buffer 转换希腊语文本
```

只需要正确转义 XML 特殊字符：

```text
&
<
>
"
'
```

不要把希腊语转码成乱码。

---

## Skroutz Feed 规则

`/feed.xml` 是重要功能，不要破坏。

Skroutz feed 应该从 Supabase products 表读取商品。

商品字段优先级：

```text
name：优先 name_gr，再 fallback name_en，再 fallback name_cn
description：优先 description_gr，再 fallback description_en，再 fallback description_cn
price：使用数据库 price
stock：使用数据库 stock
image：使用 image_url 或主图
category：使用固定 category
sku：使用 sku
```

如果商品没有 sku，不应该生成无效 feed item。

如果商品被隐藏 / 下架 / is_active=false，不应该出现在 feed 中。

不要为了改 UI 破坏 `/feed.xml`。

修改 feed 后必须测试：

```text
/feed.xml
npm run build
```

---

## 后台管理规则

后台 UI 固定中文。

后台应该支持：

* 添加商品
* 编辑商品
* 删除 / 下架商品
* 上传或填写商品图片 URL
* 管理商品分类
* 管理价格、库存、尺码
* CSV 批量导入
* 自动翻译商品名称和描述
* 预览商品数据
* 查看商品列表

后台优先做实用，不要只追求好看。

后台按钮和表单要适合店员使用，字段名称应使用中文。

---

## 商品图片规则

图片可以使用：

* Supabase Storage
* 外部图片 URL
* 后台填写 image_url
* 多图 URL 列表

商品详情页建议支持：

* 主图
* 多图轮播 / 缩略图
* 正面图
* 背面图
* 细节图

图片上传和压缩规则：

* 支持 JPG / PNG / WebP
* 尽量转换为 WebP
* 不要上传过大的原图
* 不要让图片处理破坏已有商品数据

如果图片处理失败，应该给出明确错误，不要让整个后台崩溃。

---

## CSV 导入规则

CSV 导入是重要功能，不要破坏。

CSV 建议字段：

```text
sku
name_cn
description_cn
name_en
description_en
name_gr
description_gr
category
price
stock
sizes
image_url
image_urls
```

导入规则：

* 导入前预览
* sku 已存在则更新
* sku 不存在则新增
* 显示成功数量
* 显示失败数量
* 显示失败原因
* 不要因为一行失败导致整个导入失败
* 分类必须匹配固定 category key
* price 必须是有效数字
* stock 必须是有效数字

不要改坏现有 CSV 模板和导入逻辑。

---

## 自动翻译规则

自动翻译主要用于：

* 中文商品名称 → 英文 / 希腊语
* 中文商品描述 → 英文 / 希腊语

翻译 API 必须走后端。

不要把 DeepSeek API Key 或其他 API Key 暴露到前端。

后台可以支持：

* 单个商品自动翻译
* CSV 导入时补全缺失翻译
* 批量翻译

翻译失败时：

* 不要阻止商品保存
* 显示错误原因
* 允许用户手动填写

---

## 商品详情页规则

商品详情页 `/product/[sku]` 应该保持简单清晰。

建议包含：

* 商品主图
* 多图预览
* 商品名称
* 商品描述
* 价格
* 分类
* 库存状态
* 尺码选择
* 联系按钮
* Instagram / WhatsApp
* 可选 Skroutz 跳转按钮

当前不做购物车和在线支付。

不要加入复杂支付流程，除非明确要求。

---

## 前台页面规则

前台应该适合服装店展示。

重点是：

* 商品图片清晰
* 分类导航明显
* 手机端体验好
* 商品卡片整齐
* 商品详情页简单
* 联系方式明显
* 多语言切换正常
* SEO 基础正常

不要把首页做得太复杂。
小店网站应该简洁、快、容易维护。

---

## 移动端规则

手机端非常重要。

必须注意：

* 商品列表不能太挤
* 图片比例统一
* 筛选分类容易点击
* WhatsApp / Instagram 联系入口明显
* 详情页图片加载不能太慢
* 语言切换不能挡住内容
* 后台手机端至少能完成基础商品管理

---

## SEO 规则

基础 SEO 应该包括：

* 首页 title
* 首页 description
* 商品详情页 title
* 商品详情页 description
* Open Graph 图片
* 商品结构化信息可以后续再加
* `/feed.xml` 可访问
* 图片 alt 文案

不要为了 SEO 牺牲功能稳定性。

---

## 客户模板化规则

这个项目未来可能卖给不同服装店客户。

所以不要把以下内容写死在代码里：

```text
店名
Logo
地址
电话
WhatsApp
Instagram
营业时间
首页文案
主题色
Skroutz 店铺信息
```

这些最好放到：

* site_config 表
* 环境变量
* 后台设置页面
* 配置文件

以后复制给客户时，只需要改配置和数据库，不应该到处改代码。

---

## 数据安全规则

商品、图片、价格、库存和客户配置是业务数据。

不要随意清空数据库。
不要随意 drop table。
不要随意删除 Supabase Storage 文件。

删除商品时优先使用：

```text
is_active = false
deleted_at
hidden
archived
```

除非用户明确要求硬删除。

---

## Supabase 规则

修改 Supabase 相关内容时要谨慎。

重点注意：

```text
products 表
site_config 表
Storage bucket
RLS policies
admin 权限
CSV 导入接口
翻译接口
feed.xml 查询逻辑
```

前端不应该拥有 service role 权限。

敏感操作应该走后端或受控 RPC。

---

## 部署规则

项目部署在 Vercel。

Production 通常从 GitHub `main` 部署。

提交前必须：

```text
npm run build
```

或根据项目实际命令运行：

```text
pnpm build
```

如果不确定包管理器，先检查 `package.json` 和 lock 文件。

不要把坏代码推到 main。

不要在没有确认的情况下修改 Production 环境变量。

---

## 测试清单

任何改动后，至少测试：

### 前台

* 首页可以打开
* 商品列表可以加载
* 分类筛选正常
* 商品详情页可以打开
* 图片正常显示
* 手机端布局正常
* 英文 / 希腊语切换正常
* WhatsApp / Instagram 链接正常

### 后台

* 可以登录后台
* 可以新增商品
* 可以编辑商品
* 可以删除 / 下架商品
* 可以修改价格、库存、尺码
* 可以上传或填写图片
* CSV 导入正常
* 自动翻译正常
* 商品保存后前台能看到

### Feed

* `/feed.xml` 可以访问
* XML 顶部是 UTF-8
* 希腊语不乱码
* 商品价格正确
* 商品图片链接正确
* 下架商品不出现在 feed
* XML 特殊字符正确转义

### 构建

* `npm run build` 或 `pnpm build` 通过
* TypeScript 无严重错误
* Vercel 部署成功

---

## 不要做的事情

除非用户明确要求，不要添加：

* 在线支付
* 复杂购物车
* 订单系统
* 会员系统
* 多门店库存同步
* 真实物流系统
* 复杂 ERP
* 复杂 CRM
* 直播带货
* 大规模重构
* 完整项目重做

当前网站定位是：

```text
服装店商品展示 + 后台管理 + Skroutz feed
```

不要把它改成大型电商平台。

---

## 开发风格要求

每次任务都应该：

1. 先检查当前代码和数据库结构。
2. 说明当前行为。
3. 找到最小安全改动。
4. 只修改必要文件。
5. 不做无关重构。
6. 保持现有功能稳定。
7. 修改后运行 build。
8. 输出修改文件、测试结果和风险点。

如果不确定用户想法，先问，不要擅自大改。

---

## 当前优先级

最高优先级：

1. 保持 `/feed.xml` 稳定。
2. 保持 Supabase 商品数据稳定。
3. 保持后台商品管理稳定。
4. 保持 CSV 导入稳定。
5. 保持多语言和希腊语不乱码。
6. 保持图片上传 / 图片 URL 功能稳定。
7. 保持 Vercel Production 可部署。

下一阶段可优化：

1. 商品多图体验。
2. 图片 WebP 压缩。
3. 商品详情页布局。
4. 手机端商品列表。
5. 后台商品管理体验。
6. 站点配置模板化。
7. 数据备份导出。
8. SEO 和性能优化。

不要优先做支付和复杂订单。
