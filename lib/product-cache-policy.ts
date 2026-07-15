export const PRODUCT_CACHE_INVALIDATION_WARNING = {
  code: "PRODUCT_CACHE_INVALIDATION_FAILED" as const,
  message: "商品已保存，但页面缓存刷新失败，请刷新页面核对最新数据。",
};

export type CommittedProductMutationOutcome<T> = {
  committed: true;
  value: T;
  cacheWarning: typeof PRODUCT_CACHE_INVALIDATION_WARNING | null;
};

/**
 * Cache invalidation runs after the database transaction has committed. Its
 * failure must not turn a successful write into an apparent write failure,
 * because retrying that apparent failure could duplicate the business action.
 */
export async function finalizeCommittedProductMutation<T>(
  value: T,
  invalidateCache: () => void | Promise<void>,
): Promise<CommittedProductMutationOutcome<T>> {
  try {
    await invalidateCache();
    return { committed: true, value, cacheWarning: null };
  } catch {
    return {
      committed: true,
      value,
      cacheWarning: { ...PRODUCT_CACHE_INVALIDATION_WARNING },
    };
  }
}
