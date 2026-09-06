import { CheckoutReturnClient } from "@/components/checkout-return-client";
import { getLanguage } from "@/lib/i18n";

export default async function CheckoutSuccessPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <CheckoutReturnClient language={getLanguage((await searchParams).lang)} />;
}
