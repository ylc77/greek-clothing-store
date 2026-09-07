import { CheckoutReturnClient } from "@/components/checkout-return-client";
import { getLanguage } from "@/lib/i18n";

export default async function CheckoutFailurePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <CheckoutReturnClient failed language={getLanguage((await searchParams).lang)} />;
}
