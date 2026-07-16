# v1 阶段 5B 本地验证报告

日期：2026-07-16
分支：`codex/hardening-p2-storage-image-security`
基线：`7d943eae581aeb36569d3b86083415ece985fd55`
已验证实现 HEAD：`8a669b3`
结论：**Local integration verified. GitHub CI, isolated Preview, and Production are not yet verified.**

## 已关闭的风险

| 风险 | 本地结论 | 主要证据 |
|---|---|---|
| 5B-01 伪造 MIME、解码失败回退和图片资源消耗 | 已修复 | 只接受声明 MIME 与 magic bytes 同时匹配的 JPEG/PNG/WebP；字节、像素、宽高、动画/多页、损坏输入和 Sharp 处理失败全部 fail closed，接受输入统一重编码为 WebP。 |
| 5B-02 Storage 与数据库引用分步失败 | 已修复 | 私有操作记录在 Storage 写入前建立；数据库引用失败补偿删除对象；引用移除后对象删除失败进入 `cleanup_pending`；真实 Storage/API 故障注入和最终只读对账通过。 |
| 5B-03 AI 参考图任意服务端 URL 获取 | 已修复 | 仅允许当前客户 Storage 或明确配置的 exact HTTPS origin；每次 DNS/重定向重新验证，阻断 IPv4/IPv6 私网、loopback、link-local、metadata、保留地址，固定已验证 IP，并限制超时、类型、Content-Length 和流式体积。 |
| 5B-04 永久删除缺少历史保护和恢复 | 已修复 | service-role-only RPC 在同一事务内锁定商品、核对订单/流水/库存操作/商品操作/导入记录/余额/旧库存、登记对象清理后删除；有历史或非零库存时阻断并要求下架，Storage 删除失败可恢复。 |

## 图片和 Storage 合同

- `product-images` 是唯一受管理 bucket，公开仅用于读取；匿名和 authenticated 不能上传、覆盖或删除。
- bucket 限制为 JPEG、PNG、WebP，单对象最大 10 MiB；应用另有 20 文件、50 MiB 请求、40MP 和 12000px 边界。
- 商品路径为 `products/{productId}/{skuHash}/{main|gallery|ai}/{uuid}.webp`，避免同名 SKU 清洗碰撞和跨商品覆盖。
- Logo、Hero、Category 使用严格 target enum 和不可预测 UUID 路径；分类必须先建立数据库 ID。
- 外部/旧式 URL 可以从引用中移除，但不会被新代码当成受管理对象跨商品删除。
- `storage:reconcile` 永远只读；`storage:recover` 仅由持有 service role 的维护者在再次确认 project ref 后运行。

## 数据库与安装路径

- 新 migration：`20260716141423_harden_storage_image_lifecycle.sql`。
- 新私有表：`storage_object_operations`、`product_delete_operations`，均启用 RLS、无公开 policy、anon/authenticated 无权限、仅 service role 维护。
- 新 RPC：`product_permanent_delete_prepare_rpc(bigint, uuid, text, text[])`，`SECURITY DEFINER`、空 `search_path`、仅 service role 可执行。
- `products.image_width` / `image_height` 在旧库不存在时补齐；已有值和图片 URL 保留。
- `supabase/client-init.sql` 已由 17 份有序 migration 重新生成并通过逐字节静态门禁。
- `npx supabase db reset --local --no-seed`：通过。
- 17 份 migration 空库、`client-init.sql` 空库、5B legacy upgrade：3/3 通过。
- P1、商品 4A、CSV 4B、公共数据 5A 的 client-init/legacy 路径全部重新通过。
- Supabase database advisors：0 项。

补充运行的 `supabase db lint` 会把两个既有 POS 函数内“先 `CREATE TEMP TABLE`、后使用临时表”的语句报告为关系不存在，并报告一个既有未使用变量警告。相关 SQL 的创建语句位于引用之前，POS 18/18 事务、故障和并发集成测试全部通过；该静态分析结果不是 5B 变更，也不是运行时错误，未通过修改已验收 P1 RPC 来掩盖。

## 测试结果

| 门禁 | 结果 |
|---|---|
| `npm ci` / `npm audit` | 通过；0 vulnerabilities。 |
| `git diff --check` | 通过。 |
| `npm run typecheck` | 通过。 |
| `npm run build` | 通过；31 个页面生成完成。 |
| 单元测试 | 98/98 通过：P1 24、商品 14、CSV 38、5A 5、5B 17。 |
| 集成测试 | 139/139 通过：P1 57、商品 39、CSV 28、5A 7、5B 8。 |
| 5B 故障注入 | Storage 上传失败不写引用；DB 引用失败补偿对象；Storage 删除失败保留恢复任务；永久删除事务阻断/清理均通过。 |
| 数据库安全门禁 | P1、商品、CSV、5A、5B 全部通过。 |
| 安装路径断言 | 18/18 通过：P1 7、商品 2、CSV 3、5A 3、5B 3。 |
| Secret scan | 通过；扫描 265 个源码、migration、文档、测试、快照和浏览器 Bundle 文件。 |
| Storage reconciliation | `object/reference/orphan/missing/pending = 0/0/0/0/0`，`mutated=false`。 |
| 测试数据清理 | products、Variants、orders、payments、操作记录、删除记录、Storage objects、developer_access 均为 0。 |

## 尚未完成的阶段门禁

1. 推送阶段分支并创建独立 Draft PR。
2. GitHub 四个 required jobs 在 Ubuntu Runner 全绿，包含 5B unit/integration/install/static/security/reconciliation。
3. 建立一对一隔离 Supabase/Vercel Preview，记录 PR、SHA、URL、Deployment ID、project ref、region、migration 数量和环境变量范围。
4. Preview 复核角色上传、伪造 MIME、替换/删除恢复、永久删除保护、公开读取和三种视口。
5. Preview 清理全部测试行、Storage 对象、临时 developer credential、分支环境变量和部署快照凭据。
6. 完成单人维护者签核、不可移动 local/CI/Preview 标签，并以 merge commit 合并。

上述证据完成前，5B 不能描述为 Preview、Production 或最终发布已通过，也不能开始 5C。
