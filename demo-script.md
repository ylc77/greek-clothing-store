# Greek Clothing Store 中文宣传演示视频分镜

目标长度：60-90 秒  
视频比例：16:9  
录制尺寸：1920x1080  
语言：中文旁白 / 中文字幕  
输出目录：`demo-videos/`

## 一、计划新增文件

- `scripts/demo-record.js`：Playwright 自动录屏脚本，输出 webm。
- `demo-script.md`：中文分镜、字幕和旁白文案。
- `demo-videos/`：脚本运行后生成录屏文件和 debug 截图。

本次不修改业务代码、不修改 Supabase、不修改后台功能、不提交、不 push。

## 二、视频分镜

| 时间 | 场景 | 画面 | 字幕 |
| --- | --- | --- | --- |
| 0-6s | 首页 Hero | 打开首页，展示品牌、Logo、主视觉和首页入口 | 一个专为服装店打造的商品展示网站 |
| 6-14s | 首页滚动 | 慢速滚动首页，展示分类、商品卡片、店铺信息 | 首页展示品牌形象、分类入口和最新商品 |
| 14-22s | 分类页 | 进入女装或分类页，展示二级分类筛选和商品列表 | 分类页支持男装、女装、鞋包配饰和二级筛选 |
| 22-32s | 商品详情 | 打开商品详情页，展示多图、价格、库存、尺码按钮 | 商品详情页展示多图、价格、尺码、库存和咨询入口 |
| 32-44s | AI 客服 | 打开 AI 客服，输入尺码建议问题，等待回复 | AI 客服可以根据身高体重给出尺码建议 |
| 44-52s | 后台登录 | 进入 `/admin`，输入后台密码登录 | 后台用密码保护，店主可以安全管理商品 |
| 52-60s | 商品管理 | 展示后台商品列表、上架状态、库存、图片 | 商品管理列表集中查看上架状态、库存和图片 |
| 60-70s | 编辑商品 | 展示编辑表单中的价格、分类、多语言、尺码库存 | 编辑商品时可以维护价格、分类、多语言内容和尺码库存 |
| 70-78s | 图片管理 | 展示主图、多图和上传区域，不保存修改 | 图片上传支持主图和多图，适合展示正面、背面和细节 |
| 78-84s | CSV | 展示 CSV 导入导出入口 | CSV 导入导出让批量维护商品更高效 |
| 84-92s | 店铺设置 | 展示 Logo、Hero、WhatsApp、Instagram 设置 | 店铺设置可以维护 Logo、首页图、WhatsApp 和 Instagram |
| 92-100s | Skroutz Feed | 打开 `/feed.xml`，展示 XML feed | 系统自动生成 Skroutz XML Feed，方便商品进入比价平台 |
| 100-108s | 结束页 | 深色结束画面，展示核心功能总结 | 商品展示网站 · 后台管理 · AI 客服 · Skroutz Feed |

如果要严格控制在 90 秒内，可以剪掉后台编辑和店铺设置中的停留时间。

## 三、旁白文案

### 版本 A：60-90 秒简洁版

这是一套为服装店打造的商品展示网站。  
首页可以展示品牌形象、商品分类、最新商品和店铺联系方式。  
顾客可以进入男装、女装、鞋子、包包等分类，通过二级分类快速找到想看的商品。  
在商品详情页，顾客可以查看多张图片、价格、库存、尺码，并通过 WhatsApp 或 Skroutz 继续咨询和购买。  

网站还内置 AI 客服。顾客可以直接询问尺码建议，比如输入身高体重，系统会根据商品尺码和库存给出参考建议。  

店主可以进入后台管理商品。这里可以新增、编辑、上下架商品，维护价格、分类、多语言描述、尺码库存和图片。  
图片支持主图和多图，适合展示正面、背面和细节图。  
CSV 导入导出可以帮助批量维护商品，店铺设置可以管理 Logo、首页图、WhatsApp 和 Instagram。  

系统还会自动生成 Skroutz XML Feed，方便商品提交到 Skroutz 做平台导流。  
这套系统把商品展示、后台管理、AI 客服和 Skroutz Feed 集中在一起，让服装店更容易开始线上获客。

### 版本 B：更宣传一些

如果你经营一家服装店，这套系统可以帮你快速拥有自己的线上商品展示网站。  
顾客打开首页，就能看到品牌形象、商品分类和最新商品。  
进入分类页后，可以按男装、女装、鞋包配饰和二级分类浏览。  
商品详情页支持多张图片、尺码、库存、WhatsApp 咨询和 Skroutz 跳转。  

更重要的是，网站内置 AI 客服。顾客可以直接询问尺码、材质和搭配建议，减少重复沟通。  
店主则可以在后台维护商品、图片、库存、多语言内容和 CSV 数据。  
同时，系统会自动生成 Skroutz Feed，方便接入平台流量。  

从商品展示，到后台管理，再到 AI 客服和 Skroutz 导流，一套系统就能完成服装店线上展示的核心流程。

## 四、运行所需环境变量

必须提供：

```bash
BASE_URL=http://localhost:3000
ADMIN_PASSWORD=你的后台密码
```

说明：

- `BASE_URL` 可以是本地地址，也可以是 Vercel 预览/线上地址。
- `ADMIN_PASSWORD` 只用于演示登录后台，不会写入脚本。
- 脚本不会读取真实 Supabase service role key，也不会展示任何密钥。

可选：

```bash
HEADLESS=0
```

设置 `HEADLESS=0` 可以打开可见浏览器窗口，方便调试录屏流程。

## 五、如何运行录屏

先确保网站已经启动：

```bash
npm run dev
```

另开一个终端运行录屏：

```bash
set BASE_URL=http://localhost:3000
set ADMIN_PASSWORD=你的后台密码
node scripts/demo-record.js
```

PowerShell 写法：

```powershell
$env:BASE_URL="http://localhost:3000"
$env:ADMIN_PASSWORD="你的后台密码"
node scripts/demo-record.js
```

如果没有安装 Playwright：

```bash
npm install -D playwright
npx playwright install chromium
```

录制完成后，webm 会输出到：

```text
demo-videos/
```

如果某个场景失败，脚本会继续录制，并把 debug 截图保存到：

```text
demo-videos/debug/
```

## 六、如何转 mp4

使用 ffmpeg：

```bash
ffmpeg -i demo-videos/greek-clothing-store-demo.webm -c:v libx264 -pix_fmt yuv420p -crf 20 -preset medium -c:a aac demo-videos/greek-clothing-store-demo.mp4
```

如果文件名带时间戳，请替换成实际 webm 文件名。

更适合剪映导入的版本：

```bash
ffmpeg -i input.webm -vf "scale=1920:1080,fps=30" -c:v libx264 -pix_fmt yuv420p -crf 20 -preset medium -c:a aac output.mp4
```

## 七、注意事项

- 后台只做展示，不点击保存，不修改线上数据。
- 录制线上地址时，请确认后台使用的是演示数据或测试数据。
- 不要把录制出来的视频文件提交到 GitHub。
- 不要在视频里展示真实密钥、Supabase service role key 或后台密码。
- 如果 AI 接口没有额度或不可用，可以后期剪掉等待片段，或改用一条已经有 AI 回复的演示数据。
- 推荐录制前准备 3-6 个带图片、尺码和库存的商品，画面会更完整。
- 推荐先本地录制一遍，确认镜头顺序，再录线上版本。
