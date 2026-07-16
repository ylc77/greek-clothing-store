import { NextRequest, NextResponse } from "next/server";
import {
  createDeveloperSessionToken,
  developerSessionCookiePath,
  developerSessionCookieName,
  developerSessionLifetimeSeconds,
  getDeveloperSessionStatus,
  verifyDeveloperPassword,
} from "@/lib/developer-auth";
import {
  AbuseProtectionUnavailableError,
  checkSharedAuthLimit,
  recordSharedAuthAttempt,
} from "@/lib/abuse-protection";

export const dynamic = "force-dynamic";

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}

export async function GET(request: NextRequest) {
  return noStore(NextResponse.json(await getDeveloperSessionStatus(request)));
}

export async function POST(request: NextRequest) {
  try {
    const limit = await checkSharedAuthLimit(request, "developer-password");
    if (!limit.allowed) {
      return noStore(NextResponse.json(
        { error: "尝试次数过多，请稍后再试。", code: "AUTH_RATE_LIMITED", retryAfter: limit.retryAfter },
        { status: 429, headers: { "Retry-After": String(limit.retryAfter || 60) } },
      ));
    }
  } catch (error) {
    if (error instanceof AbuseProtectionUnavailableError) {
      return noStore(NextResponse.json({ error: "登录安全控制不可用，开发者登录已阻断。", code: "AUTH_SECURITY_UNAVAILABLE" }, { status: 503 }));
    }
    throw error;
  }

  const rawPayload = await request.text();
  if (Buffer.byteLength(rawPayload, "utf8") > 4_096) {
    return noStore(NextResponse.json({ error: "Login request is too large.", code: "PAYLOAD_TOO_LARGE" }, { status: 413 }));
  }
  const payload = (() => {
    try {
      return JSON.parse(rawPayload);
    } catch {
      return null;
    }
  })();
  const verification = await verifyDeveloperPassword(payload?.password);
  if (verification === "uninitialized") {
    return noStore(NextResponse.json({
      error: "开发者凭据尚未初始化，请由维护者在自己的电脑运行 bootstrap CLI。",
      code: "DEVELOPER_CREDENTIAL_UNINITIALIZED",
    }, { status: 503 }));
  }
  if (verification === "must_rotate") {
    return noStore(NextResponse.json({
      error: "开发者凭据必须先通过维护者 CLI 轮换，旧密码和旧会话已停用。",
      code: "DEVELOPER_CREDENTIAL_ROTATION_REQUIRED",
    }, { status: 409 }));
  }
  if (verification === "unavailable") {
    return noStore(NextResponse.json({
      error: "开发者凭据状态不可用，请检查 migration 后通过维护者 CLI 恢复。",
      code: "DEVELOPER_CREDENTIAL_UNAVAILABLE",
    }, { status: 503 }));
  }
  if (verification !== "ok") {
    try {
      const limit = await recordSharedAuthAttempt(request, "developer-password", false);
      if (!limit.allowed) {
        return noStore(NextResponse.json(
          { error: "尝试次数过多，请稍后再试。", code: "AUTH_RATE_LIMITED", retryAfter: limit.retryAfter },
          { status: 429, headers: { "Retry-After": String(limit.retryAfter || 60) } },
        ));
      }
    } catch (error) {
      if (error instanceof AbuseProtectionUnavailableError) {
        return noStore(NextResponse.json({ error: "登录安全控制不可用，开发者登录已阻断。", code: "AUTH_SECURITY_UNAVAILABLE" }, { status: 503 }));
      }
      throw error;
    }
    return noStore(NextResponse.json({ error: "开发者密码不正确。" }, { status: 401 }));
  }

  const token = await createDeveloperSessionToken();
  if (!token) {
    return noStore(NextResponse.json({ error: "开发者访问配置不可用，请确认数据库 migration 已执行。" }, { status: 503 }));
  }

  try {
    await recordSharedAuthAttempt(request, "developer-password", true);
  } catch (error) {
    if (error instanceof AbuseProtectionUnavailableError) {
      return noStore(NextResponse.json({ error: "登录安全控制不可用，开发者登录已阻断。", code: "AUTH_SECURITY_UNAVAILABLE" }, { status: 503 }));
    }
    throw error;
  }
  const response = NextResponse.json({ initialized: true, mustRotate: false, sessionValid: true });
  response.cookies.set(developerSessionCookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: developerSessionCookiePath,
    maxAge: developerSessionLifetimeSeconds,
  });
  return noStore(response);
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(developerSessionCookieName, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: developerSessionCookiePath,
    expires: new Date(0),
    maxAge: 0,
  });
  response.cookies.set(developerSessionCookieName, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires: new Date(0),
    maxAge: 0,
  });
  return noStore(response);
}
