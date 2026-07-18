import { NextRequest } from "next/server";
import { getAdminAuthenticationResult } from "@/lib/admin-auth";
import { adminPrivateJson } from "@/lib/admin-response";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authentication = await getAdminAuthenticationResult(request);
  const context = authentication.context;
  if (!context) {
    if (authentication.failure === "rate_limited") {
      return adminPrivateJson(
        { error: "Too many authentication attempts.", code: "AUTH_RATE_LIMITED", retryAfter: authentication.retryAfter || 60 },
        { status: 429, headers: { "Retry-After": String(authentication.retryAfter || 60) } },
      );
    }
    if (authentication.failure === "unavailable") {
      return adminPrivateJson({ error: "Authentication security controls are unavailable.", code: "AUTH_SECURITY_UNAVAILABLE" }, { status: 503 });
    }
    if (authentication.failure === "feature_disabled") {
      return adminPrivateJson({ error: "Employee accounts are disabled for this customer plan.", code: "FEATURE_DISABLED" }, { status: 403 });
    }
    if (authentication.failure === "forbidden") {
      return adminPrivateJson({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 });
    }
    return adminPrivateJson({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  }

  return adminPrivateJson({
    ok: true,
    role: context.role,
    permissions: context.permissions,
    authType: context.authType,
    userId: context.userId || null,
    email: context.email || null,
    displayName: context.displayName || null,
  });
}
