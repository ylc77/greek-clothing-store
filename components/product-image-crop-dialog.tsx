"use client";

import { useEffect, useRef, useState } from "react";
import {
  clampCropOffset,
  cropCoverScale,
  cropOutputSize,
  cropSourceRect,
  type CropOffset,
} from "@/lib/image-crop";

type ProductImageCropDialogProps = {
  files: File[];
  title: string;
  onCancel: () => void;
  onComplete: (files: File[]) => void;
};

const initialOffset: CropOffset = { x: 0, y: 0 };

export function ProductImageCropDialog({ files, title, onCancel, onComplete }: ProductImageCropDialogProps) {
  const [index, setIndex] = useState(0);
  const [completed, setCompleted] = useState<File[]>([]);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [frameSize, setFrameSize] = useState({ width: 300, height: 400 });
  const [offset, setOffset] = useState<CropOffset>(initialOffset);
  const [zoom, setZoom] = useState(1);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const frameRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const file = files[index];
  const [objectUrl, setObjectUrl] = useState("");

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    setImageSize({ width: 0, height: 0 });
    setOffset(initialOffset);
    setZoom(1);
    setError("");
  }, [file]);
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const update = () => {
      const rect = frame.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) setFrameSize({ width: rect.width, height: rect.height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  if (!file) return null;

  const safeOffset = clampCropOffset(offset, imageSize.width, imageSize.height, frameSize.width, frameSize.height, zoom);
  const displayScale = cropCoverScale(imageSize.width, imageSize.height, frameSize.width, frameSize.height) * zoom;
  const displayWidth = imageSize.width * displayScale;
  const displayHeight = imageSize.height * displayScale;

  function updateOffset(next: CropOffset) {
    setOffset(clampCropOffset(next, imageSize.width, imageSize.height, frameSize.width, frameSize.height, zoom));
  }

  function pointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!imageSize.width) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  }

  function pointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const next = { x: safeOffset.x + event.clientX - drag.x, y: safeOffset.y + event.clientY - drag.y };
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    updateOffset(next);
  }

  function pointerEnd(event: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  }

  async function confirmCrop() {
    const image = imageRef.current;
    if (!image || !imageSize.width) return;
    setProcessing(true);
    setError("");
    try {
      const rect = cropSourceRect(imageSize.width, imageSize.height, frameSize.width, frameSize.height, zoom, safeOffset);
      const output = cropOutputSize(rect.width, rect.height);
      const canvas = document.createElement("canvas");
      canvas.width = output.width;
      canvas.height = output.height;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("当前浏览器无法处理图片，请换用最新版 Chrome 或 Safari。");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, output.width, output.height);
      context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, output.width, output.height);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(value => value ? resolve(value) : reject(new Error("图片裁剪失败。")), "image/webp", 0.9);
      });
      const name = file.name.replace(/\.[^.]+$/, "") + ".webp";
      const nextFiles = [...completed, new File([blob], name, { type: "image/webp", lastModified: Date.now() })];
      if (index + 1 < files.length) {
        setCompleted(nextFiles);
        setIndex(current => current + 1);
      } else {
        onComplete(nextFiles);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "图片裁剪失败。");
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div aria-modal="true" className="fixed inset-0 z-[100] flex items-center justify-center bg-stone-950/70 p-3 backdrop-blur-sm" role="dialog">
      <div className="max-h-[96vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white p-4 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-black text-ink">{title}</h2>
            <p className="mt-1 text-xs font-bold text-stone-500">拖动图片调整位置，用滑块缩放。成品为手机竖拍常用的 3:4 比例。</p>
          </div>
          <span className="shrink-0 rounded-full bg-stone-100 px-3 py-1 text-xs font-black text-stone-600">{index + 1} / {files.length}</span>
        </div>

        <div className="mt-4 grid gap-5 md:grid-cols-[minmax(260px,360px)_minmax(0,1fr)] md:items-center">
          <div
            className="relative mx-auto aspect-[3/4] w-full max-w-[360px] touch-none cursor-grab overflow-hidden rounded-2xl border-2 border-white bg-white shadow-xl active:cursor-grabbing"
            onPointerCancel={pointerEnd}
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={pointerEnd}
            ref={frameRef}
          >
            {objectUrl ? <img
              alt="待裁剪商品图"
              className="pointer-events-none absolute left-1/2 top-1/2 max-w-none select-none"
              draggable={false}
              onError={() => setError("无法读取这张图片，请使用 JPG、PNG 或 WebP。")}
              onLoad={event => { setError(""); setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }); }}
              ref={imageRef}
              src={objectUrl}
              style={{
                width: displayWidth || "auto",
                height: displayHeight || "auto",
                transform: `translate(-50%, -50%) translate(${safeOffset.x}px, ${safeOffset.y}px)`,
              }}
            /> : <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-stone-400">正在读取图片...</div>}
            <div className="pointer-events-none absolute inset-0 border border-white/80 shadow-[inset_0_0_0_999px_rgba(0,0,0,0.03)]" />
            <div className="pointer-events-none absolute inset-x-0 top-1/3 border-t border-dashed border-white/70" />
            <div className="pointer-events-none absolute inset-x-0 top-2/3 border-t border-dashed border-white/70" />
            <div className="pointer-events-none absolute inset-y-0 left-1/3 border-l border-dashed border-white/70" />
            <div className="pointer-events-none absolute inset-y-0 left-2/3 border-l border-dashed border-white/70" />
          </div>

          <div>
            <p className="truncate text-sm font-black text-ink" title={file.name}>{file.name}</p>
            <p className="mt-1 text-xs text-stone-500">原图 {imageSize.width || "-"} × {imageSize.height || "-"}</p>
            <label className="mt-5 block text-sm font-black text-ink">
              缩放 {zoom.toFixed(2)}×
              <input
                className="mt-3 w-full accent-stone-900"
                max="3"
                min="1"
                onChange={event => {
                  const nextZoom = Number(event.target.value);
                  setZoom(nextZoom);
                  setOffset(current => clampCropOffset(current, imageSize.width, imageSize.height, frameSize.width, frameSize.height, nextZoom));
                }}
                step="0.01"
                type="range"
                value={zoom}
              />
            </label>
            <button className="mt-4 text-xs font-black text-stone-500 underline underline-offset-4" onClick={() => { setZoom(1); setOffset(initialOffset); }} type="button">恢复居中</button>
            <div className="mt-5 rounded-xl bg-stone-50 p-3 text-xs leading-5 text-stone-600">
              建议让衣服完整位于画面内，头部和鞋子保留少量空间。这个裁剪在浏览器本地完成，不调用 AI。
            </div>
            {error ? <p className="mt-3 rounded-xl border border-red-100 bg-red-50 p-3 text-xs font-bold text-red-700" role="alert">{error}</p> : null}
          </div>
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button className="min-h-11 rounded-xl border border-stone-300 px-5 py-2.5 text-sm font-black text-ink hover:bg-stone-50" disabled={processing} onClick={onCancel} type="button">取消</button>
          <button className="min-h-11 rounded-xl bg-ink px-5 py-2.5 text-sm font-black text-white hover:bg-stone-800 disabled:opacity-50" disabled={processing || !imageSize.width || Boolean(error)} onClick={() => void confirmCrop()} type="button">{processing ? "处理中..." : index + 1 < files.length ? "裁剪并处理下一张" : "确认使用"}</button>
        </div>
      </div>
    </div>
  );
}
