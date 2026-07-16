import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-only test runner requires the explicit .ts extension.
import { AdminPasswordConfigurationError, configuredAdminPasswordRole, timingSafePasswordMatch, validateAdminPasswordEnvironment } from "../lib/admin-password-security.ts";

function password(role: string) {
  return `Audit-${role}-${"7Z!".repeat(8)}`;
}

test("rejects weak and duplicated configured role passwords", () => {
  assert.throws(
    () => validateAdminPasswordEnvironment({ ADMIN_PASSWORD: "short" }),
    (error: unknown) => error instanceof AdminPasswordConfigurationError && error.code === "WEAK_PASSWORD",
  );
  const duplicate = password("duplicate");
  assert.throws(
    () => validateAdminPasswordEnvironment({ ADMIN_PASSWORD: duplicate, ADMIN_STAFF_PASSWORD: duplicate }),
    (error: unknown) => error instanceof AdminPasswordConfigurationError && error.code === "DUPLICATE_PASSWORD",
  );
});

test("matches every configured role through a timing-safe digest comparison", () => {
  const env = {
    ADMIN_PASSWORD: password("owner"),
    ADMIN_STAFF_PASSWORD: password("staff"),
    ADMIN_INVENTORY_PASSWORD: password("inventory"),
    ADMIN_READONLY_PASSWORD: password("readonly"),
  };
  const config = validateAdminPasswordEnvironment(env);
  assert.equal(configuredAdminPasswordRole(password("owner"), config), "owner");
  assert.equal(configuredAdminPasswordRole(password("inventory"), config), "inventory");
  assert.equal(configuredAdminPasswordRole(password("wrong"), config), null);
  assert.equal(timingSafePasswordMatch(password("owner"), password("owner")), true);
  assert.equal(timingSafePasswordMatch(password("owner"), password("staff")), false);
});

test("an installation may omit emergency passwords entirely", () => {
  assert.deepEqual(validateAdminPasswordEnvironment({}), {});
});
