import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node's strip-only test runner requires the explicit .ts extension.
import { adminCommonNavigationLabelByKey, adminCommonTabsStorageKey, adminDesktopOnlyTabKeys, adminInternalOnlyTabKeys, adminNavigableTabKeys, adminNavigationGroups, adminNavigationLabelByKey, getDefaultAdminCommonTabs, isAdminTabVisibleInViewport, moveAdminCommonTab, normalizeAdminCommonTabs } from "../lib/admin-navigation.ts";

test("every navigable admin tab belongs to exactly one management group", () => {
  const grouped = adminNavigationGroups.flatMap((group) => group.tabKeys);
  assert.equal(new Set(grouped).size, grouped.length);
  assert.deepEqual([...new Set(grouped)].sort(), [...adminNavigableTabKeys].sort());
  for (const internalTab of adminInternalOnlyTabKeys) {
    assert.equal(grouped.includes(internalTab), false);
  }
});

test("owner defaults prioritize daily retail workflows", () => {
  assert.deepEqual(getDefaultAdminCommonTabs("owner"), [
    "onlineOrders",
    "stockLookup",
    "stockOperations",
    "quickAdd",
    "dashboard",
    "pos",
  ]);
  assert.equal(adminCommonNavigationLabelByKey.get("stockOperations"), "到货扫码");
  assert.equal(adminNavigationLabelByKey.get("stockOperations"), "库存作业");
});

test("staff, inventory, and readonly roles receive distinct safe defaults", () => {
  assert.deepEqual(getDefaultAdminCommonTabs("staff"), ["onlineOrders", "stockLookup", "dashboard", "pos"]);
  assert.deepEqual(getDefaultAdminCommonTabs("inventory"), ["stockOperations", "stockLookup", "labels", "inventory"]);
  assert.deepEqual(getDefaultAdminCommonTabs("readonly"), ["stockLookup", "dashboard", "posOrders"]);

  assert.equal(getDefaultAdminCommonTabs("staff").includes("quickAdd"), false);
  assert.equal(getDefaultAdminCommonTabs("inventory").includes("pos"), false);
  assert.equal(getDefaultAdminCommonTabs("readonly").includes("stockOperations"), false);
});

test("saved shortcut normalization removes duplicates, unknown keys, and internal-only pages", () => {
  const fallback = getDefaultAdminCommonTabs("owner");
  assert.deepEqual(
    normalizeAdminCommonTabs(["stockLookup", "stockLookup", "add", "check", "unknown", "labels"], fallback),
    ["stockLookup", "labels"],
  );
  assert.deepEqual(normalizeAdminCommonTabs(["add", "check", "unknown"], fallback), fallback);
  assert.deepEqual(normalizeAdminCommonTabs(["pos"], fallback), fallback);
  assert.deepEqual(normalizeAdminCommonTabs(null, fallback), fallback);
});

test("role shortcut storage is isolated and compact-only tools remain explicit", () => {
  assert.notEqual(adminCommonTabsStorageKey("owner"), adminCommonTabsStorageKey("staff"));
  assert.notEqual(adminCommonTabsStorageKey("staff"), adminCommonTabsStorageKey("inventory"));
  assert.deepEqual([...adminDesktopOnlyTabKeys].sort(), ["csv", "images", "pos"]);
});

test("compact viewports reject every desktop-only page", () => {
  for (const tab of adminDesktopOnlyTabKeys) {
    assert.equal(isAdminTabVisibleInViewport(tab, true), false);
    assert.equal(isAdminTabVisibleInViewport(tab, false), true);
  }
  assert.equal(isAdminTabVisibleInViewport("stockLookup", true), true);
});

test("shortcut ordering follows the visible compact sequence without moving hidden tools", () => {
  const tabs = ["onlineOrders", "stockLookup", "pos", "dashboard"] as const;
  const visibleTabs = ["onlineOrders", "stockLookup", "dashboard"] as const;
  assert.deepEqual(
    moveAdminCommonTab(tabs, "dashboard", -1, visibleTabs),
    ["onlineOrders", "dashboard", "pos", "stockLookup"],
  );
  assert.deepEqual(moveAdminCommonTab(tabs, "onlineOrders", -1, visibleTabs), [...tabs]);
});
