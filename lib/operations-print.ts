export const ATHENS_TIME_ZONE = "Europe/Athens";

export type PrintLanguage = "el" | "en";

export type LocalizedPrintName = {
  name?: string | null;
  name_en?: string | null;
  name_gr?: string | null;
  product_sku?: string | null;
  variant_sku?: string | null;
};

const printCopy = {
  el: {
    receiptTitle: "Απόδειξη πώλησης",
    order: "Παραγγελία",
    date: "Ημερομηνία",
    cashier: "Χειριστής",
    payment: "Πληρωμή",
    status: "Κατάσταση",
    subtotal: "Υποσύνολο",
    discount: "Έκπτωση",
    total: "Σύνολο",
    notes: "Σημειώσεις",
    thanks: "Ευχαριστούμε",
    help: "Για επιστροφή ή βοήθεια, επικοινωνήστε με το κατάστημα.",
    notTaxInvoice: "Το παρόν είναι καταγραφή πώλησης του συστήματος και όχι φορολογική απόδειξη ή τιμολόγιο.",
    voided: "ΑΚΥΡΩΜΕΝΟ",
    size: "Μέγεθος",
    color: "Χρώμα",
  },
  en: {
    receiptTitle: "Sales receipt",
    order: "Order",
    date: "Date",
    cashier: "Operator",
    payment: "Payment",
    status: "Status",
    subtotal: "Subtotal",
    discount: "Discount",
    total: "Total",
    notes: "Notes",
    thanks: "Thank you",
    help: "For a return or help, contact the store.",
    notTaxInvoice: "This is a system sales record, not a tax receipt or tax invoice.",
    voided: "VOIDED",
    size: "Size",
    color: "Color",
  },
} as const;

export function localizedPrintCopy(language: PrintLanguage) {
  return printCopy[language];
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function localizedPrintProductName(value: LocalizedPrintName, language: PrintLanguage) {
  const localized = language === "el" ? clean(value.name_gr) : clean(value.name_en);
  const secondary = language === "el" ? clean(value.name_en) : clean(value.name_gr);
  return localized || secondary || clean(value.product_sku) || clean(value.variant_sku) || "-";
}

export function normalizeLabelCopies(value: unknown, stockFallback: unknown) {
  const requested = Number(value);
  const fallback = Number(stockFallback);
  const selected = Number.isFinite(requested)
    ? Math.trunc(requested)
    : Number.isFinite(fallback)
      ? Math.trunc(fallback)
      : 1;
  return Math.min(500, Math.max(1, selected));
}

export function formatAthensDateTime(value: string | Date | null | undefined, language: PrintLanguage) {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const parts = new Intl.DateTimeFormat(language === "el" ? "el-GR" : "en-GB", {
    timeZone: ATHENS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get("day")}/${byType.get("month")}/${byType.get("year")}, ${byType.get("hour")}:${byType.get("minute")}`;
}

export function formatAthensBusinessDate(value: string | Date = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ATHENS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`;
}

export function formatEuroForPrint(value: unknown, language: PrintLanguage) {
  const amount = Number(value);
  return new Intl.NumberFormat(language === "el" ? "el-GR" : "en-GB", {
    style: "currency",
    currency: "EUR",
  }).format(Number.isFinite(amount) ? amount : 0);
}
