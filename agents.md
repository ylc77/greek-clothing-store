\## 1. Development stage rule



This application is still in a pre-release stage. It currently has no real users and no real production data.



Agents may make structural changes freely when needed, including database schema changes, UI changes, API changes, and logic refactors. Do not over-optimize for backward compatibility at this stage.



Production constraints, real user data safety, migrations, and long-term compatibility will be handled before the official release.



\---



\## 2. AgentMD purpose rule



The role of this file is to describe common mistakes and confusion points that agents might encounter as they work in this project.



If you ever encounter something in the project that surprises you, please alert the developer working with you and indicate that this is the case in the AgentMD file to help prevent future agents from having the same issue.


\---


\## 3. Known schema mismatch


The current `supabase/client-init.sql` defines `products.id` as `uuid`, while the deployed ERP/POS schema and later migrations use `products.id` / `product_variants.product_id` as `bigint`.


Do not use `client-init.sql` for a new customer until this mismatch has been resolved and the complete initialization path has been tested. Do not silently change the production identifier type while working on unrelated features.


\---


\## 4. Local development port collision


Port `3000` may already be occupied by another workspace (observed serving the unrelated "华人生活+" project while this repository was being verified).


Before treating localhost responses as clothing-store verification, confirm the page identity or start this project on an explicit unused port such as `3010`. Do not stop or modify the other project's process unless the developer explicitly requests it.

