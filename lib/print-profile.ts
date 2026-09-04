// Browser-only display preferences. No printer discovery, SDK or credential data.
export type PrintProfile = { showStoreName: boolean; showPrice: boolean; offsetX: number; offsetY: number };
export const defaultPrintProfile: PrintProfile = { showStoreName: true, showPrice: true, offsetX: 0, offsetY: 0 };
export const printProfileStorageKey = "clothing.label-print-profile.v1";

export function normalizePrintProfile(value: unknown): PrintProfile {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const offset = (value: unknown) => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 3
    ? Math.round(value * 10) / 10 : 0;
  return {
    showStoreName: typeof input.showStoreName === "boolean" ? input.showStoreName : true,
    showPrice: typeof input.showPrice === "boolean" ? input.showPrice : true,
    offsetX: offset(input.offsetX), offsetY: offset(input.offsetY),
  };
}
