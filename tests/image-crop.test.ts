import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-only test runner requires the explicit .ts extension.
import { clampCropOffset, cropOutputSize, cropSourceRect } from "../lib/image-crop.ts";

test("portrait phone photos crop to a centered 3:4 source rectangle", () => {
  const rect = cropSourceRect(3024, 4032, 300, 400, 1, { x: 0, y: 0 });
  assert.deepEqual(rect, { x: 0, y: 0, width: 3024, height: 4032 });
  assert.deepEqual(cropOutputSize(rect.width, rect.height), { width: 1200, height: 1600 });
});

test("wide images crop safely without exposing an empty edge", () => {
  const offset = clampCropOffset({ x: 9999, y: -9999 }, 4000, 3000, 300, 400, 1);
  assert.ok(Math.abs(offset.x - 116.66666666666669) < 0.000001);
  assert.equal(offset.y, 0);
  const rect = cropSourceRect(4000, 3000, 300, 400, 1, offset);
  assert.ok(rect.x >= 0 && rect.x + rect.width <= 4000);
  assert.ok(rect.y >= 0 && rect.y + rect.height <= 3000);
  assert.equal(Math.round(rect.width / rect.height * 100), 75);
});

test("small inputs are not upscaled beyond their crop dimensions", () => {
  assert.deepEqual(cropOutputSize(600, 800), { width: 600, height: 800 });
});
