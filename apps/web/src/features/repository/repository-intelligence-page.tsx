"use client";

import { repositoryInsights } from "@decode-x/repo-intelligence";
import { Boxes, GitBranch, Github, Network, Route, Workflow } from "lucide-react";

import { PageHeading } from "@/components/dashboard/page-heading";
import { MetricCard } from "@/components/dashboard/metric-card";
import { Panel } from "@/components/dashboard/panel";
import { RepositoryGraph } from "@/components/primitives/repository-graph";
import { useActiveRepository } from "@/contexts/repository-context";

export function RepositoryIntelligencePage() {
  const { activeRepository } = useActiveRepository();
  const [owner, repoName] = activeRepository ? activeRepository.fullName.split("/") : [];

  return (
    <div className="space-y-8">
      {activeRepository && (
        <div className="flex items-center gap-2 self-start rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-zinc-400">
          <Github className="h-3 w-3 text-zinc-500" />
          <span className="text-zinc-500">{owner}/</span>
          <span className="text-zinc-300">{repoName}</span>
        </div>
      )}
      <PageHeading
        eyebrow="Repository intelligence"
        title="AI that understands your architecture."
        description="Animated dependency graphs, API relationships, state management analysis, and service connection diagrams for implementation planning."
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Network} title="Service edges" value="438" detail="Cross-service relationships mapped" />
        <MetricCard icon={Route} title="API routes" value="126" detail="Handlers and contracts connected" />
        <MetricCard icon={Boxes} title="State surfaces" value="18" detail="Redux, cache, and optimistic flows" />
        <MetricCard icon={GitBranch} title="Impact depth" value="3.8" detail="Average dependency radius" />
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <Panel title="Architecture Map">
          <RepositoryGraph className="min-h-[560px]" />
        </Panel>
        <Panel title="Floating Insights">
          <div className="space-y-4">
            {repositoryInsights.map((insight) => (
              <div key={insight.label} className="rounded-2xl border border-emerald-200/15 bg-forest-700/15 p-5">
                <Workflow className="mb-5 h-5 w-5 text-emerald-200" />
                <p className="font-medium text-white">{insight.label}</p>
                <p className="mt-2 text-sm text-zinc-500">{Math.round(insight.confidence * 100)}% confidence · {insight.signal}</p>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
