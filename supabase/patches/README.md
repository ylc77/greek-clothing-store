# 数据库升级补丁

## 当前规则

`supabase/client-init.sql` 是新客户完整初始化文件。

`supabase/patches/` 目录用于已有客户数据库升级。已有真实数据的客户不要直接重新执行 `client-init.sql`。

## 新客户

只需要执行：

```txt
supabase/client-init.sql
```

如需演示数据，再执行：

```txt
supabase/demo-products.sql
```

## 老客户升级

按时间顺序执行尚未执行过的 patch 文件。

patch 文件应遵守：

- 使用 `alter table ... add column if not exists`
- 使用 `create index if not exists`
- 使用 `drop policy if exists` 后再 `create policy`
- 使用 `create or replace function`
- 可重复执行，不应破坏已有真实数据

## 历史 patch

- `2026-06-23-add-ai-assistant-fields.sql`：为 AI 导购补充 `size_chart`、`fit_type`、`style_tags`、`ai_keywords`。
- `2026-06-24-add-material-verified.sql`：为 AI 导购补充 `material_verified`。
- `2026-06-24-add-image-dimensions.sql`：为图片合规检查补充 `image_width`、`image_height`。

以上字段已经合并进 `supabase/client-init.sql`，新客户不需要单独执行这些 patch。
