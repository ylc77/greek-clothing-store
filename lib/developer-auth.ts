import {
  createDeveloperSessionTokenForCredential,
  parseDeveloperPasswordHash,
  verifyDeveloperPasswordHash,
  verifyDeveloperSessionTokenForCredential,
  type DeveloperSessionCredential,
} from "./developer-credentials";
import { getSupabaseAdminClient } from "./supabase";

export const developerSessionCookieName = "clothing_developer_settings";
export const developerSessionLifetimeSeconds = 2 * 60 * 60;
export const developerSessionCookiePath = "/api/admin";

type DeveloperCredentialRecord = DeveloperSessionCredential & {
  initializedAt: string;
  rotatedAt: string | null;
};

type DeveloperCredentialLoadResult =
  | { kind: "active"; record: DeveloperCredentialRecord }
  | { kind: "must_rotate"; record: DeveloperCredentialRecord }
  | { kind: "uninitialized" }
  | { kind: "unavailable" };

export type DeveloperPasswordVerification = "ok" | "invalid" | "uninitialized" | "must_rotate" | "unavailable";

function validUuid(value: unknown) {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function loadDeveloperCredential(): Promise<DeveloperCredentialLoadResult> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return { kind: "unavailable" };

  const { data, error } = await (supabase as any)
    .from("developer_access")
    .select("password_hash, password_version, credential_version, initialized_at, rotated_at, must_rotate")
    .eq("id", 1)
    .maybeSingle();

  if (error) return { kind: "unavailable" };
  if (!data) return { kind: "uninitialized" };
  if (
    parseDeveloperPasswordHash(data.password_hash) === null
    || !Number.isInteger(data.password_version)
    || data.password_version < 1
    || !validUuid(data.credential_version)
    || typeof data.initialized_at !== "string"
  ) return { kind: "unavailable" };

  const record: DeveloperCredentialRecord = {
    passwordHash: data.password_hash,
    passwordVersion: data.password_version,
    credentialVersion: data.credential_version,
    mustRotate: data.must_rotate === true,
    initializedAt: data.initialized_at,
    rotatedAt: typeof data.rotated_at === "string" ? data.rotated_at : null,
  };
  return record.mustRotate ? { kind: "must_rotate", record } : { kind: "active", record };
}

function cookieValues(request: Request, name: string) {
  const values: string[] = [];
  const cookieHeader = request.headers.get("cookie") || "";
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    try {
      values.push(decodeURIComponent(part.slice(separator + 1).trim()));
    } catch {
      // A malformed cookie never authorizes a request.
    }
  }
  return values;
}

export async function getDeveloperSessionStatus(request: Request) {
  const state = await loadDeveloperCredential();
  if (state.kind === "uninitialized") {
    return { initialized: false, mustRotate: false, sessionValid: false };
  }
  if (state.kind === "unavailable") {
    return { initialized: false, mustRotate: false, sessionValid: false };
  }
  const sessionValid = state.kind === "active"
    && cookieValues(request, developerSessionCookieName)
      .some((token) => verifyDeveloperSessionTokenForCredential(token, state.record));
  return {
    initialized: true,
    mustRotate: state.kind === "must_rotate",
    sessionValid,
  };
}

export async function verifyDeveloperPassword(password: unknown): Promise<DeveloperPasswordVerification> {
  const state = await loadDeveloperCredential();
  if (state.kind === "uninitialized") return "uninitialized";
  if (state.kind === "must_rotate") return "must_rotate";
  if (state.kind === "unavailable") return "unavailable";
  return verifyDeveloperPasswordHash(password, state.record.passwordHash) ? "ok" : "invalid";
}

export async function createDeveloperSessionToken() {
  const state = await loadDeveloperCredential();
  if (state.kind !== "active") return null;
  return createDeveloperSessionTokenForCredential(state.record, {
    lifetimeSeconds: developerSessionLifetimeSeconds,
  });
}

export async function developerRequestIsAuthorized(request: Request) {
  const state = await loadDeveloperCredential();
  if (state.kind !== "active") return false;
  return cookieValues(request, developerSessionCookieName)
    .some((token) => verifyDeveloperSessionTokenForCredential(token, state.record));
}
