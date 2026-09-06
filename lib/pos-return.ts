export type ReturnCondition = "resellable" | "damaged" | "quarantine";

export type PosReturnItemInput = {
  orderItemId: string;
  quantity: number;
  condition: ReturnCondition;
};

export type PosExchangeItemInput = {
  variantId: string;
  quantity: number;
};

export type PosReturnExchangeInput = {
  clientRequestId: string;
  returnItems: PosReturnItemInput[];
  exchangeItems: PosExchangeItemInput[];
  reason: string;
  externalConfirmation: {
    confirmed: boolean;
    method: "cash" | "card" | "other" | "";
    reference: string;
    expectedBalanceDelta: number;
  };
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function clean(value: unknown, max: number) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 1_000_000 ? parsed : 0;
}

function isCondition(value: unknown): value is ReturnCondition {
  return value === "resellable" || value === "damaged" || value === "quarantine";
}

export function parsePosReturnExchangeInput(value: unknown): PosReturnExchangeInput {
  if (!value || typeof value !== "object") throw new Error("请求内容无效。");
  const source = value as Record<string, unknown>;
  const clientRequestId = clean(source.clientRequestId, 160);
  const reason = clean(source.reason, 500);
  if (!clientRequestId) throw new Error("clientRequestId is required.");
  if (reason.length < 3) throw new Error("退货原因至少填写 3 个字符。");

  if (!Array.isArray(source.returnItems) || source.returnItems.length === 0 || source.returnItems.length > 100) {
    throw new Error("请选择 1 至 100 条原订单商品。");
  }
  if (!Array.isArray(source.exchangeItems) || source.exchangeItems.length > 100) {
    throw new Error("换出商品最多 100 个规格。");
  }

  const returns = new Map<string, PosReturnItemInput>();
  for (const raw of source.returnItems) {
    if (!raw || typeof raw !== "object") throw new Error("退入商品格式无效。");
    const item = raw as Record<string, unknown>;
    const orderItemId = clean(item.orderItemId, 64);
    const quantity = positiveInteger(item.quantity);
    if (!uuidPattern.test(orderItemId) || !quantity || !isCondition(item.condition)) {
      throw new Error("退入商品必须包含有效的订单明细、数量和商品状态。");
    }
    const existing = returns.get(orderItemId);
    if (existing && existing.condition !== item.condition) throw new Error("同一订单明细不能选择不同商品状态。");
    returns.set(orderItemId, { orderItemId, quantity: (existing?.quantity || 0) + quantity, condition: item.condition });
  }

  const exchanges = new Map<string, PosExchangeItemInput>();
  for (const raw of source.exchangeItems) {
    if (!raw || typeof raw !== "object") throw new Error("换出商品格式无效。");
    const item = raw as Record<string, unknown>;
    const variantId = clean(item.variantId, 64);
    const quantity = positiveInteger(item.quantity);
    if (!uuidPattern.test(variantId) || !quantity) throw new Error("换出商品必须包含有效的规格和数量。");
    exchanges.set(variantId, { variantId, quantity: (exchanges.get(variantId)?.quantity || 0) + quantity });
  }

  const external = source.externalConfirmation && typeof source.externalConfirmation === "object"
    ? source.externalConfirmation as Record<string, unknown>
    : {};
  const expectedBalanceDelta = Number(external.expectedBalanceDelta);
  if (!Number.isFinite(expectedBalanceDelta)) throw new Error("应补或应退金额无效。");
  const method = external.method === "cash" || external.method === "card" || external.method === "other" ? external.method : "";

  return {
    clientRequestId,
    reason,
    returnItems: [...returns.values()].sort((a, b) => a.orderItemId.localeCompare(b.orderItemId)),
    exchangeItems: [...exchanges.values()].sort((a, b) => a.variantId.localeCompare(b.variantId)),
    externalConfirmation: {
      confirmed: external.confirmed === true,
      method,
      reference: clean(external.reference, 200),
      expectedBalanceDelta: Math.round(expectedBalanceDelta * 100) / 100,
    },
  };
}

export function posReturnRequestFingerprint(input: Omit<PosReturnExchangeInput, "clientRequestId">) {
  return JSON.stringify({
    ...input,
    returnItems: [...input.returnItems].sort((a, b) => a.orderItemId.localeCompare(b.orderItemId)),
    exchangeItems: [...input.exchangeItems].sort((a, b) => a.variantId.localeCompare(b.variantId)),
  });
}

export function calculateReturnExchangeAmounts(
  returnLines: Array<{ lineTotal: number; soldQuantity: number; previousQuantity: number; previousAmount: number; quantity: number }>,
  exchangeLines: Array<{ unitPrice: number; quantity: number }>,
) {
  const returnSubtotal = returnLines.reduce((sum, line) => {
    const amount = line.previousQuantity + line.quantity === line.soldQuantity
      ? line.lineTotal - line.previousAmount
      : (line.lineTotal / line.soldQuantity) * line.quantity;
    return sum + Math.round(amount * 100) / 100;
  }, 0);
  const exchangeSubtotal = exchangeLines.reduce((sum, line) => sum + Math.round(line.unitPrice * line.quantity * 100) / 100, 0);
  const roundedReturn = Math.round(returnSubtotal * 100) / 100;
  const roundedExchange = Math.round(exchangeSubtotal * 100) / 100;
  return {
    returnSubtotal: roundedReturn,
    exchangeSubtotal: roundedExchange,
    balanceDelta: Math.round((roundedExchange - roundedReturn) * 100) / 100,
  };
}
