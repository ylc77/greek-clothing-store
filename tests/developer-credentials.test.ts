import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
// @ts-expect-error Node's strip-only test runner requires the explicit .ts extension.
import { DeveloperPasswordPolicyError, createDeveloperPasswordHash, createDeveloperSessionTokenForCredential, parseDeveloperPasswordHash, validateDeveloperPassword, verifyDeveloperPasswordHash, verifyDeveloperSessionTokenForCredential, type DeveloperSessionCredential } from "../lib/developer-credentials.ts";

function strongPassword() {
  return `${randomBytes(24).toString("base64url")}!Aa9`;
}

function credential(passwordHash: string): DeveloperSessionCredential {
  return {
    passwordHash,
    passwordVersion: 1,
    credentialVersion: randomUUID(),
    mustRotate: false,
  };
}

test("the same password receives a different hash with an independent salt", () => {
  const password = strongPassword();
  const first = createDeveloperPasswordHash(password);
  const second = createDeveloperPasswordHash(password);
  assert.notEqual(first, second);
  assert.equal(verifyDeveloperPasswordHash(password, first), true);
  assert.equal(verifyDeveloperPasswordHash(password, second), true);
});

test("empty weak common and oversized passwords are rejected", () => {
  for (const password of ["", "short", "developer123", "a".repeat(257)]) {
    assert.throws(() => validateDeveloperPassword(password), DeveloperPasswordPolicyError);
  }
  assert.doesNotThrow(() => validateDeveloperPassword(strongPassword()));
});

test("invalid and malicious scrypt encodings fail before expensive work", () => {
  const invalid = [
    "",
    "not-a-hash",
    "scrypt$999999999$8$1$AA==$AA==",
    "scrypt$16384$999999999$1$AA==$AA==",
    "scrypt$16384$8$999999999$AA==$AA==",
    "scrypt$16384$8$1$not-base64$not-base64",
  ];
  for (const value of invalid) {
    assert.equal(parseDeveloperPasswordHash(value), null);
    assert.equal(verifyDeveloperPasswordHash(strongPassword(), value), false);
  }
});

test("password comparison accepts only the exact password", () => {
  const password = strongPassword();
  const encoded = createDeveloperPasswordHash(password);
  assert.equal(verifyDeveloperPasswordHash(password, encoded), true);
  assert.equal(verifyDeveloperPasswordHash(`${password}x`, encoded), false);
});

test("session token is bound to hash password version and credential version", () => {
  const first = credential(createDeveloperPasswordHash(strongPassword()));
  const now = 1_800_000_000;
  const token = createDeveloperSessionTokenForCredential(first, {
    nowSeconds: now,
    nonce: randomBytes(18).toString("base64url"),
    lifetimeSeconds: 7_200,
  });
  assert.equal(verifyDeveloperSessionTokenForCredential(token, first, now + 1), true);
  assert.equal(verifyDeveloperSessionTokenForCredential(token, { ...first, passwordVersion: 2 }, now + 1), false);
  assert.equal(verifyDeveloperSessionTokenForCredential(token, { ...first, credentialVersion: randomUUID() }, now + 1), false);
  assert.equal(verifyDeveloperSessionTokenForCredential(token, { ...first, passwordHash: createDeveloperPasswordHash(strongPassword()) }, now + 1), false);
});

test("expired malformed and must-rotate sessions fail closed", () => {
  const active = credential(createDeveloperPasswordHash(strongPassword()));
  const now = 1_800_000_000;
  const token = createDeveloperSessionTokenForCredential(active, {
    nowSeconds: now,
    nonce: randomBytes(18).toString("base64url"),
    lifetimeSeconds: 60,
  });
  assert.equal(verifyDeveloperSessionTokenForCredential(token, active, now + 61), false);
  assert.equal(verifyDeveloperSessionTokenForCredential("broken", active, now), false);
  assert.equal(verifyDeveloperSessionTokenForCredential(token, { ...active, mustRotate: true }, now + 1), false);
  assert.throws(
    () => createDeveloperSessionTokenForCredential({ ...active, mustRotate: true }, { nowSeconds: now }),
    /rotation/i,
  );
});
