export type SupabasePageError = {
  message?: string;
};

export type SupabasePageResult<T> = {
  data: T[] | null;
  error: SupabasePageError | null;
};

const DEFAULT_PAGE_SIZE = 1_000;
const MAX_PAGE_COUNT = 10_000;

export async function fetchAllSupabaseRows<T>(
  fetchPage: (from: number, to: number) => Promise<SupabasePageResult<T>>,
  pageSize = DEFAULT_PAGE_SIZE,
): Promise<SupabasePageResult<T>> {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > DEFAULT_PAGE_SIZE) {
    throw new RangeError(`pageSize must be an integer between 1 and ${DEFAULT_PAGE_SIZE}`);
  }

  const rows: T[] = [];
  for (let page = 0; page < MAX_PAGE_COUNT; page += 1) {
    const from = page * pageSize;
    const result = await fetchPage(from, from + pageSize - 1);
    if (result.error) return { data: null, error: result.error };

    const pageRows = result.data || [];
    rows.push(...pageRows);
    if (pageRows.length < pageSize) return { data: rows, error: null };
  }

  return {
    data: null,
    error: { message: "Supabase pagination exceeded the safety page limit." },
  };
}
