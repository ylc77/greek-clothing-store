import { AdminDashboard } from "@/components/admin-dashboard";
import { AdminToastProvider } from "@/components/admin-toast";
import { getFeatureSettings } from "@/lib/features";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const featureSettings = await getFeatureSettings();
  return (
    <AdminToastProvider>
      <AdminDashboard initialFeatures={featureSettings.features} />
    </AdminToastProvider>
  );
}
