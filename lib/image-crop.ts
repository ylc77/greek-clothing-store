export const PRODUCT_IMAGE_ASPECT_WIDTH = 3;
export const PRODUCT_IMAGE_ASPECT_HEIGHT = 4;
export const PRODUCT_IMAGE_OUTPUT_WIDTH = 1200;
export const PRODUCT_IMAGE_OUTPUT_HEIGHT = 1600;

export type CropOffset = { x: number; y: number };

export function cropCoverScale(
  sourceWidth: number,
  sourceHeight: number,
  frameWidth: number,
  frameHeight: number,
) {
  if (sourceWidth <= 0 || sourceHeight <= 0 || frameWidth <= 0 || frameHeight <= 0) return 1;
  return Math.max(frameWidth / sourceWidth, frameHeight / sourceHeight);
}

export function clampCropOffset(
  offset: CropOffset,
  sourceWidth: number,
  sourceHeight: number,
  frameWidth: number,
  frameHeight: number,
  zoom: number,
): CropOffset {
  const scale = cropCoverScale(sourceWidth, sourceHeight, frameWidth, frameHeight) * Math.max(1, zoom);
  const maxX = Math.max(0, (sourceWidth * scale - frameWidth) / 2);
  const maxY = Math.max(0, (sourceHeight * scale - frameHeight) / 2);
  return {
    x: maxX === 0 ? 0 : Math.max(-maxX, Math.min(maxX, offset.x)),
    y: maxY === 0 ? 0 : Math.max(-maxY, Math.min(maxY, offset.y)),
  };
}

export function cropSourceRect(
  sourceWidth: number,
  sourceHeight: number,
  frameWidth: number,
  frameHeight: number,
  zoom: number,
  offset: CropOffset,
) {
  const safeOffset = clampCropOffset(offset, sourceWidth, sourceHeight, frameWidth, frameHeight, zoom);
  const scale = cropCoverScale(sourceWidth, sourceHeight, frameWidth, frameHeight) * Math.max(1, zoom);
  const width = Math.min(sourceWidth, frameWidth / scale);
  const height = Math.min(sourceHeight, frameHeight / scale);
  return {
    x: Math.max(0, Math.min(sourceWidth - width, (sourceWidth - width) / 2 - safeOffset.x / scale)),
    y: Math.max(0, Math.min(sourceHeight - height, (sourceHeight - height) / 2 - safeOffset.y / scale)),
    width,
    height,
  };
}

export function cropOutputSize(sourceCropWidth: number, sourceCropHeight: number) {
  const width = Math.max(1, Math.min(PRODUCT_IMAGE_OUTPUT_WIDTH, Math.floor(sourceCropWidth)));
  const height = Math.max(1, Math.min(PRODUCT_IMAGE_OUTPUT_HEIGHT, Math.floor(sourceCropHeight), Math.round(width * PRODUCT_IMAGE_ASPECT_HEIGHT / PRODUCT_IMAGE_ASPECT_WIDTH)));
  const normalizedWidth = Math.max(1, Math.min(width, Math.round(height * PRODUCT_IMAGE_ASPECT_WIDTH / PRODUCT_IMAGE_ASPECT_HEIGHT)));
  return { width: normalizedWidth, height };
}
