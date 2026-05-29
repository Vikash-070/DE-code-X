/**
 * Architecture Workspace page.
 *
 * Feature flag: NEXT_PUBLIC_FEATURE_ARCHITECTURE_WORKSPACE
 *   "true"  → full two-panel workspace (tree + intelligence panel)
 *   absent  → same (enabled by default in production)
 *   "false" → shows a "coming soon" placeholder (safe rollback)
 *
 * The flag allows gradual rollout or emergency rollback without a code deploy.
 * Set it in Vercel environment variables or .env.local.
 */

import { ArchitectureWorkspacePage } from "@/features/architecture/architecture-workspace-page";

const FEATURE_ENABLED =
  process.env.NEXT_PUBLIC_FEATURE_ARCHITECTURE_WORKSPACE !== "false";

export default function ArchitecturePage() {
  if (!FEATURE_ENABLED) {
    return (
      <div className="flex flex-col items-center gap-4 py-24 text-center">
        <p className="text-sm font-medium text-zinc-400">Architecture Workspace</p>
        <p className="text-xs text-zinc-600">Coming soon — multi-module intelligence panel.</p>
      </div>
    );
  }

  return <ArchitectureWorkspacePage />;
}
