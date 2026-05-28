import { DashboardShell } from "@/features/dashboard/dashboard-shell";

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return <DashboardShell>{children}</DashboardShell>;
}
