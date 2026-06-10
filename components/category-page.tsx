import Link from "next/link";
import { getProductsByCategory } from "@/lib/products";
import type { ProductCategory } from "@/lib/types";

export async function CategoryPage({
  category,
  title
}: {
  category: ProductCategory;
  title: string;
}) {
  const { products, error } = await getProductsByCategory(category);

  return (
    <main className="min-h-screen bg-paper px-4 py-8 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <Link className="text-sm font-bold text-stone-500" href="/">
              Back home
            </Link>
            <h1 className="mt-2 text-4xl font-bold text-ink">{title}</h1>
          </div>
        </div>

        {error ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            <strong>Products cannot load yet.</strong>
            <p className="mt-2">{error}</p>
          </div>
        ) : products.length === 0 ? (
          <div className="rounded-md border border-dashed border-stone-300 bg-white p-8 text-stone-600">
            No products in this category yet.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {products.map((product) => (
              <article className="overflow-hidden rounded-md border border-stone-200 bg-white" key={product.sku}>
                <img
                  alt={product.name_en}
                  className="aspect-[4/5] w-full object-cover"
                  src={product.image_url}
                />
                <div className="p-3">
                  <h2 className="line-clamp-2 min-h-10 text-sm font-bold text-ink">{product.name_gr}</h2>
                  <p className="mt-2 text-base font-extrabold text-terracotta">
                    EUR {Number(product.price).toFixed(2)}
                  </p>
                  <p className="mt-1 text-xs font-semibold text-stone-500">
                    {product.stock > 0 ? "In stock" : "Out of stock"}
                  </p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
