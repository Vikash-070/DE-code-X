"use client";

import { securityFindings } from "@decode-x/security-engine";
import { AlertTriangle, Fingerprint, Github, LockKeyhole, ShieldCheck } from "lucide-react";
import { motion } from "framer-motion";

import { PageHeading } from "@/components/dashboard/page-heading";
import { MetricCard } from "@/components/dashboard/metric-card";
import { Panel } from "@/components/dashboard/panel";
import { useActiveRepository } from "@/contexts/repository-context";

export function SecurityValidationPage() {
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
        eyebrow="Security validation"
        title="Futuristic AI security review before implementation."
        description="Risk scores, attack surface analysis, dependency vulnerabilities, architecture conflicts, and implementation warnings with enterprise-grade visibility."
      />
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard icon={ShieldCheck} title="Risk score" value="94" detail="Validated for implementation planning" />
        <MetricCard icon={LockKeyhole} title="Attack surface" value="Low" detail="No privilege boundary expansion" />
        <MetricCard icon={Fingerprint} title="Auth drift" value="1" detail="Conflict requires review" />
      </div>
      <Panel title="Security Intelligence">
        <div className="space-y-6">
          {securityFindings.map((finding, index) => (
            <div key={finding.title}>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-zinc-300"><AlertTriangle className="h-4 w-4 text-emerald-200" />{finding.title}</span>
                <span className="text-zinc-500">{finding.score}/100</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/10">
                <motion.div initial={{ width: 0 }} whileInView={{ width: `${finding.score}%` }} viewport={{ once: true }} transition={{ delay: index * 0.12, duration: 1 }} className="h-full rounded-full bg-gradient-to-r from-forest-700 to-emerald-300" />
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
