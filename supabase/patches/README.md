# 数据库升级补丁

## 当前状态

历史 patch 已合并进 `supabase/client-init.sql`。项目正式交付第一个客户后，后续数据库变更必须在此目录新增 patch 文件。

## 新客户

执行 `supabase/client-init.sql` 即可完成全部初始化。

## 老客户升级

**不要直接执行 `client-init.sql`**，已有真实数据会被覆盖。

应为每次数据库变更新建本目录下的 SQL 补丁文件，例如：
```
supabase/patches/2026-07-01-add-new-field.sql
```

补丁规则：
- 使用 `alter table add column if not exists`
- 使用 `create index if not exists`
- 使用 `drop policy if exists` 后再 `create policy`
- 使用 `create or replace function`
- 可重复执行不报错

## 对应代码维护

每次新增 patch 时，同步更新：
- `supabase/client-init.sql`（新客户初始化）
- `docs/`（相关文档）

## 历史 patch 记录

- 2026-06-22: products.is_active 默认值 + NULL 修复 → 已合并进 client-init.sql
- 2026-06-22: 商品 category/subcategory slug 规范化 → 仅数据修复，新客户无需
