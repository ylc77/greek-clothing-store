import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { getSupabaseAdminClient } from "./supabase";

export const developerSessionCookieName = "clothing_developer_settings";
export const developerSessionLifetimeSeconds = 2 * 60 * 60;

type ScryptCredential = {
  cost: number;
  blockSize: number;
  parallelization: number;
  salt: Buffer;
  expected: Buffer;
};

function parseScryptCredential(value: string): ScryptCredential | null {
  const [scheme, cost, blockSize, parallelization, salt, expected] = value.split("$");
  if (scheme !== "scrypt" || !cost || !blockSize || !parallelization || !salt || !expected) return null;

  const parsed = {
    cost: Number(cost),
    blockSize: Number(blockSize),
    parallelization: Number(parallelization),
    salt: Buffer.from(salt, "base64"),
    expected: Buffer.from(expected, "base64"),
  };
  if (!Number.isInteger(parsed.cost) || !Number.isInteger(parsed.blockSize) || !Number.isInteger(parsed.parallelization)) return null;
  if (parsed.cost < 16384 || parsed.blockSize < 8 || parsed.parallelization < 1 || parsed.salt.length < 16 || parsed.expected.length < 32) return null;
  return parsed;
}

async function getDeveloperPasswordHash() {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return null;

  const { data, error } = await (supabase as any)
    .from("developer_access")
    .select("password_hash")
    .eq("id", 1)
    .maybeSingle();

  if (error || typeof data?.password_hash !== "string") {
    if (error) console.error("Failed to read developer access credential", error.message);
    return null;
  }
  return data.password_hash as string;
}

function safeEqual(left: Buffer, right: Buffer) {
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function verifyDeveloperPassword(password: unknown) {
  if (typeof password !== "string" || !password.trim()) return false;
  const stored = await getDeveloperPasswordHash();
  if (!stored) return false;
  const credential = parseScryptCredential(stored);
  if (!credential) return false;

  const actual = scryptSync(password.trim(), credential.salt, credential.expected.length, {
    N: credential.cost,
    r: credential.blockSize,
    p: credential.parallelization,
    maxmem: 64 * 1024 * 1024,
  });
  return safeEqual(actual, credential.expected);
}

function sessionSignature(payload: string, passwordHash: string) {
  return createHmac("sha256", passwordHash).update(payload).digest("base64url");
}

export async function createDeveloperSessionToken() {
  const passwordHash = await getDeveloperPasswordHash();
  if (!passwordHash) return null;
  const expiresAt = Math.floor(Date.now() / 1000) + developerSessionLifetimeSeconds;
  const payload = `${expiresAt}.${randomBytes(18).toString("base64url")}`;
  return `${payload}.${sessionSignature(payload, passwordHash)}`;
}

function cookieValue(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie") || "";
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return "";
}

export async function developerRequestIsAuthorized(request: Request) {
  const token = cookieValue(request, developerSessionCookieName);
  const [expiresAt, nonce, providedSignature] = token.split(".");
  if (!expiresAt || !nonce || !providedSignature) return false;

  const expiresAtNumber = Number(expiresAt);
  if (!Number.isInteger(expiresAtNumber) || expiresAtNumber <= Math.floor(Date.now() / 1000)) return false;

  const passwordHash = await getDeveloperPasswordHash();
  if (!passwordHash) return false;
  const expectedSignature = sessionSignature(`${expiresAt}.${nonce}`, passwordHash);
  return safeEqual(Buffer.from(providedSignature), Buffer.from(expectedSignature));
}
