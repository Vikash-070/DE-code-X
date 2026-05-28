"use client";

import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { Github, GitBranch, Network, ScanLine, ShieldCheck } from "lucide-react";
import { motion } from "framer-motion";

import { AmbientBackground } from "@/components/primitives/ambient-background";
import { RepositoryGraph } from "@/components/primitives/repository-graph";
import { Button } from "@/components/ui/button";
import { useGitHubIntelligence } from "@/hooks/use-github-intelligence";

export function GithubConnectPage() {
  const { user, isLoaded } = useUser();
  const { data, isLoading } = useGitHubIntelligence();
  const hasGitHub = Boolean(user?.externalAccounts.some((account) => account.provider === "github"));
  const isConnected = hasGitHub && !data?.connectionRequired;

  async function connectGitHub() {
    if (!isLoaded || !user) return;
    const account = await user.createExternalAccount({
      strategy: "oauth_github",
      redirectUrl: `${window.location.origin}/workspace`,
      additionalScopes: ["repo", "read:user", "read:org", "workflow"]
    });
    const oauthUrl = account.verification?.externalVerificationRedirectURL;
    if (oauthUrl) {
      window.location.assign(oauthUrl.href);
    }
  }

  return (
    <main className="relative min-h-screen bg-black px-5 py-10 text-white sm:px-8">
      <AmbientBackground />
      <div className="mx-auto max-w-6xl">
        <Link href="/" className="flex items-center gap-3">
          <Network className="h-5 w-5 text-emerald-200" />
          <span className="text-sm font-semibold tracking-[0.22em]">DE-code X</span>
        </Link>
        <div className="grid min-h-[calc(100vh-6rem)] items-center gap-10 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-emerald-300/70">GitHub onboarding</p>
            <h1 className="mt-5 text-5xl font-semibold tracking-[-0.05em] sm:text-7xl">Connect the repository graph.</h1>
            <p className="mt-6 text-lg leading-8 text-zinc-400">
              Authorize GitHub through Clerk OAuth. DE-code X will sync repositories, branches, pull requests, Actions, deployments, and contributor intelligence from the backend only.
            </p>
            <div className="mt-10 flex flex-col gap-3 sm:flex-row">
              {isConnected ? (
                <Button asChild>
                  <Link href="/dashboard"><Github className="h-4 w-4" /> Enter Workspace</Link>
                </Button>
              ) : (
                <Button onClick={connectGitHub} disabled={!isLoaded} variant="forest">
                  <Github className="h-4 w-4" /> Connect GitHub
                </Button>
              )}
              <Button asChild variant="ghost">
                <Link href="/dashboard">View Workspace</Link>
              </Button>
            </div>
            <div className="mt-8 rounded-3xl border border-emerald-200/15 bg-forest-700/15 p-5 text-sm leading-6 text-zinc-300">
              {isLoading
                ? "Checking OAuth connection and preparing repository synchronization."
                : isConnected
                  ? `${data?.metrics.totalRepositories ?? 0} repositories available for architecture intelligence.`
                  : "GitHub OAuth is required before repository intelligence can use live data."}
            </div>
          </div>
          <div className="premium-border glass rounded-[32px] p-3">
            <RepositoryGraph className="min-h-[520px]" />
            <div className="grid gap-3 p-3 sm:grid-cols-3">
              {[
                ["Repository synchronization", GitBranch],
                ["Architecture scanning", ScanLine],
                ["AI risk validation", ShieldCheck]
              ].map(([label, Icon], index) => (
                <motion.div key={label as string} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.16 }} className="rounded-2xl border border-white/10 bg-black/45 p-4 text-sm text-zinc-300">
                  <Icon className="mb-4 h-5 w-5 text-emerald-200" />
                  {label as string}
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
