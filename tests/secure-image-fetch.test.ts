import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
// @ts-expect-error Node's strip-only test runner requires the explicit .ts extension.
import { RemoteImageError, downloadRemoteImage, isPublicNetworkAddress, type RemoteImageRequest, type RemoteImageResolver } from "../lib/secure-image-fetch.ts";

const allowedOrigin = "https://customer.supabase.co";
const allowedUrl = `${allowedOrigin}/storage/v1/object/public/product-images/products/1/a/main.webp`;

function resolverFor(address: string, family: 4 | 6 = 4): RemoteImageResolver {
  return async () => [{ address, family }];
}

function chunks(...values: Buffer[]) {
  return (async function* () {
    for (const value of values) yield value;
  })();
}

test("private, loopback, link-local, metadata, IPv6 private, and documentation networks are blocked", () => {
  for (const address of [
    "0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1",
    "192.168.1.1", "198.18.0.1", "224.0.0.1", "::", "::1", "fc00::1", "fd00::1", "fe80::1",
    "ff02::1", "2001:db8::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1",
  ]) {
    assert.equal(isPublicNetworkAddress(address), false, `${address} should be blocked`);
  }
  assert.equal(isPublicNetworkAddress("93.184.216.34"), true);
  assert.equal(isPublicNetworkAddress("2606:4700:4700::1111"), true);
});

test("origin allowlist, current Storage path, and DNS answers are validated before requesting", async () => {
  let requested = false;
  const request: RemoteImageRequest = async () => {
    requested = true;
    throw new Error("must not be called");
  };

  await assert.rejects(
    downloadRemoteImage("https://evil.example/image.webp", {
      allowedOrigins: [allowedOrigin],
      storageOrigin: allowedOrigin,
      resolver: resolverFor("93.184.216.34"),
      request,
    }),
    (error: unknown) => error instanceof RemoteImageError && error.code === "ORIGIN_NOT_ALLOWED",
  );
  await assert.rejects(
    downloadRemoteImage(`${allowedOrigin}/not-storage/image.webp`, {
      allowedOrigins: [allowedOrigin],
      storageOrigin: allowedOrigin,
      resolver: resolverFor("93.184.216.34"),
      request,
    }),
    (error: unknown) => error instanceof RemoteImageError && error.code === "STORAGE_PATH_NOT_ALLOWED",
  );
  await assert.rejects(
    downloadRemoteImage(allowedUrl, {
      allowedOrigins: [allowedOrigin],
      storageOrigin: allowedOrigin,
      resolver: resolverFor("127.0.0.1"),
      request,
    }),
    (error: unknown) => error instanceof RemoteImageError && error.code === "PRIVATE_NETWORK_BLOCKED",
  );
  assert.equal(requested, false);
});

test("redirect targets are revalidated and cannot reach private or foreign hosts", async () => {
  const request: RemoteImageRequest = async ({ url }) => ({
    statusCode: 302,
    headers: { location: url.hostname === "customer.supabase.co" ? "http://127.0.0.1/latest/meta-data" : "" },
    body: chunks(),
  });
  await assert.rejects(
    downloadRemoteImage(allowedUrl, {
      allowedOrigins: [allowedOrigin],
      storageOrigin: allowedOrigin,
      resolver: resolverFor("93.184.216.34"),
      request,
    }),
    RemoteImageError,
  );

  const foreignRedirect: RemoteImageRequest = async () => ({
    statusCode: 302,
    headers: { location: "https://evil.example/image.webp" },
    body: chunks(),
  });
  await assert.rejects(
    downloadRemoteImage(allowedUrl, {
      allowedOrigins: [allowedOrigin],
      storageOrigin: allowedOrigin,
      resolver: resolverFor("93.184.216.34"),
      request: foreignRedirect,
    }),
    (error: unknown) => error instanceof RemoteImageError && error.code === "ORIGIN_NOT_ALLOWED",
  );
});

test("DNS resolution is bounded by the request timeout and never reaches the transport after timeout", async () => {
  let requested = false;
  const startedAt = Date.now();
  await assert.rejects(
    downloadRemoteImage(allowedUrl, {
      allowedOrigins: [allowedOrigin],
      storageOrigin: allowedOrigin,
      timeoutMs: 10,
      resolver: () => new Promise((resolve) => setTimeout(() => resolve([{ address: "93.184.216.34", family: 4 }]), 250)),
      request: async () => {
        requested = true;
        throw new Error("must not be called");
      },
    }),
    (error: unknown) => error instanceof RemoteImageError && error.code === "DNS_FAILED",
  );
  assert.equal(requested, false);
  assert.ok(Date.now() - startedAt < 200, "DNS timeout should fail without waiting for the resolver");
});

test("requests are pinned to the validated DNS address and enforce headers and streaming limits", async () => {
  const image = await sharp({ create: { width: 4, height: 4, channels: 3, background: "red" } }).jpeg().toBuffer();
  let pinnedAddress = "";
  let resolverCalls = 0;
  const resolver: RemoteImageResolver = async () => {
    resolverCalls += 1;
    return [{ address: "93.184.216.34", family: 4 }];
  };
  const request: RemoteImageRequest = async ({ address }) => {
    pinnedAddress = address;
    return {
      statusCode: 200,
      headers: { "content-type": "image/jpeg", "content-length": String(image.length) },
      body: chunks(image.subarray(0, 3), image.subarray(3)),
    };
  };
  const downloaded = await downloadRemoteImage(allowedUrl, {
    allowedOrigins: [allowedOrigin], storageOrigin: allowedOrigin, resolver, request, maxBytes: image.length + 1,
  });
  assert.equal(pinnedAddress, "93.184.216.34");
  assert.equal(resolverCalls, 1, "the transport must use the already validated DNS answer");
  assert.deepEqual(downloaded.buffer, image);

  for (const response of [
    { headers: { "content-type": "text/html" }, body: chunks(Buffer.from("<script>")) },
    { headers: { "content-type": "image/jpeg", "content-length": "999999" }, body: chunks(image) },
    { headers: { "content-type": "image/jpeg" }, body: chunks(Buffer.alloc(8), Buffer.alloc(8)) },
  ]) {
    await assert.rejects(
      downloadRemoteImage(allowedUrl, {
        allowedOrigins: [allowedOrigin],
        storageOrigin: allowedOrigin,
        resolver,
        request: async () => ({ statusCode: 200, ...response }),
        maxBytes: 10,
      }),
      RemoteImageError,
    );
  }
});
