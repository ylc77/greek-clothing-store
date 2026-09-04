# Barcode & Label Phase E - Printer Test Log

This document is for real thermal label printer acceptance testing.

Scope:
- Browser label printing only
- No database changes
- No SQL execution
- No POS checkout / void changes
- No inventory logic changes
- No Skroutz Feed changes
- No invoice / myDATA integration
- No printer SDK / ESC/POS integration

## Test Environment

| Item | Result |
| --- | --- |
| Test date |  |
| Tester |  |
| Printer model |  |
| Connection type | USB / Bluetooth / Wi-Fi / LAN |
| Label paper size |  |
| Operating system | Windows / macOS / iPadOS / Android |
| Browser | Chrome / Edge / Safari / Other |
| Test SKU |  |
| Test variant SKU |  |
| Test barcode |  |

## Test Steps

1. Open `/admin`.
2. Open the label printing entry.
3. Select one test variant.
4. If the variant has no barcode, generate barcode first.
5. Print a `40x30mm` label.
6. Print a `50x30mm` label.
7. Print a `60x40mm` label.
8. Scan the printed barcode with a barcode scanner.
9. Confirm the scanned value equals the variant barcode / variant SKU.
10. Open the POS checkout tab.
11. Scan the printed label into POS search.
12. Confirm POS finds the correct variant.
13. Run POS dryRun.
14. Confirm product name, price, and stock are correct.

## Size Test Results

| Label size | Barcode clear | Barcode scannable | Product name readable | Price readable | Direction correct | Blank page | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 40x30mm | Yes / No | Yes / No | Yes / No | Yes / No | Yes / No | Yes / No |  |
| 50x30mm | Yes / No | Yes / No | Yes / No | Yes / No | Yes / No | Yes / No |  |
| 60x40mm | Yes / No | Yes / No | Yes / No | Yes / No | Yes / No | Yes / No |  |

## Scanner And POS Validation

| Check | Result | Notes |
| --- | --- | --- |
| Scanned value equals barcode / variant SKU | Yes / No |  |
| POS search finds correct variant | Yes / No |  |
| POS dryRun succeeds | Yes / No |  |
| Product name is correct | Yes / No |  |
| Price is correct | Yes / No |  |
| Stock is correct | Yes / No |  |

## Print Quality Checks

| Check | Result | Notes |
| --- | --- | --- |
| Barcode line quality is clear | Yes / No |  |
| Long product name wraps correctly | Yes / No |  |
| Price is easy to read | Yes / No |  |
| Label margin is acceptable | Yes / No |  |
| No extra blank pages | Yes / No |  |
| Browser print workflow is acceptable for staff | Yes / No |  |

## CSS Adjustment Decision

| Question | Answer |
| --- | --- |
| Is barcode too wide or too narrow? |  |
| Is product name taking too much space? |  |
| Should font size be adjusted? |  |
| Should store name be hidden on small labels? |  |
| Should label padding be reduced? |  |
| Is print orientation correct? |  |
| CSS adjustment needed? | Yes / No |

## Browser Printing Decision

Continue using browser label printing if all are true:

- Barcode is consistently scannable.
- POS can identify the correct variant.
- dryRun returns correct product, price, and stock.
- There are no extra blank pages.
- Staff can accept the browser print workflow.

| Decision | Result |
| --- | --- |
| Continue browser label printing for now | Yes / No |
| Need printer SDK / ESC/POS soon | Yes / No |

## When To Consider SDK / ESC/POS

Consider a local print bridge, printer SDK, or ESC/POS only if one or more of these issues appear:

- Browser print alignment is unstable.
- Staff must repeatedly change paper settings manually.
- Blank pages cannot be avoided.
- Silent one-click printing is required.
- Multiple POS devices need to share one printer reliably.
- Cash drawer opening or printer cutter control is required.

## Final Test Result Template

```txt
Test date:
Printer model:
Connection type:
Label paper size:
Operating system:
Browser:

Test SKU:
Test variant SKU:
Test barcode:

Best label size:
Barcode scannable: Yes / No
POS recognized variant: Yes / No
dryRun normal: Yes / No
Blank pages: Yes / No
CSS adjustment needed:
Continue browser printing:
Need SDK / ESC-POS:

Notes:
```
# Phase 1 / PT-1509 实物验收（待执行）

本次新增浏览器 Profile 与校准页，不构成真实硬件通过证明。

| 检查 | 方法与期望 | 结果 |
| --- | --- | --- |
| 驱动设置 | PT-1509、50×30 mm、100%、0 边距、关闭页眉页脚 | 待实机 |
| 校准 | 校准页线框实测 20×5 mm，扫码内容 PT1509-TEST | 待实机 |
| 连续出纸 | S=2、M=3，恰好 5 张且每张一个标签，无尾部空白页 | 待实机 |
| 补货 | 原库存 20，补货 3，仅打印 3 张 | 待实机 |
| 重试 | 模拟响应丢失后复用原请求，库存及队列不重复增加 | 待实机 |
| 连扫 | 同码连续扫描 3 次，POS 数量为 3；不得超过可售库存 | 待实机 |
| 无匹配 | 错码明显提示，再扫描有效码，焦点保持可用 | 待实机 |
| 长条码/长文案 | 最长真实 SKU、希腊语、颜色与尺码不裁切，条码可读 | 待实机 |
| 其他纸张 | 40×30 / 60×40 分别校准与读取 | 待实机 |

请记录日期、系统、浏览器、驱动版本、纸张批次、扫码枪型号、扫描间隔设置、实物照片及测量数据。测试仅用隔离测试商品；不要用真实顾客订单进行试扣。
