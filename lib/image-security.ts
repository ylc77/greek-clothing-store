import sharp from "sharp";

export type SupportedImageFormat = "jpeg" | "png" | "webp";

export type ImageLimits = {
  maxBytes: number;
  maxPixels: number;
  maxWidth: number;
  maxHeight: number;
};

export type OptimizeImageOptions = ImageLimits & {
  declaredMimeType: string;
  resize?: {
    width?: number;
    height?: number;
    fit?: "cover" | "contain" | "fill" | "inside" | "outside";
  };
  quality?: number;
};

export type OptimizedImage = {
  buffer: Buffer;
  format: "webp";
  sourceFormat: SupportedImageFormat;
  sourceWidth: number;
  sourceHeight: number;
  width: number;
  height: number;
};

const mimeForFormat: Record<SupportedImageFormat, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export class ImageValidationError extends Error {
  readonly code:
    | "EMPTY_FILE"
    | "FILE_TOO_LARGE"
    | "UNSUPPORTED_MIME"
    | "UNSUPPORTED_MAGIC"
    | "MIME_MISMATCH"
    | "INVALID_IMAGE"
    | "ANIMATED_IMAGE_NOT_ALLOWED"
    | "DIMENSIONS_TOO_LARGE"
    | "PIXEL_LIMIT_EXCEEDED";

  constructor(
    code:
      | "EMPTY_FILE"
      | "FILE_TOO_LARGE"
      | "UNSUPPORTED_MIME"
      | "UNSUPPORTED_MAGIC"
      | "MIME_MISMATCH"
      | "INVALID_IMAGE"
      | "ANIMATED_IMAGE_NOT_ALLOWED"
      | "DIMENSIONS_TOO_LARGE"
      | "PIXEL_LIMIT_EXCEEDED",
    message: string,
  ) {
    super(message);
    this.name = "ImageValidationError";
    this.code = code;
  }
}

export function detectImageFormat(buffer: Uint8Array): SupportedImageFormat | null {
  if (
    buffer.length >= 3
    && buffer[0] === 0xff
    && buffer[1] === 0xd8
    && buffer[2] === 0xff
  ) return "jpeg";

  if (
    buffer.length >= 8
    && buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47
    && buffer[4] === 0x0d
    && buffer[5] === 0x0a
    && buffer[6] === 0x1a
    && buffer[7] === 0x0a
  ) return "png";

  if (
    buffer.length >= 12
    && Buffer.from(buffer.subarray(0, 4)).toString("ascii") === "RIFF"
    && Buffer.from(buffer.subarray(8, 12)).toString("ascii") === "WEBP"
  ) return "webp";

  return null;
}

export function assertImageDimensions(
  dimensions: { width: number; height: number },
  limits: Pick<ImageLimits, "maxPixels" | "maxWidth" | "maxHeight">,
) {
  const { width, height } = dimensions;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new ImageValidationError("INVALID_IMAGE", "Image dimensions are missing or invalid.");
  }
  if (width > limits.maxWidth || height > limits.maxHeight) {
    throw new ImageValidationError(
      "DIMENSIONS_TOO_LARGE",
      `Image dimensions ${width}x${height} exceed the ${limits.maxWidth}x${limits.maxHeight} limit.`,
    );
  }
  if (width * height > limits.maxPixels) {
    throw new ImageValidationError(
      "PIXEL_LIMIT_EXCEEDED",
      `Image contains ${width * height} pixels, exceeding the ${limits.maxPixels} pixel limit.`,
    );
  }
}

export async function optimizeUploadedImage(
  input: Buffer,
  options: OptimizeImageOptions,
): Promise<OptimizedImage> {
  if (input.length === 0) {
    throw new ImageValidationError("EMPTY_FILE", "Image file is empty.");
  }
  if (input.length > options.maxBytes) {
    throw new ImageValidationError(
      "FILE_TOO_LARGE",
      `Image is larger than the ${(options.maxBytes / 1024 / 1024).toFixed(0)} MB limit.`,
    );
  }

  const declaredMimeType = options.declaredMimeType.trim().toLowerCase();
  const declaredFormat = (Object.entries(mimeForFormat).find(([, mime]) => mime === declaredMimeType)?.[0] || null) as SupportedImageFormat | null;
  if (!declaredFormat) {
    throw new ImageValidationError("UNSUPPORTED_MIME", "Only JPEG, PNG, and WebP images are accepted.");
  }

  const sourceFormat = detectImageFormat(input);
  if (!sourceFormat) {
    throw new ImageValidationError("UNSUPPORTED_MAGIC", "The file signature is not JPEG, PNG, or WebP.");
  }
  if (sourceFormat !== declaredFormat) {
    throw new ImageValidationError(
      "MIME_MISMATCH",
      `The declared ${declaredMimeType} type does not match the file signature.`,
    );
  }

  try {
    const source = sharp(input, {
      failOn: "error",
      limitInputPixels: options.maxPixels,
      sequentialRead: true,
      animated: false,
    });
    const metadata = await source.metadata();
    const width = metadata.width || 0;
    const height = metadata.height || 0;
    if (metadata.pages && metadata.pages > 1) {
      throw new ImageValidationError("ANIMATED_IMAGE_NOT_ALLOWED", "Animated or multi-page images are not accepted.");
    }
    if (metadata.format !== sourceFormat) {
      throw new ImageValidationError("INVALID_IMAGE", "Decoded image format does not match its file signature.");
    }
    assertImageDimensions({ width, height }, options);

    const pipeline = sharp(input, {
      failOn: "error",
      limitInputPixels: options.maxPixels,
      sequentialRead: true,
      animated: false,
    }).rotate();
    if (options.resize) {
      pipeline.resize({
        width: options.resize.width,
        height: options.resize.height,
        fit: options.resize.fit || "inside",
        withoutEnlargement: true,
      });
    }
    const output = await pipeline
      .webp({ quality: options.quality ?? 82 })
      .toBuffer({ resolveWithObject: true });
    assertImageDimensions({ width: output.info.width, height: output.info.height }, options);
    return {
      buffer: output.data,
      format: "webp",
      sourceFormat,
      sourceWidth: width,
      sourceHeight: height,
      width: output.info.width,
      height: output.info.height,
    };
  } catch (error) {
    if (error instanceof ImageValidationError) throw error;
    throw new ImageValidationError(
      "INVALID_IMAGE",
      error instanceof Error ? `Image processing failed: ${error.message}` : "Image processing failed.",
    );
  }
}

export async function optimizeImageFile(file: File, options: Omit<OptimizeImageOptions, "declaredMimeType">) {
  if (file.size === 0) throw new ImageValidationError("EMPTY_FILE", "Image file is empty.");
  if (file.size > options.maxBytes) {
    throw new ImageValidationError(
      "FILE_TOO_LARGE",
      `Image is larger than the ${(options.maxBytes / 1024 / 1024).toFixed(0)} MB limit.`,
    );
  }
  return optimizeUploadedImage(Buffer.from(await file.arrayBuffer()), {
    ...options,
    declaredMimeType: file.type,
  });
}
