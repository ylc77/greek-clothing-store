export type ScannerOptions = { minLength?: number; maxGapMs?: number; maxLength?: number };

/** Keyboard-wedge recognizer; slow typing remains normal text input. */
export function createBarcodeScanner({ minLength = 3, maxGapMs = 60, maxLength = 128 }: ScannerOptions = {}) {
  let buffer = "";
  let last = 0;
  let slow = false;
  const reset = () => { buffer = ""; last = 0; slow = false; };
  return {
    reset,
    push(key: string, time: number): string | null {
      if (key === "Enter") {
        const value = !slow && time - last <= maxGapMs && buffer.length >= minLength ? buffer : null;
        reset();
        return value;
      }
      if (key.length !== 1) { if (key !== "Shift") reset(); return null; }
      if (buffer && time - last > maxGapMs) slow = true;
      if (buffer.length >= maxLength) slow = true;
      if (buffer.length < maxLength) buffer += key;
      last = time;
      return null;
    },
  };
}
