"use client";

import { useEffect, useRef, type RefObject } from "react";
import { createBarcodeScanner, type ScannerOptions } from "@/lib/barcode-scanner";

export function useBarcodeScanner({ active, inputRef, onScan, minLength = 3, maxGapMs = 60 }: ScannerOptions & {
  active: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onScan: (barcode: string, signal: AbortSignal) => void | Promise<void>;
}) {
  const callback = useRef(onScan);
  callback.current = onScan;
  useEffect(() => {
    const input = inputRef.current;
    if (!active || !input) return;
    const scanner = createBarcodeScanner({ minLength, maxGapMs });
    let live = true;
    const controller = new AbortController();
    let pending = Promise.resolve();
    const reset = () => scanner.reset();
    const handler = (event: KeyboardEvent) => {
      if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.repeat) { reset(); return; }
      const code = scanner.push(event.key, event.timeStamp);
      if (!code) return;
      event.preventDefault(); // Prevent the enclosing search form from submitting a second time.
      pending = pending.then(async () => {
        if (!live) return;
        try { await callback.current(code, controller.signal); }
        finally { if (live) input.focus({ preventScroll: true }); }
      }).catch(() => { /* Caller owns user-visible errors; keep later scans usable. */ });
    };
    input.focus({ preventScroll: true });
    input.addEventListener("keydown", handler);
    input.addEventListener("blur", reset);
    return () => { live = false; controller.abort(); input.removeEventListener("keydown", handler); input.removeEventListener("blur", reset); };
  }, [active, inputRef, minLength, maxGapMs]);
}
