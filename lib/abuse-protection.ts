import { getSupabaseAdminClient } from "./supabase";
import { getTrustedClientIp, pseudonymizeSecuritySubject } from "./request-security";

type AuthNamespace = "admin-password" | "developer-password";

export type SharedLimitResult = {
  allowed: boolean;
  code: string;
  retryAfter: number;
  dimension?: string;
};

export class AbuseProtectionUnavailableError extends Error {
  constructor(message = "Shared abuse protection is unavailable.") {
    super(message);
    this.name = "AbuseProtectionUnavailableError";
  }
}

function positiveInteger(name: string, fallback: number, minimum: number, maximum: number) {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new AbuseProtectionUnavailableError(`${name} is outside its safe range.`);
  }
  return value;
}

function securitySecret() {
  const secret = String(process.env.AUTH_RATE_LIMIT_SECRET || process.env.IP_PSEUDONYM_SECRET || "");
  if (secret.length < 32) throw new AbuseProtectionUnavailableError("AUTH_RATE_LIMIT_SECRET is missing or too short.");
  return secret;
}

function requestSubject(request: Request, namespace: string) {
  return pseudonymizeSecuritySubject(namespace, getTrustedClientIp(request.headers), securitySecret());
}

function result(value: unknown, fallbackCode: string): SharedLimitResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AbuseProtectionUnavailableError("Shared limiter returned an invalid result.");
  }
  const source = value as Record<string, unknown>;
  if (typeof source.allowed !== "boolean") throw new AbuseProtectionUnavailableError("Shared limiter omitted its decision.");
  return {
    allowed: source.allowed,
    code: typeof source.code === "string" ? source.code : fallbackCode,
    retryAfter: Math.max(0, Math.trunc(Number(source.retry_after) || 0)),
    dimension: typeof source.dimension === "string" ? source.dimension : undefined,
  };
}

export async function checkSharedAuthLimit(request: Request, namespace: AuthNamespace) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new AbuseProtectionUnavailableError("Server-side Supabase is unavailable.");
  const { data, error } = await (supabase as any).rpc("auth_rate_limit_status_rpc", {
    p_namespace: namespace,
    p_subject_hash: requestSubject(request, namespace),
  });
  if (error) throw new AbuseProtectionUnavailableError("Shared authentication limiter RPC is unavailable.");
  return result(data, "AUTH_RATE_LIMITED");
}

export async function recordSharedAuthAttempt(request: Request, namespace: AuthNamespace, success: boolean) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new AbuseProtectionUnavailableError("Server-side Supabase is unavailable.");
  const { data, error } = await (supabase as any).rpc("auth_rate_limit_record_rpc", {
    p_namespace: namespace,
    p_subject_hash: requestSubject(request, namespace),
    p_success: success,
    p_max_failures: positiveInteger("AUTH_MAX_FAILURES", 10, 3, 100),
    p_window_seconds: positiveInteger("AUTH_FAILURE_WINDOW_SECONDS", 900, 60, 86_400),
    p_block_seconds: positiveInteger("AUTH_BLOCK_SECONDS", 900, 60, 604_800),
    p_capacity: positiveInteger("AUTH_FAILURE_SUBJECT_CAPACITY", 5_000, 10, 100_000),
  });
  if (error) throw new AbuseProtectionUnavailableError("Shared authentication limiter RPC is unavailable.");
  return result(data, "AUTH_RATE_LIMITED");
}

export async function beginSharedAiRequest(options: {
  request: Request;
  requestId: string;
  sessionId: string;
  inputCharacters: number;
}) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new AbuseProtectionUnavailableError("Server-side Supabase is unavailable.");
  const secret = securitySecret();
  const storeKey = pseudonymizeSecuritySubject("ai-store", "default", secret);
  const subjects = {
    ip: pseudonymizeSecuritySubject("ai-ip", getTrustedClientIp(options.request.headers), secret),
    session: pseudonymizeSecuritySubject("ai-session", options.sessionId, secret),
    store: storeKey,
    global: pseudonymizeSecuritySubject("ai-global", "global", secret),
  };
  const limits = {
    ip: positiveInteger("AI_IP_REQUESTS_PER_MINUTE", 10, 1, 1_000),
    session: positiveInteger("AI_SESSION_REQUESTS_PER_MINUTE", 12, 1, 1_000),
    store: positiveInteger("AI_STORE_REQUESTS_PER_MINUTE", 60, 1, 10_000),
    global: positiveInteger("AI_GLOBAL_REQUESTS_PER_MINUTE", 100, 1, 100_000),
  };
  const { data, error } = await (supabase as any).rpc("ai_rate_limit_begin_rpc", {
    p_request_id: options.requestId,
    p_store_key: storeKey,
    p_subjects: subjects,
    p_limits: limits,
    p_daily_limit: positiveInteger("AI_DAILY_REQUEST_BUDGET", 500, 1, 1_000_000),
    p_concurrency_limit: positiveInteger("AI_GLOBAL_CONCURRENCY", 3, 1, 100),
    p_input_characters: options.inputCharacters,
  });
  if (error) throw new AbuseProtectionUnavailableError("Shared AI limiter RPC is unavailable.");
  return result(data, "AI_RATE_LIMITED");
}

export async function finishSharedAiRequest(requestId: string, status: "completed" | "failed", outputCharacters: number) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new AbuseProtectionUnavailableError("Server-side Supabase is unavailable.");
  const { data, error } = await (supabase as any).rpc("ai_rate_limit_finish_rpc", {
    p_request_id: requestId,
    p_status: status,
    p_output_characters: Math.max(0, Math.min(65_536, Math.trunc(outputCharacters))),
  });
  if (error || data !== true) throw new AbuseProtectionUnavailableError("AI limiter lease could not be closed safely.");
}
