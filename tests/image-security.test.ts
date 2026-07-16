import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {
  ImageValidationError,
  assertImageDimensions,
  detectImageFormat,
  optimizeUploadedImage,
} from "../lib/image-security.ts";

async function fixture(format: "jpeg" | "png" | "webp") {
  const pipeline = sharp({
    create: {
      width: 32,
      height: 24,
      channels: 4,
      background: { r: 30, g: 60, b: 90, alpha: 1 },
    },
  });
  return format === "jpeg"
    ? pipeline.jpeg().toBuffer()
    : format === "png"
      ? pipeline.png().toBuffer()
      : pipeline.webp().toBuffer();
}

test("JPEG, PNG, and WebP require matching magic bytes and are always re-encoded", async () => {
  for (const [format, mime] of [
    ["jpeg", "image/jpeg"],
    ["png", "image/png"],
    ["webp", "image/webp"],
  ] as const) {
    const input = await fixture(format);
    assert.equal(detectImageFormat(input), format);
    const output = await optimizeUploadedImage(input, {
      declaredMimeType: mime,
      maxBytes: 1024 * 1024,
      maxPixels: 1_000_000,
      maxWidth: 2_000,
      maxHeight: 2_000,
      resize: { width: 400, height: 400, fit: "inside" },
    });
    assert.equal(output.format, "webp");
    assert.equal(detectImageFormat(output.buffer), "webp");
    assert.equal(output.width, 32);
    assert.equal(output.height, 24);
    assert.notEqual(output.buffer, input, "even WebP input must pass through Sharp");
  }
});

test("forged MIME, SVG/script, HEIC, and malformed images are rejected", async () => {
  const jpeg = await fixture("jpeg");
  await assert.rejects(
    optimizeUploadedImage(jpeg, {
      declaredMimeType: "image/png",
      maxBytes: 1024 * 1024,
      maxPixels: 1_000_000,
      maxWidth: 2_000,
      maxHeight: 2_000,
    }),
    (error: unknown) => error instanceof ImageValidationError && error.code === "MIME_MISMATCH",
  );

  for (const [content, mime] of [
    [Buffer.from('<svg onload="alert(1)"><script>alert(1)</script></svg>'), "image/svg+xml"],
    [Buffer.from("ftypheic\u0000\u0000\u0000\u0000"), "image/heic"],
    [Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]), "image/jpeg"],
    [Buffer.from("RIFF\u0010\u0000\u0000\u0000WEBPbad"), "image/webp"],
  ] as const) {
    await assert.rejects(
      optimizeUploadedImage(content, {
        declaredMimeType: mime,
        maxBytes: 1024 * 1024,
        maxPixels: 1_000_000,
        maxWidth: 2_000,
        maxHeight: 2_000,
      }),
      ImageValidationError,
    );
  }
});

test("byte, width, height, and decompressed pixel limits fail closed", async () => {
  const png = await fixture("png");
  await assert.rejects(
    optimizeUploadedImage(png, {
      declaredMimeType: "image/png",
      maxBytes: png.length - 1,
      maxPixels: 1_000_000,
      maxWidth: 2_000,
      maxHeight: 2_000,
    }),
    (error: unknown) => error instanceof ImageValidationError && error.code === "FILE_TOO_LARGE",
  );

  assert.throws(
    () => assertImageDimensions({ width: 12_001, height: 20 }, { maxPixels: 40_000_000, maxWidth: 12_000, maxHeight: 12_000 }),
    (error: unknown) => error instanceof ImageValidationError && error.code === "DIMENSIONS_TOO_LARGE",
  );
  assert.throws(
    () => assertImageDimensions({ width: 20, height: 12_001 }, { maxPixels: 40_000_000, maxWidth: 12_000, maxHeight: 12_000 }),
    (error: unknown) => error instanceof ImageValidationError && error.code === "DIMENSIONS_TOO_LARGE",
  );
  assert.throws(
    () => assertImageDimensions({ width: 8_000, height: 6_000 }, { maxPixels: 40_000_000, maxWidth: 12_000, maxHeight: 12_000 }),
    (error: unknown) => error instanceof ImageValidationError && error.code === "PIXEL_LIMIT_EXCEEDED",
  );
});

