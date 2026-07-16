# v1 阶段 5A 本地验证报告

日期：2026-07-16  
分支：`codex/hardening-p2-public-data-boundary`  
基线：`49aeb93afd1ea08e41c692af9acbddb6b169a10a`  
已验证实现 HEAD：`6d004d2`  
结论：**Local integration verified. GitHub CI, isolated Preview, and Production are not yet verified.**

## 已关闭的风险

| 风险 | 本地结论 | 主要证据 |
|---|---|---|
| 5A-01 JSON-LD 持久化 script 边界逃逸 | 已修复 | 安全 serializer 转义 `<`、`>`、`&`、U+2028、U+2029；原始商品 HTML 仅保留一个可解析 JSON-LD script。 |
| 5A-02 匿名角色可读取完整 products 行 | 已修复 | migration 撤销表级 SELECT，只授予明确公开列；匿名 `select(*)` 和采购列查询均得到 PostgreSQL `42501`。 |
| 5A-03 低角色读取成本和供应商私密信息 | 已修复 | Products、Inventory、Suppliers 按 owner/staff/inventory/readonly 塑形；developer Cookie 与匿名均不能访问后台数据。 |
| 5A-04 角色响应可能进入共享缓存 | 已修复 | 相关 API 强制动态并返回 `private, no-store, max-age=0`；owner 后读取 readonly 不出现字段污染。 |
| 5A-05 消费者查询和字段合同分散 | 已修复 | Storefront、AI、Skroutz、Sitemap 使用集中显式列合同；静态门禁禁止公开 `select("*")`。 |

## 角色数据边界

| 身份 | Products / Inventory / Suppliers 结果 |
|---|---|
| 匿名 | 后台 API 401；公开 products 仅允许公开列。 |
| developer Cookie | 不等同于后台业务身份，后台商品/库存/供应商 API 401。 |
| readonly | 可读业务需要的商品和库存字段；无成本、供应商、补货或联系人字段；Suppliers 403。 |
| staff | 与 readonly 相同的采购数据边界；Suppliers 403。 |
| inventory | 可读供应商 ID/名称/编号、供应商 SKU、款号和补货线；无成本、VAT、联系人、电话、邮箱、地址和备注；不能写供应商。 |
| owner | 按既有设计读取和维护完整采购信息。 |

所有角色相关 JSON 响应均验证 `Cache-Control: private, no-store, max-age=0`、`Pragma: no-cache` 和 `Expires: 0`。

## 数据库与安装路径

- 新 migration：`20260716113954_restrict_public_product_data.sql`。
- migration 只收紧 `products` 的公开列权限，不删除或改写既有商品和供应商数据。
- `service_role` 继续拥有所需 products DML；RLS 与 active 商品公开策略保持启用。
- `supabase/client-init.sql` 已从 16 份有序 migration 重新生成并逐字节静态校验。
- `npx supabase db reset --local --no-seed`：通过。
- 16 份 migration 空库安装：通过。
- `client-init.sql` 空库安装：通过。
- `origin/master` 结构升级：通过；私有中文字段、内部条码、供应商关联、版本字段、库存投影和供应商联系数据均保持不变。
- 既有 P1、商品 4A、CSV 4B 的 client-init 与 legacy upgrade 路径全部重新通过。
- 本地 database advisors：0 项。

## 测试结果

| 门禁 | 结果 |
|---|---|
| `npm ci` / `npm audit` | 通过；0 vulnerabilities。 |
| `git diff --check` | 通过。 |
| `npm run typecheck` | 通过。 |
| `npm run build` | 通过；31 个页面生成完成。 |
| 单元测试 | 81/81 通过：P1 24、商品 14、CSV 38、5A 5。 |
| 集成测试 | 131/131 通过：P1 57、商品 39、CSV 28、5A 7。 |
| 数据库安全门禁 | P1、商品、CSV、5A 全部通过。 |
| 安装路径断言 | 15/15 通过：P1 7、商品 2、CSV 3、5A 3。 |
| 测试数据清理 | 通过；P1/商品/CSV/5A fixture 均为 0 残留。 |
| Secret scan | 通过；扫描 290 个源码、migration、文档、测试、快照和浏览器 Bundle 文件。 |

一次把全部集成命令串联在同一外层进程的执行因 300 秒工具上限被终止，没有测试断言失败；随后按 P1、商品、CSV、5A 分组重新执行，每组均取得明确 `exit 0` 和完整通过结果。

## 尚未完成的阶段门禁

1. 推送阶段分支并创建独立 Draft PR。
2. GitHub required jobs 在 Ubuntu Runner 全绿。
3. 建立一对一隔离 Supabase/Vercel Preview，并记录 PR、SHA、URL、Deployment ID、project ref、region、migration 数量和环境变量范围。
4. 在 Preview 复核恶意 JSON-LD、匿名 PostgREST 列权限、六类身份字段矩阵和三种视口。
5. 清理全部 Preview 数据、Storage 对象、临时凭据与分支环境变量。
6. 完成单人维护者签核、不可移动 local/CI/Preview 标签，并以 merge commit 合并。

在这些证据完成前，5A 不能描述为 Preview、Production 或最终发布已通过，也不能开始 5B。
