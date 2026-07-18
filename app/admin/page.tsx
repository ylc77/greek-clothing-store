import { AdminDashboard } from "@/components/admin-dashboard";
import { AdminToastProvider } from "@/components/admin-toast";
import { getFeatureSettings } from "@/lib/features";
import { getBusinessSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const [featureSettings, printSettings] = await Promise.all([
    getFeatureSettings(),
    getBusinessSettings(),
  ]);
  return (
    <AdminToastProvider>
      <AdminDashboard
        initialFeatures={featureSettings.features}
        initialFeatureSettingsConfigured={featureSettings.configured}
        initialPrintSettings={printSettings}
      />
    </AdminToastProvider>
  );
}
