export type RelatedProductCandidate = {
  sku: string;
  category: string;
  subcategory?: string | null;
};

type CurrentProductIdentity = {
  sku: string;
  category: string;
  subcategory?: string | null;
};

function normalized(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function relevance(candidate: RelatedProductCandidate, current: CurrentProductIdentity) {
  const sameCategory = normalized(candidate.category) === normalized(current.category);
  const currentSubcategory = normalized(current.subcategory);
  const sameSubcategory = sameCategory
    && currentSubcategory.length > 0
    && normalized(candidate.subcategory) === currentSubcategory;

  if (sameSubcategory) return 0;
  if (sameCategory) return 1;
  return 2;
}

export function selectRelatedProducts<T extends RelatedProductCandidate>(
  candidates: T[],
  current: CurrentProductIdentity,
  limit = 12,
) {
  const maximum = Math.max(0, Math.trunc(limit));
  const currentSku = normalized(current.sku);
  const seen = new Set<string>();

  return candidates
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => {
      const sku = normalized(candidate.sku);
      if (!sku || sku === currentSku || seen.has(sku)) return false;
      seen.add(sku);
      return true;
    })
    .sort((left, right) => {
      const relevanceDelta = relevance(left.candidate, current) - relevance(right.candidate, current);
      return relevanceDelta || left.index - right.index;
    })
    .slice(0, maximum)
    .map(({ candidate }) => candidate);
}
