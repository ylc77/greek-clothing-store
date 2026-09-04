export type QueueLabel = {
  variant_id: string; barcode: string | null; product_name: string; product_sku: string;
  variant_sku: string; size: string | null; color: string | null; price: number;
  quantity_on_hand: number; active: boolean;
};
export type LabelQueueEntry = { label: QueueLabel; copies: number; sources: string[] };
export type LabelQueueState = { entries: LabelQueueEntry[]; operations: string[] };
export const emptyLabelQueue = (): LabelQueueState => ({ entries: [], operations: [] });
export type LabelQueueAction =
  | { type: "enqueue"; operationId: string; source: string; labels: { label: QueueLabel; copies: number }[] }
  | { type: "copies"; variantId: string; copies: number }
  | { type: "remove"; variantId: string }
  | { type: "clear" }
  | { type: "reset" };

export function operationLabelQueue(state: LabelQueueState, action: LabelQueueAction): LabelQueueState {
  if (action.type === "reset") return emptyLabelQueue();
  // Clearing printed labels must not forget which committed operations were already queued.
  if (action.type === "clear") return { ...state, entries: [] };
  if (action.type === "remove") return { ...state, entries: state.entries.filter(e => e.label.variant_id !== action.variantId) };
  if (action.type === "copies") {
    if (!Number.isSafeInteger(action.copies) || action.copies < 1 || action.copies > 1000000) return state;
    return { ...state, entries: state.entries.map(e => e.label.variant_id === action.variantId ? { ...e, copies: action.copies } : e) };
  }
  if (!action.operationId || state.operations.includes(action.operationId)) return state;
  if (action.labels.some(e => !e.label.variant_id || !e.label.barcode?.trim() || !Number.isSafeInteger(e.copies) || e.copies < 1 || e.copies > 1000000)) return state;
  const entries = state.entries.map(e => ({ ...e, sources: [...e.sources] }));
  for (const incoming of action.labels) {
    const existing = entries.find(e => e.label.variant_id === incoming.label.variant_id);
    if (existing) {
      if (!Number.isSafeInteger(existing.copies + incoming.copies)) return state;
      existing.copies += incoming.copies;
      existing.label = incoming.label;
      if (!existing.sources.includes(action.source)) existing.sources.push(action.source);
    } else entries.push({ ...incoming, sources: [action.source] });
  }
  return { entries, operations: [...state.operations, action.operationId] };
}
