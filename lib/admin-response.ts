import { NextResponse } from "next/server";
import { ADMIN_PRIVATE_CACHE_CONTROL } from "./admin-data-boundary";
import type { AdminAuthorizationDecision } from "./admin-auth";

export function applyAdminPrivateCache<T extends Response>(response: T): T {
  response.headers.set("Cache-Control", ADMIN_PRIVATE_CACHE_CONTROL);
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
}

export function adminPrivateJson(
  body: unknown,
  init?: ResponseInit,
) {
  return applyAdminPrivateCache(NextResponse.json(body, init));
}

export function adminAuthorizationFailure(decision: Exclude<AdminAuthorizationDecision, { allowed: true }>) {
  const headers = decision.retryAfter
    ? { "Retry-After": String(decision.retryAfter) }
    : undefined;
  return adminPrivateJson({
    error: decision.error,
    code: decision.code,
    ...(decision.retryAfter ? { retryAfter: decision.retryAfter } : {}),
  }, { status: decision.status, headers });
}
