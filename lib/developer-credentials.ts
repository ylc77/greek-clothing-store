import {
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_SALT_LENGTH = 24;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;
const MIN_PASSWORD_LENGTH = 20;
const MAX_PASSWORD_LENGTH = 256;
const DEFAULT_SESSION_LIFETIME_SECONDS = 2 * 60 * 60;
const SESSION_PROTOCOL = "v2";

const BLOCKED_PASSWORDS = new Set([
  "admin123",
  "changeme",
  "clothingstoredeveloper",
  "developer",
  "developer123",
  "password",
  "password123",
]);

export class DeveloperPasswordPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeveloperPasswordPolicyError";
  }
}

export type ParsedDeveloperPasswordHash = {
  cost: number;
  blockSize: number;
  parallelization: number;
  salt: Buffer;
  expected: Buffer;
};

export type DeveloperSessionCredential = {
  passwordHash: string;
  passwordVersion: number;
  credentialVersion: string;
  mustRotate: boolean;
};

type DeveloperSessionTokenOptions = {
  nowSeconds?: number;
  nonce?: string;
  lifetimeSeconds?: number;
};

function safeEqual(left: Buffer, right: Buffer) {
  return left.length === right.length && timingSafeEqual(left, right);
}

function decodeCanonicalBase64(value: string) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) return null;
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) return null;
  return decoded;
}

export function validateDeveloperPassword(password: unknown): asserts password is string {
  if (typeof password !== "string") {
    throw new DeveloperPasswordPolicyError("Developer password must be a string.");
  }
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    throw new DeveloperPasswordPolicyError(
      `Developer password must contain ${MIN_PASSWORD_LENGTH} to ${MAX_PASSWORD_LENGTH} characters.`,
    );
  }
  if (password !== password.trim()) {
    throw new DeveloperPasswordPolicyError("Developer password cannot start or end with whitespace.");
  }
  const normalized = password.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (BLOCKED_PASSWORDS.has(normalized)) {
    throw new DeveloperPasswordPolicyError("This known or template password is not allowed.");
  }
  const characterClasses = [/[a-z]/.test(password), /[A-Z]/.test(password), /[0-9]/.test(password), /[^A-Za-z0-9]/.test(password)];
  if (characterClasses.filter(Boolean).length < 3) {
    throw new DeveloperPasswordPolicyError("Developer password must use at least three character classes.");
  }
}

export function generateDeveloperPassword() {
  return `${randomBytes(24).toString("base64url")}!Aa9`;
}

export function createDeveloperPasswordHash(password: string, salt = randomBytes(SCRYPT_SALT_LENGTH)) {
  validateDeveloperPassword(password);
  if (!Buffer.isBuffer(salt) || salt.length < 16 || salt.length > 64) {
    throw new Error("Developer credential salt must contain 16 to 64 bytes.");
  }
  const derived = scryptSync(password, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION,
    maxmem: SCRYPT_MAX_MEMORY,
  });
  return [
    "scrypt",
    SCRYPT_COST,
    SCRYPT_BLOCK_SIZE,
    SCRYPT_PARALLELIZATION,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

export function parseDeveloperPasswordHash(value: unknown): ParsedDeveloperPasswordHash | null {
  if (typeof value !== "string" || value.length > 512) return null;
  const parts = value.split("$");
  if (parts.length !== 6) return null;
  const [scheme, costValue, blockSizeValue, parallelizationValue, saltValue, expectedValue] = parts;
  if (scheme !== "scrypt") return null;
  const cost = Number(costValue);
  const blockSize = Number(blockSizeValue);
  const parallelization = Number(parallelizationValue);
  if (
    cost !== SCRYPT_COST
    || blockSize !== SCRYPT_BLOCK_SIZE
    || parallelization !== SCRYPT_PARALLELIZATION
  ) return null;
  const salt = decodeCanonicalBase64(saltValue);
  const expected = decodeCanonicalBase64(expectedValue);
  if (!salt || salt.length < 16 || salt.length > 64 || !expected || expected.length !== SCRYPT_KEY_LENGTH) return null;
  return { cost, blockSize, parallelization, salt, expected };
}

export function verifyDeveloperPasswordHash(password: unknown, encoded: unknown) {
  if (typeof password !== "string" || password.length < 1 || password.length > MAX_PASSWORD_LENGTH) return false;
  const credential = parseDeveloperPasswordHash(encoded);
  if (!credential) return false;
  try {
    const actual = scryptSync(password, credential.salt, credential.expected.length, {
      N: credential.cost,
      r: credential.blockSize,
      p: credential.parallelization,
      maxmem: SCRYPT_MAX_MEMORY,
    });
    return safeEqual(actual, credential.expected);
  } catch {
    return false;
  }
}

function credentialIsUsable(credential: DeveloperSessionCredential) {
  return !credential.mustRotate
    && parseDeveloperPasswordHash(credential.passwordHash) !== null
    && Number.isInteger(credential.passwordVersion)
    && credential.passwordVersion >= 1
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(credential.credentialVersion);
}

function sessionSigningKey(credential: DeveloperSessionCredential) {
  return createHash("sha256")
    .update("clothing-developer-session\0", "utf8")
    .update(credential.passwordHash, "utf8")
    .update("\0", "utf8")
    .update(String(credential.passwordVersion), "utf8")
    .update("\0", "utf8")
    .update(credential.credentialVersion, "utf8")
    .digest();
}

function sessionSignature(payload: string, credential: DeveloperSessionCredential) {
  return createHmac("sha256", sessionSigningKey(credential)).update(payload).digest("base64url");
}

export function createDeveloperSessionTokenForCredential(
  credential: DeveloperSessionCredential,
  options: DeveloperSessionTokenOptions = {},
) {
  if (!credentialIsUsable(credential)) {
    throw new Error("Developer credential requires initialization or rotation before creating a session.");
  }
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const lifetimeSeconds = options.lifetimeSeconds ?? DEFAULT_SESSION_LIFETIME_SECONDS;
  if (!Number.isInteger(nowSeconds) || !Number.isInteger(lifetimeSeconds) || lifetimeSeconds < 1 || lifetimeSeconds > 86_400) {
    throw new Error("Invalid developer session timing parameters.");
  }
  const nonce = options.nonce ?? randomBytes(18).toString("base64url");
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) throw new Error("Invalid developer session nonce.");
  const expiresAt = nowSeconds + lifetimeSeconds;
  const payload = `${SESSION_PROTOCOL}.${expiresAt}.${nonce}`;
  return `${payload}.${sessionSignature(payload, credential)}`;
}

export function verifyDeveloperSessionTokenForCredential(
  token: unknown,
  credential: DeveloperSessionCredential,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  if (typeof token !== "string" || token.length > 512 || !credentialIsUsable(credential)) return false;
  const [protocol, expiresAtValue, nonce, providedSignature, extra] = token.split(".");
  if (extra !== undefined || protocol !== SESSION_PROTOCOL || !expiresAtValue || !nonce || !providedSignature) return false;
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce) || !/^[A-Za-z0-9_-]{32,128}$/.test(providedSignature)) return false;
  const expiresAt = Number(expiresAtValue);
  if (!Number.isInteger(expiresAt) || expiresAt <= nowSeconds) return false;
  const payload = `${protocol}.${expiresAt}.${nonce}`;
  return safeEqual(Buffer.from(providedSignature, "utf8"), Buffer.from(sessionSignature(payload, credential), "utf8"));
}
