"use client";

import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  GitBranch,
  GitCommit,
  GitMerge,
  GitPullRequest,
  Rocket,
  ShieldCheck,
  Users,
  Workflow,
  Zap
} from "lucide-react";
import { motion } from "framer-motion";

import { AnalyticsCard } from "@/components/dashboard/analytics-card";
import { PageHeading } from "@/components/dashboard/page-heading";
import { MetricCard } from "@/components/dashboard/metric-card";
import { Panel } from "@/components/dashboard/panel";
import { RepositoryGraph } from "@/components/primitives/repository-graph";
import { Button } from "@/components/ui/button";
import { useGitHubIntelligence } from "@/hooks/use-github-intelligence";

function formatEvent(type: string) {
  return type.replace(/Event$/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
}

export function ProjectsOverviewPage() {
  const { data, isLoading, error } = useGitHubIntelligence();
  const metrics = data?.metrics;
  const analytics = data?.analytics;

  return (
    <div className="space-y-8">
      <PageHeading
        eyebrow="Developer operating system"
        title="Architecture-aware command center for AI implementation work."
        description="Live GitHub repository intelligence, architecture analysis, security validation, and MCP execution readiness in one operational surface."
        action={<Button variant="forest">Analyze Tutorial</Button>}
      />
      {data?.connectionRequired ? (
        <div className="rounded-3xl border border-emerald-200/15 bg-forest-700/15 p-5 text-sm leading-6 text-zinc-300">
          Connect with GitHub through Clerk OAuth to unlock live repository intelligence. Tokens stay server-side and are never exposed to the browser.
        </div>
      ) : null}
      {error ? <div className="rounded-3xl border border-red-300/20 bg-red-500/10 p-5 text-sm text-red-100">{error}</div> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={GitBranch} title="Total repositories" value={isLoading ? "..." : String(metrics?.totalRepositories ?? 0)} detail={`${metrics?.privateRepositories ?? 0} private · ${metrics?.publicRepositories ?? 0} public`} />
        <MetricCard icon={GitCommit} title="Total commits" value={isLoading ? "..." : String(metrics?.totalCommits ?? 0)} detail={`${metrics?.pushes ?? 0} pushes observed in recent activity`} />
        <MetricCard icon={GitPullRequest} title="Pull requests" value={isLoading ? "..." : String(metrics?.pullRequests ?? 0)} detail={`${metrics?.merges ?? 0} merges across active repositories`} />
        <MetricCard icon={Rocket} title="Deployments" value={isLoading ? "..." : String(metrics?.deployments ?? 0)} detail={`${metrics?.githubActionsPassing ?? 0} passing Actions · ${metrics?.githubActionsFailing ?? 0} failing`} />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Workflow} title="Current repositories" value={isLoading ? "..." : String(metrics?.currentRepositories ?? 0)} detail="Recently pushed repositories analyzed deeply" />
        <MetricCard icon={GitMerge} title="Branch count" value={isLoading ? "..." : String(metrics?.branchCount ?? 0)} detail="Active architecture divergence surfaces" />
        <MetricCard icon={Users} title="Contributors" value={isLoading ? "..." : String(metrics?.contributorCount ?? 0)} detail="Unique contributor signals across active repos" />
        <MetricCard icon={Activity} title="MCP sync" value="Live" detail="Codex and Claude contexts ready" />
      </div>

      {analytics ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <AnalyticsCard icon={ShieldCheck} title="Repository health" value={analytics.repositoryHealth} detail="Composite health from issues, activity, and Actions." />
          <AnalyticsCard icon={BrainCircuit} title="Architecture stability" value={analytics.architectureStability} detail="Branch and boundary volatility interpreted by AI." />
          <AnalyticsCard icon={Zap} title="Implementation velocity" value={analytics.implementationVelocity} detail="Push, merge, and deployment momentum." />
          <AnalyticsCard icon={Workflow} title="Dependency activity" value={analytics.dependencyActivity} detail="Change pressure across active repositories." />
          <AnalyticsCard icon={AlertTriangle} title="AI risk indicators" value={analytics.aiRiskIndicators} detail="Lower is better for generated implementation safety." inverse />
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <Panel title="Live Repository Graph">
          <RepositoryGraph className="min-h-[470px]" />
        </Panel>
        <Panel title="Recent GitHub Activity">
          <div className="space-y-4">
            {(data?.recentActivity ?? []).map((item, index) => (
              <motion.div key={item.id} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * 0.1 }} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-sm text-zinc-300">
                <span className="mb-3 block h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_16px_rgba(110,231,183,.9)]" />
                <span className="font-medium text-white">{formatEvent(item.type)}</span>
                <span className="mt-1 block text-zinc-500">{item.repo} · {item.actor}</span>
              </motion.div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
