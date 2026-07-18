import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-only test runner requires the explicit .ts extension.
import { AdminPasswordConfigurationError, configuredAdminPasswordRole, timingSafePasswordMatch, validateAdminPasswordEnvironment } from "../lib/admin-password-security.ts";

function password(role: string) {
  return `Emergency${role}20260719`;
}

function rejectsWeak(value: string) {
  assert.throws(
    () => validateAdminPasswordEnvironment({ ADMIN_PASSWORD: value }),
    (error: unknown) => error instanceof AdminPasswordConfigurationError && error.code === "WEAK_PASSWORD",
  );
}

test("accepts a 16-character password containing letters and digits without a symbol", () => {
  const value = "SecureAccess2026";
  assert.equal(value.length, 16);
  assert.deepEqual(validateAdminPasswordEnvironment({ ADMIN_PASSWORD: value }), { owner: value });
});

test("rejects emergency passwords shorter than 16 characters", () => {
  rejectsWeak("SecureAccess202");
});

test("rejects emergency passwords containing only letters", () => {
  rejectsWeak("LettersOnlyAccess");
});

test("rejects emergency passwords containing only digits", () => {
  rejectsWeak("1234567890123456");
});

test("rejects emergency passwords with leading or trailing whitespace", () => {
  rejectsWeak(" SecureAccess2026");
  rejectsWeak("SecureAccess2026 ");
});

test("rejects emergency passwords containing a common weak-password term", () => {
  rejectsWeak("PasswordAccess2026");
});

test("rejects one emergency password reused by different admin roles", () => {
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
