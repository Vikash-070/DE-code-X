"use client";

import { implementationRoadmap } from "@decode-x/ai-orchestrator";
import { FileCode2, Github, GitPullRequestArrow, ListChecks, Terminal } from "lucide-react";

import { PageHeading } from "@/components/dashboard/page-heading";
import { Panel } from "@/components/dashboard/panel";
import { Button } from "@/components/ui/button";
import { useActiveRepository } from "@/contexts/repository-context";

export function ImplementationPlanPage() {
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
        eyebrow="Implementation plan"
        title="Roadmaps, affected files, recommendations, and generated Codex prompts."
        description="Transform implementation intelligence into scoped execution context with architecture constraints and review-ready outputs."
        action={<Button variant="forest">Send to MCP</Button>}
      />
      <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <Panel title="Roadmap">
          <div className="space-y-4">
            {implementationRoadmap.map((step, index) => (
              <div key={step.title} className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
                <p className="text-xs uppercase tracking-[0.22em] text-emerald-300/70">Step 0{index + 1}</p>
                <h3 className="mt-3 font-semibold text-white">{step.title}</h3>
                <p className="mt-3 text-sm leading-6 text-zinc-400">{step.detail}</p>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Generated Codex Prompt">
          <div className="rounded-3xl border border-emerald-200/15 bg-forest-950/70 p-5 font-mono text-sm leading-7 text-emerald-50">
            Implement realtime collaboration using the existing socket service. Preserve auth middleware ownership. Add tests for reconnect, permissions, optimistic state rollback, and server validation. Do not introduce client-owned authorization logic.
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            {[
              ["Affected files", FileCode2, "8 files"],
              ["Dependency changes", ListChecks, "2 packages"],
              ["MCP workflow", GitPullRequestArrow, "Ready"]
            ].map(([label, Icon, value]) => (
              <div key={label as string} className="rounded-2xl border border-white/10 bg-black/35 p-4">
                <Icon className="mb-5 h-5 w-5 text-emerald-200" />
                <p className="text-sm text-zinc-500">{label as string}</p>
                <p className="mt-2 text-xl font-semibold text-white">{value as string}</p>
              </div>
            ))}
          </div>
          <div className="mt-5 rounded-2xl border border-white/10 bg-black/45 p-4 font-mono text-xs leading-6 text-zinc-400">
            <Terminal className="mb-4 h-4 w-4 text-emerald-200" />
            payload.validate() · graph.attach() · codex.context.sync()
          </div>
        </Panel>
      </div>
    </div>
  );
}
