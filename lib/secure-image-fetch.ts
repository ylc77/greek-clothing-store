import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";

export type RemoteImageResolver = (hostname: string) => Promise<Array<{ address: string; family: 4 | 6 }>>;

export type RemoteImageRequestResult = {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: AsyncIterable<Uint8Array>;
  cancel?: () => void;
};

export type RemoteImageRequest = (input: {
  url: URL;
  address: string;
  family: 4 | 6;
  timeoutMs: number;
}) => Promise<RemoteImageRequestResult>;

export type RemoteImagePolicy = {
  allowedOrigins: string[];
  storageOrigin?: string;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  resolver?: RemoteImageResolver;
  request?: RemoteImageRequest;
};

export class RemoteImageError extends Error {
  readonly code:
    | "INVALID_URL"
    | "PROTOCOL_NOT_ALLOWED"
    | "ORIGIN_NOT_ALLOWED"
    | "STORAGE_PATH_NOT_ALLOWED"
    | "DNS_FAILED"
    | "PRIVATE_NETWORK_BLOCKED"
    | "REDIRECT_LIMIT"
    | "DOWNLOAD_FAILED"
    | "CONTENT_TYPE_NOT_ALLOWED"
    | "CONTENT_LENGTH_INVALID"
    | "BODY_TOO_LARGE"
    | "EMPTY_BODY";

  constructor(
    code:
      | "INVALID_URL"
      | "PROTOCOL_NOT_ALLOWED"
      | "ORIGIN_NOT_ALLOWED"
      | "STORAGE_PATH_NOT_ALLOWED"
      | "DNS_FAILED"
      | "PRIVATE_NETWORK_BLOCKED"
      | "REDIRECT_LIMIT"
      | "DOWNLOAD_FAILED"
      | "CONTENT_TYPE_NOT_ALLOWED"
      | "CONTENT_LENGTH_INVALID"
      | "BODY_TOO_LARGE"
      | "EMPTY_BODY",
    message: string,
  ) {
    super(message);
    this.name = "RemoteImageError";
    this.code = code;
  }
}

const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["100::", 64], ["2001:2::", 48],
  ["2001:db8::", 32], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) blocked.addSubnet(network, prefix, "ipv6");

export function isPublicNetworkAddress(address: string) {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, "ipv4");
  if (family === 6) return !blocked.check(address, "ipv6");
  return false;
}

const defaultResolver: RemoteImageResolver = async (hostname) => {
  const results = await dnsLookup(hostname, { all: true, verbatim: true });
  return results.map((result) => ({ address: result.address, family: result.family as 4 | 6 }));
};

function headerValue(headers: Record<string, string | string[] | undefined>, name: string) {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function normalizeOrigin(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

function validateTarget(value: string | URL, policy: RemoteImagePolicy) {
  let url: URL;
  try {
    url = value instanceof URL ? value : new URL(value);
  } catch {
    throw new RemoteImageError("INVALID_URL", "Reference image URL is invalid.");
  }
  if (url.protocol !== "https:") {
    throw new RemoteImageError("PROTOCOL_NOT_ALLOWED", "Reference images must use HTTPS.");
  }
  if (url.username || url.password) {
    throw new RemoteImageError("INVALID_URL", "Reference image URL must not contain credentials.");
  }
  const allowedOrigins = new Set(policy.allowedOrigins.map(normalizeOrigin).filter(Boolean));
  if (!allowedOrigins.has(url.origin)) {
    throw new RemoteImageError("ORIGIN_NOT_ALLOWED", "Reference image host is not in the server allowlist.");
  }
  const storageOrigin = policy.storageOrigin ? normalizeOrigin(policy.storageOrigin) : "";
  if (storageOrigin && url.origin === storageOrigin) {
    const prefix = "/storage/v1/object/public/product-images/";
    if (!url.pathname.startsWith(prefix) || url.pathname.length <= prefix.length) {
      throw new RemoteImageError("STORAGE_PATH_NOT_ALLOWED", "Reference URL is outside the managed product image bucket.");
    }
  }
  return url;
}

const defaultRequest: RemoteImageRequest = async ({ url, address, family, timeoutMs }) => new Promise((resolve, reject) => {
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;
  let settled = false;
  const req = request(url, {
    method: "GET",
    headers: {
      accept: "image/jpeg,image/png,image/webp",
      "user-agent": "greek-clothing-store-image-fetch/1.0",
    },
    lookup: (_hostname, _options, callback) => callback(null, address, family),
  }, (response) => {
    settled = true;
    const body = (async function* () {
      try {
        for await (const chunk of response) yield Buffer.from(chunk);
      } finally {
        clearTimeout(timer);
      }
    })();
    resolve({
      statusCode: response.statusCode || 0,
      headers: response.headers,
      body,
      cancel: () => {
        clearTimeout(timer);
        response.destroy();
      },
    });
  });
  const timer = setTimeout(() => req.destroy(new Error("Reference image request timed out.")), timeoutMs);
  timer.unref?.();
  req.once("error", (error) => {
    clearTimeout(timer);
    if (!settled) reject(error);
  });
  req.end();
});

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function downloadRemoteImage(sourceUrl: string, policy: RemoteImagePolicy) {
  const maxBytes = policy.maxBytes ?? 15 * 1024 * 1024;
  const timeoutMs = policy.timeoutMs ?? 20_000;
  const maxRedirects = policy.maxRedirects ?? 3;
  const resolver = policy.resolver || defaultResolver;
  const request = policy.request || defaultRequest;
  let current = validateTarget(sourceUrl, policy);

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    let addresses: Array<{ address: string; family: 4 | 6 }>;
    try {
      if (isIP(current.hostname)) {
        addresses = [{ address: current.hostname, family: isIP(current.hostname) as 4 | 6 }];
      } else {
        addresses = await withTimeout(resolver(current.hostname), timeoutMs, "Reference image DNS lookup timed out.");
      }
    } catch (error) {
      throw new RemoteImageError("DNS_FAILED", error instanceof Error ? `Reference image DNS lookup failed: ${error.message}` : "Reference image DNS lookup failed.");
    }
    if (addresses.length === 0) throw new RemoteImageError("DNS_FAILED", "Reference image host did not resolve.");
    if (addresses.some((entry) => !isPublicNetworkAddress(entry.address))) {
      throw new RemoteImageError("PRIVATE_NETWORK_BLOCKED", "Reference image host resolves to a private or reserved network.");
    }
    const pinned = addresses[0];

    let response: RemoteImageRequestResult;
    try {
      response = await request({ url: current, address: pinned.address, family: pinned.family, timeoutMs });
    } catch (error) {
      throw new RemoteImageError("DOWNLOAD_FAILED", error instanceof Error ? `Reference image request failed: ${error.message}` : "Reference image request failed.");
    }

    if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
      response.cancel?.();
      if (redirectCount >= maxRedirects) throw new RemoteImageError("REDIRECT_LIMIT", "Reference image exceeded the redirect limit.");
      const location = headerValue(response.headers, "location");
      if (!location) throw new RemoteImageError("DOWNLOAD_FAILED", "Reference image redirect omitted its destination.");
      current = validateTarget(new URL(location, current), policy);
      continue;
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      response.cancel?.();
      throw new RemoteImageError("DOWNLOAD_FAILED", `Reference image returned HTTP ${response.statusCode}.`);
    }
    const contentType = headerValue(response.headers, "content-type").split(";", 1)[0].trim().toLowerCase();
    if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(contentType)) {
      response.cancel?.();
      throw new RemoteImageError("CONTENT_TYPE_NOT_ALLOWED", "Reference image response is not JPEG, PNG, or WebP.");
    }
    const rawLength = headerValue(response.headers, "content-length").trim();
    if (rawLength) {
      const declaredLength = Number(rawLength);
      if (!Number.isSafeInteger(declaredLength) || declaredLength < 0) {
        response.cancel?.();
        throw new RemoteImageError("CONTENT_LENGTH_INVALID", "Reference image Content-Length is invalid.");
      }
      if (declaredLength > maxBytes) {
        response.cancel?.();
        throw new RemoteImageError("BODY_TOO_LARGE", "Reference image exceeds the download byte limit.");
      }
    }

    const chunks: Buffer[] = [];
    let total = 0;
    try {
      for await (const chunk of response.body) {
        const buffer = Buffer.from(chunk);
        total += buffer.length;
        if (total > maxBytes) {
          response.cancel?.();
          throw new RemoteImageError("BODY_TOO_LARGE", "Reference image exceeded the streaming byte limit.");
        }
        chunks.push(buffer);
      }
    } catch (error) {
      if (error instanceof RemoteImageError) throw error;
      throw new RemoteImageError("DOWNLOAD_FAILED", error instanceof Error ? `Reference image stream failed: ${error.message}` : "Reference image stream failed.");
    }
    if (total === 0) throw new RemoteImageError("EMPTY_BODY", "Reference image response was empty.");
    return { buffer: Buffer.concat(chunks, total), contentType, finalUrl: current.toString(), pinnedAddress: pinned.address };
  }

  throw new RemoteImageError("REDIRECT_LIMIT", "Reference image exceeded the redirect limit.");
}
