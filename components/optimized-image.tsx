import Image from "next/image";

type OptimizedImageProps = {
  src?: string | null;
  alt: string;
  width?: number;
  height?: number;
  fill?: boolean;
  sizes?: string;
  priority?: boolean;
  className?: string;
  imageClassName?: string;
  fallbackSrc?: string;
  quality?: number;
  loading?: "lazy" | "eager";
};

function isSvg(src: string) {
  return /\.svg($|\?)/i.test(src);
}

function EmptyImageFallback({ className }: { className?: string }) {
  return (
    <div className={`flex h-full w-full items-center justify-center bg-[#f3efe8] ${className || ""}`}>
      <svg
        aria-hidden="true"
        className="h-12 w-12 text-stone-300"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        viewBox="0 0 64 64"
      >
        <path d="M24 22c0-4 3-8 8-8s8 4 8 8" />
        <path d="M14 50V28c0-2 1-4 3-4h30c2 0 3 2 3 4v22" />
        <path d="M20 24l-4-4m24 4l4-4" />
        <path d="M16 50h32v4c0 2-1 3-3 3H19c-2 0-3-1-3-3v-4z" />
      </svg>
    </div>
  );
}

export function OptimizedImage({
  src,
  alt,
  width,
  height,
  fill,
  sizes,
  priority,
  className,
  imageClassName,
  fallbackSrc,
  quality = 75,
  loading,
}: OptimizedImageProps) {
  const imageSrc = src?.trim() || fallbackSrc?.trim() || "";

  if (!imageSrc) {
    return <EmptyImageFallback className={className} />;
  }

  if (fill) {
    return (
      <div className={className}>
        <Image
          alt={alt}
          className={imageClassName}
          fill
          loading={priority ? undefined : loading}
          priority={priority}
          quality={quality}
          sizes={sizes}
          src={imageSrc}
          unoptimized={isSvg(imageSrc)}
        />
      </div>
    );
  }

  return (
    <Image
      alt={alt}
      className={className}
      height={height || 900}
      loading={priority ? undefined : loading}
      priority={priority}
      quality={quality}
      sizes={sizes}
      src={imageSrc}
      unoptimized={isSvg(imageSrc)}
      width={width || 720}
    />
  );
}
