"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { ProductCard } from "@/components/product-card";
import {
  categoryProductFilterOptions,
  filterAndSortCategoryProducts,
  type CategoryPriceFilter,
  type CategorySort,
} from "@/lib/category-product-filters";
import type { Language } from "@/lib/i18n";
import type { Product } from "@/lib/types";

const copy = {
  el: {
    allBrands: "Όλες οι μάρκες",
    allColors: "Όλα τα χρώματα",
    allPrices: "Όλες οι τιμές",
    allSizes: "Όλα τα μεγέθη",
    brand: "Μάρκα",
    clear: "Καθαρισμός",
    color: "Χρώμα",
    current: "Στην τρέχουσα σελίδα",
    empty: "Δεν υπάρχουν προϊόντα με αυτά τα φίλτρα.",
    filters: "Φίλτρα",
    newest: "Νεότερα πρώτα",
    price: "Τιμή",
    priceAsc: "Τιμή: χαμηλή προς υψηλή",
    priceDesc: "Τιμή: υψηλή προς χαμηλή",
    products: "προϊόντα",
    size: "Μέγεθος",
    sort: "Ταξινόμηση",
    sortName: "Όνομα Α–Ω",
    under25: "Κάτω από €25",
    between25And50: "€25–€50",
    over50: "Πάνω από €50",
  },
  en: {
    allBrands: "All brands",
    allColors: "All colors",
    allPrices: "All prices",
    allSizes: "All sizes",
    brand: "Brand",
    clear: "Clear filters",
    color: "Color",
    current: "On this page",
    empty: "No products match these filters.",
    filters: "Filters",
    newest: "Newest first",
    price: "Price",
    priceAsc: "Price: low to high",
    priceDesc: "Price: high to low",
    products: "products",
    size: "Size",
    sort: "Sort",
    sortName: "Name A–Z",
    under25: "Under €25",
    between25And50: "€25–€50",
    over50: "Over €50",
  },
} as const;

const initialFilters = {
  brand: "",
  color: "",
  price: "all" as CategoryPriceFilter,
  sizes: [] as string[],
  sort: "newest" as CategorySort,
};

function FilterMenu({ label, activeCount = 0, children }: { label: string; activeCount?: number; children: ReactNode }) {
  return (
    <details className="group static sm:relative" name="catalog-filter">
      <summary className={`flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-full border px-4 py-2 text-sm font-black shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terracotta/30 [&::-webkit-details-marker]:hidden ${activeCount > 0 ? "border-[#dcae9d] bg-[#fff1eb] text-[#8f3f28]" : "border-stone-200 bg-white text-ink hover:border-stone-300 hover:shadow"}`}>
        {label}{activeCount > 0 ? ` (${activeCount})` : ""}
        <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0 transition-transform duration-200 group-open:rotate-180" strokeWidth={2.25} />
      </summary>
      <div className="absolute left-3 right-3 top-[4.4rem] z-30 w-auto rounded-2xl border border-stone-200 bg-white p-4 shadow-xl shadow-stone-900/15 sm:left-0 sm:right-auto sm:top-[calc(100%+0.5rem)] sm:w-[min(31rem,calc(100vw-2rem))] sm:p-5">
        {children}
      </div>
    </details>
  );
}

function ChoiceButton({
  active,
  count,
  label,
  onClick,
  closeMenuOnSelect = false,
}: {
  active: boolean;
  count?: number;
  label: string;
  onClick: () => void;
  closeMenuOnSelect?: boolean;
}) {
  return (
    <button
      aria-pressed={active}
      className={`min-h-9 rounded-lg border px-3 py-1.5 text-sm font-bold transition ${active ? "border-ink bg-ink text-white" : "border-stone-200 bg-white text-ink hover:border-stone-400"}`}
      onClick={(event) => {
        onClick();
        if (closeMenuOnSelect) {
          event.currentTarget.closest("details")?.removeAttribute("open");
        }
      }}
      type="button"
    >
      {label}
      {typeof count === "number" ? <span className={active ? "text-white/75" : "text-stone-400"}> ({count})</span> : null}
    </button>
  );
}

export function CategoryProductGrid({ products, language }: { products: Product[]; language: Language }) {
  const t = copy[language];
  const [filters, setFilters] = useState(initialFilters);
  const options = useMemo(() => categoryProductFilterOptions(products), [products]);
  const visibleProducts = useMemo(
    () => filterAndSortCategoryProducts(products, filters, language),
    [filters, language, products],
  );
  const priceOptions = useMemo(() => [
    { value: "under-25" as const, label: t.under25, count: products.filter((product) => Number(product.price) < 25).length },
    { value: "25-50" as const, label: t.between25And50, count: products.filter((product) => Number(product.price) >= 25 && Number(product.price) <= 50).length },
    { value: "over-50" as const, label: t.over50, count: products.filter((product) => Number(product.price) > 50).length },
  ], [products, t.between25And50, t.over50, t.under25]);
  const sortOptions = [
    { value: "newest" as const, label: t.newest },
    { value: "price-asc" as const, label: t.priceAsc },
    { value: "price-desc" as const, label: t.priceDesc },
    { value: "name" as const, label: t.sortName },
  ];
  const selectedSortLabel = sortOptions.find((option) => option.value === filters.sort)?.label || t.newest;
  const hasFilters = filters.brand || filters.color || filters.price !== "all" || filters.sizes.length > 0;

  return (
    <>
      <div className="relative mb-5 rounded-2xl border border-stone-200/80 bg-[#f6f2ec] p-3 sm:p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-stone-600">{t.filters}</p>
            {hasFilters ? (
              <span className="rounded-full bg-terracotta px-2 py-0.5 text-[10px] font-black text-white">
                {filters.sizes.length + (filters.color ? 1 : 0) + (filters.brand ? 1 : 0) + (filters.price === "all" ? 0 : 1)}
              </span>
            ) : null}
          </div>
          <p aria-live="polite" className="shrink-0 text-xs font-bold text-stone-500 sm:text-sm">
            <span className="hidden sm:inline">{t.current}: </span><span className="text-ink">{visibleProducts.length} {t.products}</span>
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap gap-2">
            {options.sizes.length > 1 ? (
              <FilterMenu activeCount={filters.sizes.length} label={t.size}>
                <div className="flex flex-wrap gap-2">
                  {options.sizes.map((size) => {
                    const active = filters.sizes.includes(size.value);
                    return (
                      <ChoiceButton
                        active={active}
                        count={size.count}
                        key={size.value}
                        label={size.value}
                        onClick={() => setFilters((current) => ({
                          ...current,
                          sizes: active ? current.sizes.filter((value) => value !== size.value) : [...current.sizes, size.value],
                        }))}
                      />
                    );
                  })}
                </div>
              </FilterMenu>
            ) : null}
            {options.colors.length > 1 ? (
              <FilterMenu activeCount={filters.color ? 1 : 0} label={t.color}>
                <div className="flex flex-wrap gap-2">
                  {options.colors.map((color) => (
                    <ChoiceButton active={filters.color === color.value} count={color.count} key={color.value} label={color.value} onClick={() => setFilters((current) => ({ ...current, color: current.color === color.value ? "" : color.value }))} />
                  ))}
                </div>
              </FilterMenu>
            ) : null}
            {options.brands.length > 1 ? (
              <FilterMenu activeCount={filters.brand ? 1 : 0} label={t.brand}>
                <div className="flex flex-wrap gap-2">
                  {options.brands.map((brand) => (
                    <ChoiceButton active={filters.brand === brand.value} count={brand.count} key={brand.value} label={brand.value} onClick={() => setFilters((current) => ({ ...current, brand: current.brand === brand.value ? "" : brand.value }))} />
                  ))}
                </div>
              </FilterMenu>
            ) : null}
            <FilterMenu activeCount={filters.price === "all" ? 0 : 1} label={t.price}>
              <div className="grid gap-2 sm:grid-cols-2">
                {priceOptions.map((option) => (
                  <ChoiceButton active={filters.price === option.value} count={option.count} key={option.value} label={option.label} onClick={() => setFilters((current) => ({ ...current, price: current.price === option.value ? "all" : option.value }))} />
                ))}
              </div>
            </FilterMenu>
            <FilterMenu label={selectedSortLabel}>
              <div aria-label={t.sort} className="grid gap-2">
                {sortOptions.map((option) => (
                  <ChoiceButton
                    active={filters.sort === option.value}
                    closeMenuOnSelect
                    key={option.value}
                    label={option.label}
                    onClick={() => setFilters((current) => ({ ...current, sort: option.value }))}
                  />
                ))}
              </div>
            </FilterMenu>
            {hasFilters ? (
              <button className="min-h-11 rounded-full border border-stone-200 bg-stone-50 px-4 py-2 text-sm font-black text-stone-700 transition hover:bg-stone-100" onClick={() => setFilters(initialFilters)} type="button">
                {t.clear}
              </button>
            ) : null}
        </div>
      </div>

      {visibleProducts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-10 text-center font-bold text-stone-500">
          {t.empty}
        </div>
      ) : (
        <div className={visibleProducts.length === 1 ? "grid max-w-sm grid-cols-1 gap-4" : "grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 sm:gap-x-4 lg:grid-cols-4 2xl:grid-cols-5"}>
          {visibleProducts.map((product) => (
            <ProductCard key={product.sku} product={product} language={language} displayMode="catalog" />
          ))}
        </div>
      )}
    </>
  );
}
