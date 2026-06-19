import Link from "next/link";
import { text } from "@/lib/i18n";
import { getBusinessSettings } from "@/lib/settings";

export default async function NotFound() {
  // Read lang from searchParams via the URL — this is a server component,
  // but not-found.tsx doesn't receive props. Fall back to "el".
  const t = text["el"];
  const settings = await getBusinessSettings().catch(() => null);
  const siteName = settings?.business_name || "Our Store";

  return (
    <html lang="el">
      <body className="min-h-screen bg-paper">
        <main className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
          <h1 className="text-8xl font-black text-stone-200">404</h1>
          <p className="mt-4 text-xl font-bold text-ink sm:text-2xl">
            Η σελίδα δεν βρέθηκε
          </p>
          <p className="mt-2 text-sm text-stone-500">
            Η σελίδα που ψάχνετε δεν υπάρχει ή έχει μετακινηθεί.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link
              className="rounded-full bg-ink px-6 py-3 text-sm font-bold text-white transition hover:bg-stone-800"
              href="/"
            >
              {t.backHome}
            </Link>
          </div>
          {siteName !== "Our Store" ? (
            <p className="mt-6 text-xs text-stone-400">{siteName}</p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
