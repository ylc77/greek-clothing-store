\## 1. Development stage rule



This application is still in a pre-release stage. It currently has no real users and no real production data.



Agents may make structural changes freely when needed, including database schema changes, UI changes, API changes, and logic refactors. Do not over-optimize for backward compatibility at this stage.



Production constraints, real user data safety, migrations, and long-term compatibility will be handled before the official release.



\---



\## 2. AgentMD purpose rule



The role of this file is to describe common mistakes and confusion points that agents might encounter as they work in this project.



If you ever encounter something in the project that surprises you, please alert the developer working with you and indicate that this is the case in the AgentMD file to help prevent future agents from having the same issue.


\---


\## 3. Database initialization source of truth


The migration chain now starts with `supabase/migrations/20260702000000_baseline_store_schema.sql`. It creates `products.id` as `bigint` and has been verified from an empty local database with `npx supabase db reset`.


Use the migration chain as the source of truth for new customers. Keep `client-init.sql` only as a fallback/reference file; do not use it as the normal deployment path or mix it with `supabase db push`.


\---


\## 4. Local development port collision


Port `3000` may already be occupied by another workspace (observed serving the unrelated "华人生活+" project while this repository was being verified).


Before treating localhost responses as clothing-store verification, confirm the page identity or start this project on an explicit unused port such as `3010`. Do not stop or modify the other project's process unless the developer explicitly requests it.


\---


\## 5. Documentation encoding and stale deployment guidance


The previous `README.md` and `docs/deploy-client-zh.md` content was observed with mojibake, and both previously instructed new customers to run `supabase/client-init.sql`.


Treat any remaining deployment document that recommends `client-init.sql` as stale. Keep edited Markdown files in UTF-8 and document the lightweight `supabase link` / `db push --dry-run` / `db push` workflow instead.


\---


\## 6. Local Supabase CLI collisions


The root `.env.local` was observed with a UTF-8 BOM, which Supabase CLI 2.109.1 rejected as an invalid environment-variable name. Do not expose or overwrite its secrets while working around this; remove the BOM safely or temporarily exclude the file from CLI startup.


Another workspace may already run local Supabase on the default 5432x ports. If `supabase/config.toml` currently defines dedicated 5532x ports, use that checked-in configuration; do not assume those ports without inspecting the file. Before `supabase start`, confirm Docker Desktop is running and inspect active containers for projects such as `huaren_life_plus`, `restaurant`, or `clothing_web`.


If database, Studio, or API ports conflict, change only this repository's `supabase/config.toml` and record the new convention here. Do not stop or modify another project's Supabase containers to verify this repository.

