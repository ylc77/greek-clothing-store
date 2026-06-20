import { AdminDashboard } from "@/components/admin-dashboard";
import { AdminToastProvider } from "@/components/admin-toast";

export const dynamic = "force-dynamic";

export default function AdminPage() {
  return (
    <AdminToastProvider>
      <AdminDashboard />
    </AdminToastProvider>
  );
}
