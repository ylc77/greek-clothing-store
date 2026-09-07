import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const userFacingFiles = [
  "components/admin-dashboard.tsx",
  "components/admin-more-page.tsx",
  "components/inventory-receiving-workspace.tsx",
  "components/label-device-settings.tsx",
  "components/pos-return-exchange-dialog.tsx",
  "app/admin/settings/page.tsx",
];

test("admin UI does not expose implementation plans or internal workflow terms", () => {
  const source = userFacingFiles
    .map((path) => readFileSync(`${root}${path}`, "utf8"))
    .join("\n");

  for (const forbidden of [
    "第一版",
    "当前版本未启用",
    "feature_settings migration",
    "硬件验收",
    "Atomic receiving",
    "Atomic return / exchange",
    "CSV Job",
    "业务 ID",
    "数据库事务",
    "事务处理中",
    "技术诊断",
    "RPC 未就绪",
  ]) {
    assert.equal(source.includes(forbidden), false, `user-facing source contains internal copy: ${forbidden}`);
  }
});
