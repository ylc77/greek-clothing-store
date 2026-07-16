import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-only test runner requires the explicit .ts extension.
import { canonicalizeClientIp, getTrustedClientIp, pseudonymizeSecuritySubject } from "../lib/request-security.ts";

test("canonicalizes IPv4, mapped IPv6, bracketed IPv6, and rejects malformed input", () => {
  assert.equal(canonicalizeClientIp("203.0.113.8:443"), "203.0.113.8");
  assert.equal(canonicalizeClientIp("::ffff:203.0.113.8"), "203.0.113.8");
  assert.equal(canonicalizeClientIp("[2001:0db8:0:0:0:0:0:1]:443"), "2001:db8::1");
  assert.equal(canonicalizeClientIp("not-an-ip"), null);
});

test("prefers platform-controlled client headers and does not trust a forged leftmost proxy value", () => {
  const trusted = new Headers({
    "x-vercel-forwarded-for": "203.0.113.9",
    "x-forwarded-for": "198.51.100.77, 192.0.2.44",
  });
  assert.equal(getTrustedClientIp(trusted), "203.0.113.9");

  const generic = new Headers({ "x-forwarded-for": "198.51.100.77, 192.0.2.44" });
  assert.equal(getTrustedClientIp(generic), "192.0.2.44");
  assert.equal(getTrustedClientIp(new Headers({ "x-forwarded-for": "forged, also-forged" })), "unknown");
});

test("security subjects are stable pseudonyms and never contain the raw address", () => {
  const secret = "x".repeat(48);
  const first = pseudonymizeSecuritySubject("ip", "203.0.113.9", secret);
  const replay = pseudonymizeSecuritySubject("ip", "203.0.113.9", secret);
  const other = pseudonymizeSecuritySubject("ip", "203.0.113.10", secret);
  assert.equal(first, replay);
  assert.notEqual(first, other);
  assert.equal(first.includes("203.0.113.9"), false);
  assert.throws(() => pseudonymizeSecuritySubject("ip", "203.0.113.9", "weak"), /secret/i);
});
