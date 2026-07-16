import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-only test runner requires the explicit .ts extension.
import { tokenUpdateForSupabaseAuthEvent } from "../lib/admin-session-lifecycle.ts";

test("initial login and token refresh replace the active bearer token", () => {
  assert.deepEqual(tokenUpdateForSupabaseAuthEvent("SIGNED_IN", { access_token: "first" }), { kind: "set", token: "first" });
  assert.deepEqual(tokenUpdateForSupabaseAuthEvent("TOKEN_REFRESHED", { access_token: "second" }), { kind: "set", token: "second" });
  assert.deepEqual(tokenUpdateForSupabaseAuthEvent("INITIAL_SESSION", { access_token: "restored" }), { kind: "set", token: "restored" });
});

test("expired, deleted, and signed-out sessions clear browser authorization", () => {
  assert.deepEqual(tokenUpdateForSupabaseAuthEvent("SIGNED_OUT", null), { kind: "clear" });
  assert.deepEqual(tokenUpdateForSupabaseAuthEvent("USER_DELETED", null), { kind: "clear" });
  assert.deepEqual(tokenUpdateForSupabaseAuthEvent("TOKEN_REFRESHED", null), { kind: "clear" });
});

test("unrelated auth events do not overwrite a valid token", () => {
  assert.deepEqual(tokenUpdateForSupabaseAuthEvent("PASSWORD_RECOVERY", { access_token: "ignored" }), { kind: "ignore" });
});
