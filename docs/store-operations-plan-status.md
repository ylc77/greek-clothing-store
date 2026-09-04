# 门店改造总方案：实现与验收状态

依据：用户提供的 `greek-clothing-store-codex-modification-plan.md`（完整读取，共十三节）。本文件区分已经实现的软件、尚未验收的环节和后续阶段，不把建议目录、示例提示词或远期目标当成已完成事实。

## 执行边界

方案第九节要求不要一次完成全部阶段，第十一节要求在 Phase 1 已验收基础上进入 Phase 2，第十二节要求批量到货稳定后进入 Phase 3，Phase 4 要求真实硬件及正式服务商测试条件。此次继续完成 Phase 1 软件缺口和 CI 门禁，不越过这些前置条件。

原目录的 Viva/BOX NOW 工作仍未提交，继续保留不动。当前工作位于独立 `feat/store-operations-workflow` 工作树和 PR #34，没有自动合并、生产部署或远程数据库修改。

## 分阶段状态

| 阶段 | 已有证据/实现 | 未完成的门禁或功能 |
| --- | --- | --- |
| Phase 0 | 独立分支、基线报告、本地测试环境；参见 Phase 1 报告 | 每次新提交仍需云端 CI |
| Phase 1 | 六入口壳层、角色默认首页、键盘扫码、POS 精确条码自动加入、商品/到货后标签队列、本次数量、PT-1509 校准页 | 受保护 Preview 的真实员工业务验收；实物打印与扫码闭环 |
| Phase 1 本次补齐 | 人工打印确认、本地累计张数、旧队列确认保护、独立设备偏好组件、非敏感浏览器偏好、依赖审计修复 | 人工确认不能替代打印机反馈；不是数据库打印历史 |
| Phase 2 | 设计目标已阅读，现有单规格事务保持不变 | 整批到货表/RPC、preflight、历史、批次补打、备份恢复及并发故障测试尚未实现 |
| Phase 3 | 现有整单作废及库存加回保持原功能 | 正式部分退货/换货、可退数量、损坏/隔离、差额和外部参考号事务尚未实现 |
| Phase 4 | 浏览器打印可校准；继续保留非税务票据提示 | 真机、驱动、会计师/服务商正式要求、沙箱；没有 ESC/POS、桥、财政票据或支付终端接入 |

## 方案需明确的差异

- 文档一处建议所有角色默认工作台，后文指定 staff=POS、inventory=到货；采用后者及用户此前明确要求。小屏 POS 隐藏沿用现有设备限制，尚未批准取消。
- 导航示例列出很多直接入口，与用户此前六个一级入口目标不同；采用六入口壳层，能力通过上下文/次级页进入。
- 新生成内部条码继续使用 Variant SKU；已有商品自带条码不得覆盖。内部 Code 128 不是 GS1 EAN。
- 当前到货仍是**单规格逐次事务提交**，不能称为整批原子提交。
- 方案流程 E 的“整批盘点任务”没有对应单独实施阶段；当前只有既有单规格 stocktake。后续需要独立定义任务生命周期、差额确认和事务验收，不得将现状标成完成。
- 大型后台没有完全抽成建议目录；壳层、扫码、队列和设备设置已独立，POS 购物车等原业务保留。完全抽取属于后续低风险分次重构，不一次性重写。
- 示例中 Skroutz/快递面单不代表重新启用 Skroutz。原目录的 Viva/BOX NOW 接入不在本 PR 内，也不得被旧方案示例回退。
- 网页不能证明退款、打印或财政服务已完成；人工确认仅代表操作者确认，外部系统结果仍需独立证据。

## 下一阶段准入

先在隔离环境完成：S=2/M=3 打印五张；补货三件打印三张；同码扫码两次；错误码后恢复；测试结账/作废及流水核对。记录 PT-1509 型号、驱动、纸张、实测尺寸、条码内容和操作者。不得在真实客户商品上进行测试交易。

Phase 1 验收后将 Phase 2 放入独立审查批次，首先建立整批回滚、重放、并发、条码冲突及备份恢复测试，然后新增单调 migration 和事务实现。不要把多次 adjust 请求包装成“原子批次”。Phase 3 依赖此批次稳定后再实施。

## 本次回滚

本次变更只涉及队列本地状态、打印显示偏好、测试、文档及兼容版本锁文件。回退对应提交即可；浏览器偏好键为 `clothing.label-print-profile.v1`，只含两个显示开关及两个偏移数字。没有数据库迁移或库存业务回滚。回退前核对未打印队列和结果未知的业务请求，不得删除流水或重新创建已成功业务。

## 本次实际验证（2026-09-04）

| 检查 | 结果 |
| --- | --- |
| 新测试先红后绿 | 初次两个打印确认测试失败；实现后全部通过，未删断言 |
| npm ci / npm audit --audit-level=high | 通过，0 漏洞 |
| test:admin-navigation | 7/7 |
| test:inventory | 12 单元、22/22 集成（并发、故障注入、预留、权限） |
| test:pos | 5 单元、18/18 集成（checkout/void、幂等、并发、故障注入） |
| test:barcode | 7 单元、批量并发/重放/已有条码保护集成通过，清理零残留 |
| test:operations | 28/28 单元、6 组集成、32 份 migration 静态检查及数据库安全检查通过 |
| test:store-workflow-browser | 12 角色/视口组合、Feature、标签确认/偏好、重试、扫码、三视口打印预览通过；模拟数据库写入 0 |
| build / typecheck / git diff --check | 全部通过；正常 build 恢复正常 next-env 引用 |
| test:developer-secrets | 465 个文件及浏览器构建产物扫描通过 |

这些是当前本地自动化证据，不是新提交云端 CI、受保护 Preview 业务测试或真实硬件证据。没有修改 API、认证、schema、migration、Supabase 远程项目或 Production。

修改文件：`agents.md`、`components/admin-dashboard.tsx`、`components/label-print-preview.tsx`、`components/label-device-settings.tsx`、`components/operation-label-queue.tsx`、`lib/operation-label-queue.ts`、`lib/print-profile.ts`、`tests/store-operations-workflow.test.ts`、`scripts/admin-navigation-browser-test.mjs`、`package-lock.json`、`docs/admin-user-guide.md`、`docs/barcode-label-printer-test-log.md`、`docs/store-operations-workflow-phase-1.md`、本状态报告。
