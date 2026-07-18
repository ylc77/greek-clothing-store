import { createHmac } from "node:crypto";
import { isIP } from "node:net";

function unquote(value: string) {
  const trimmed = value.trim();
  return trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1) : trimmed;
}

export function canonicalizeClientIp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let candidate = unquote(value);
  if (!candidate) return null;

  const bracketed = candidate.match(/^\[([^\]]+)](?::\d+)?$/);
  if (bracketed) candidate = bracketed[1];
  const mapped = candidate.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped && isIP(mapped[1]) === 4) return mapped[1];
  if (isIP(candidate) === 4) return candidate;

  if (candidate.includes(":") && isIP(candidate) !== 6) {
    const ipv4WithPort = candidate.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
    if (ipv4WithPort && isIP(ipv4WithPort[1]) === 4) return ipv4WithPort[1];
  }
  if (isIP(candidate) !== 6) return null;
  try {
    return new URL(`http://[${candidate}]/`).hostname.slice(1, -1).toLowerCase();
  } catch {
    return null;
  }
}

function firstValid(value: string | null, order: "first" | "last") {
  const candidates = String(value || "").split(",").map((entry) => canonicalizeClientIp(entry)).filter(Boolean) as string[];
  return order === "first" ? candidates[0] : candidates.at(-1);
}

export function getTrustedClientIp(headers: Headers): string {
  const vercel = firstValid(headers.get("x-vercel-forwarded-for"), "first");
  if (vercel) return vercel;
  const cloudflare = canonicalizeClientIp(headers.get("cf-connecting-ip"));
  if (cloudflare) return cloudflare;
  const realIp = canonicalizeClientIp(headers.get("x-real-ip"));
  if (realIp) return realIp;
  return firstValid(headers.get("x-forwarded-for"), "last") || "unknown";
}

export function pseudonymizeSecuritySubject(kind: string, value: string, secret: string) {
  if (secret.length < 32) throw new Error("A security pseudonym secret of at least 32 characters is required.");
  return createHmac("sha256", secret).update(`${kind}\0${value}`).digest("base64url");
}
