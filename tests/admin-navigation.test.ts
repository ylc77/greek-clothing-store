import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node's strip-only runner requires the extension.
import { adminPrimaryNavigation, legacyAdminSection, adminNavigationTabKeys, adminSectionForView, getAdminPrimaryNavigation, adminWorkspaceActions, adminVisibleMessage } from "../lib/admin-navigation.ts";

test("employee messages omit infrastructure details without disguising uncertain writes", () => {
  for (const message of ["RPC unavailable", "missing migration", "Supabase unavailable", "Feature Flag unavailable", "PostgREST error"]) {
    assert.equal(adminVisibleMessage(message,true),message);
    assert.match(adminVisibleMessage(message,false), /先核对结果/);
    assert.doesNotMatch(adminVisibleMessage(message,false), /RPC|migration|Supabase|Feature Flag|PostgREST/);
  }
  assert.equal(adminVisibleMessage("库存不足：需要 3，可用 1",false),"库存不足：需要 3，可用 1");
});

test("six primary destinations cover every legacy view without exposing internal tools", () => {
  assert.deepEqual(adminPrimaryNavigation.map(item => item.key), ["workspace", "pos", "receiving", "catalog", "orders", "more"]);
  assert.deepEqual(Object.keys(legacyAdminSection).sort(), [...adminNavigationTabKeys].sort());
  for (const view of ["dashboard", "check", "quickAdd", "add", "stockLookup", "inventory", "labels"] as const) assert.equal(adminSectionForView(view, "receiving"), "catalog");
  for (const view of ["posOrders", "onlineOrders", "posDaily", "returns", "ordersAll"] as const) assert.equal(adminSectionForView(view, "receiving"), "orders");
  assert.equal(adminSectionForView("quickSale", "receiving"), "more");
});

test("stock modes remain separate destinations with the same underlying view", () => {
  assert.equal(adminSectionForView("stockOperations", "receiving"), "receiving");
  assert.equal(adminSectionForView("stockOperations", "stocktake"), "catalog");
  assert.equal(adminSectionForView("stockOperations", "return"), "orders");
});

test("primary navigation fails closed using existing role and feature authorization", () => {
  assert.deepEqual(getAdminPrimaryNavigation(() => false, false), []);
  assert.deepEqual(getAdminPrimaryNavigation(view => ["workspace", "inventory"].includes(view), false).map(item => item.key), ["workspace", "catalog"]);
  assert.deepEqual(getAdminPrimaryNavigation(() => true, true).map(item => item.key), ["workspace", "receiving", "catalog", "orders", "more"]);
  assert.equal(getAdminPrimaryNavigation(view => view === "labels", false)[0]?.key, "catalog");
});

test("role workspaces contain at most four ordinary operations and never emergency reduction", () => {
  for (const actions of Object.values(adminWorkspaceActions)) {
    assert.ok(actions.length >= 3 && actions.length <= 4);
    assert.equal(actions.some(action => action.view === "quickSale"), false);
    assert.equal(new Set(actions.map(action => action.view)).size, actions.length);
  }
  assert.equal(adminWorkspaceActions.staff.some(action => action.view === "stockOperations"), false);
  assert.equal(adminWorkspaceActions.inventory.some(action => action.view === "pos"), false);
});

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
