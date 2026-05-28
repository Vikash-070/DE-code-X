"use client";

import { mcpPayloads } from "@decode-x/mcp";
import { Bot, CheckCircle2, Cpu, Github, Send, Terminal, Workflow } from "lucide-react";
import { motion } from "framer-motion";

import { PageHeading } from "@/components/dashboard/page-heading";
import { MetricCard } from "@/components/dashboard/metric-card";
import { Panel } from "@/components/dashboard/panel";
import { Button } from "@/components/ui/button";
import { useActiveRepository } from "@/contexts/repository-context";

export function McpExecutionPage() {
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
        eyebrow="MCP execution"
        title="Structured implementation payloads for Codex and Claude."
        description="A cinematic orchestration interface for approvals, sync indicators, execution status, and model handoff workflows."
        action={<Button variant="forest"><Send className="h-4 w-4" /> Execute</Button>}
      />
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard icon={Bot} title="Codex integration" value="Ready" detail="Context bundle awaiting approval" />
        <MetricCard icon={Cpu} title="Claude integration" value="Queued" detail="Architecture notes attached" />
        <MetricCard icon={Workflow} title="Approval workflow" value="2/3" detail="Security gate is complete" />
      </div>
      <Panel title="Execution Orchestration">
        <div className="grid gap-5 lg:grid-cols-2">
          {mcpPayloads.map((payload, index) => (
            <motion.div key={payload.target} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.12 }} className="rounded-3xl border border-white/10 bg-black/45 p-6">
              <Terminal className="h-5 w-5 text-emerald-200" />
              <h3 className="mt-8 text-2xl font-semibold capitalize tracking-[-0.03em]">{payload.target}</h3>
              <p className="mt-2 text-sm text-zinc-500">{payload.payloadSize} structured implementation payload</p>
              <div className="mt-8 rounded-2xl border border-emerald-200/15 bg-forest-700/15 p-4 font-mono text-xs leading-6 text-emerald-50">
                repositoryGraph.attach()
                <br />
                securityFindings.include()
                <br />
                implementationPlan.transfer()
              </div>
              <div className="mt-5 flex items-center gap-2 text-sm text-zinc-300">
                <CheckCircle2 className="h-4 w-4 text-emerald-200" />
                Status: {payload.status}
              </div>
            </motion.div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
