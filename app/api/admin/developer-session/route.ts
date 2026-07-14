import { NextRequest, NextResponse } from "next/server";
import {
  createDeveloperSessionToken,
  developerRequestIsAuthorized,
  developerSessionCookieName,
  verifyDeveloperPassword,
} from "@/lib/developer-auth";

export const dynamic = "force-dynamic";

const attempts = new Map<string, { count: number; resetAt: number }>();
const attemptWindowMs = 15 * 60 * 1000;
const maxAttemptsPerWindow = 10;

function clientKey(request: NextRequest) {
  return (request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "local")
    .split(",")[0]
    .trim();
}

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}

function recordFailedAttempt(key: string) {
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + attemptWindowMs });
    return;
  }
  attempts.set(key, { ...current, count: current.count + 1 });
}

function isRateLimited(key: string) {
  const current = attempts.get(key);
  if (!current) return false;
  if (current.resetAt <= Date.now()) {
    attempts.delete(key);
    return false;
  }
  return current.count >= maxAttemptsPerWindow;
}

export async function GET(request: NextRequest) {
  const ok = await developerRequestIsAuthorized(request);
  return noStore(NextResponse.json({ ok }, { status: ok ? 200 : 401 }));
}

export async function POST(request: NextRequest) {
  const key = clientKey(request);
  if (isRateLimited(key)) {
    return noStore(NextResponse.json({ error: "尝试次数过多，请稍后再试。" }, { status: 429 }));
  }

  const payload = await request.json().catch(() => null);
  const valid = await verifyDeveloperPassword(payload?.password);
  if (!valid) {
    recordFailedAttempt(key);
    return noStore(NextResponse.json({ error: "开发者密码不正确。" }, { status: 401 }));
  }

  const token = await createDeveloperSessionToken();
  if (!token) {
    return noStore(NextResponse.json({ error: "开发者访问配置不可用，请确认数据库 migration 已执行。" }, { status: 503 }));
  }

  attempts.delete(key);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(developerSessionCookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
  });
  return noStore(response);
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(developerSessionCookieName, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires: new Date(0),
  });
  return noStore(response);
}
