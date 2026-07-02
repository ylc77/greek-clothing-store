# Supabase 数据库升级补丁

当前项目还没有正式售卖，也没有需要升级的老客户数据库。

## 新客户初始化

新客户只需要执行：

```txt
supabase/client-init.sql
```

如果需要演示商品，再执行：

```txt
supabase/demo-products.sql
```

## 当前 patch 状态

`supabase/patches/` 暂时不保留历史 SQL patch。

原因：

- 项目尚未交付给老客户使用。
- 旧 patch 的字段和策略已经合并进 `supabase/client-init.sql`。
- 保留旧 patch 容易让新客户误执行重复脚本。

## 以后什么时候新增 patch

等项目正式交付后，如果数据库结构再次升级，再按日期新增 patch 文件，例如：

```txt
2026-07-10-add-example-field.sql
```

未来 patch 应遵守：

- 使用 `alter table ... add column if not exists`
- 使用 `create index if not exists`
- 使用 `drop policy if exists` 后再 `create policy`
- 使用 `create or replace function`
- 可以重复执行
- 不破坏已有真实客户数据
