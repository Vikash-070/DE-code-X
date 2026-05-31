"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useReverification, useUser } from "@clerk/nextjs";
import {
  Github,
  Layers,
  RefreshCw,
  X
} from "lucide-react";
import { motion } from "framer-motion";

import { Button } from "@/components/ui/button";
import { useActiveRepository } from "@/contexts/repository-context";
import { AtlasInitialization } from "@/features/workspace/atlas-initialization";
import { RepositoryOnboarding } from "@/features/workspace/repository-onboarding";
import { WorkspaceSession } from "@/features/workspace/workspace-session";
import { AgentTeamPanel, CIPHER_IDLE, NO_ACTIVITY } from "@/features/workspace/agent-activity-panel";
import type { CipherAgentState, AgentActivity } from "@/features/workspace/agent-activity-panel";
import { useGitHubIntelligence } from "@/hooks/use-github-intelligence";
import type { GitHubRepositorySummary } from "@/services/github/types";

// ─── Pre-connection state ─────────────────────────────────

function WorkspaceBootstrap() {
  const { user, isLoaded } = useUser();
  const firstName = user?.firstName ?? "engineer";

  const connectGitHub = useReverification(async () => {
    if (!isLoaded || !user) return;
    const account = await user.createExternalAccount({
      strategy:         "oauth_github",
      redirectUrl:      `${window.location.origin}/workspace`,
      additionalScopes: ["repo", "read:user", "read:org", "workflow"]
    });
    const oauthUrl = account.verification?.externalVerificationRedirectURL;
    if (oauthUrl) window.location.assign(oauthUrl.href);
  });

  return (
    <div className="flex min-h-[72vh] flex-col items-center justify-center">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="w-full max-w-md space-y-8 text-center"
      >
        <div className="flex flex-col items-center gap-5">
          <span className="grid h-14 w-14 place-items-center rounded-2xl border border-white/10 bg-white/[0.04]">
            <Layers className="h-6 w-6 text-zinc-400" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-white">
              Welcome, {firstName}.
            </h1>
            <p className="mt-3 text-sm leading-7 text-zinc-500">
              Connect your GitHub repositories to begin.<br />
              DE-code X operates in read-only intelligence mode — your code is never modified.
            </p>
          </div>
        </div>

        <Button
          variant="forest"
          className="w-full"
          onClick={connectGitHub}
          disabled={!isLoaded}
        >
          <Github className="h-4 w-4" />
          Connect GitHub
        </Button>

        <p className="text-xs text-zinc-700">
          Tokens stored server-side only. Never sent to the browser.
        </p>
      </motion.div>
    </div>
  );
}

// ─── Loading skeleton ─────────────────────────────────────

function WorkspaceLoading() {
  return (
    <div className="h-[calc(100vh-7.5rem)] animate-pulse rounded-2xl bg-white/[0.025]" />
  );
}

// ─── Scope reconnect banner ───────────────────────────────

function ScopeReconnectBanner() {
  const { user, isLoaded } = useUser();
  const [dismissed, setDismissed] = useState(false);

  const reconnect = useReverification(async () => {
    if (!isLoaded || !user) return;
    const githubAccount = user.externalAccounts.find((a) => a.provider === "github");
    let account;
    if (githubAccount) {
      account = await githubAccount.reauthorize({
        additionalScopes: ["repo", "read:user", "read:org", "workflow"],
        redirectUrl: `${window.location.origin}/workspace`
      });
    } else {
      account = await user.createExternalAccount({
        strategy:         "oauth_github",
        redirectUrl:      `${window.location.origin}/workspace`,
        additionalScopes: ["repo", "read:user", "read:org", "workflow"]
      });
    }
    const oauthUrl = account.verification?.externalVerificationRedirectURL;
    if (oauthUrl) window.location.assign(oauthUrl.href);
  });

  if (dismissed) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-4 flex items-center justify-between gap-4 rounded-2xl border border-white/[0.05] bg-white/[0.02] px-5 py-3"
    >
      <div className="flex items-center gap-3">
        <RefreshCw className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
        <p className="text-xs text-zinc-500">
          Some repositories may be missing.{" "}
          <button
            onClick={reconnect}
            disabled={!isLoaded}
            className="text-zinc-400 underline underline-offset-2 hover:text-zinc-200 disabled:opacity-50"
          >
            Reconnect GitHub
          </button>{" "}
          to grant organization access.
        </p>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-zinc-700 hover:text-zinc-400"
      >
        <X className="h-3 w-3" />
      </button>
    </motion.div>
  );
}

// ─── Page ─────────────────────────────────────────────────

export function WorkspaceHomePage() {
  const { data, isLoading } = useGitHubIntelligence();
  const { isLoaded: userLoaded } = useUser();
  const { activeRepository, hasConfirmedRepository, contextReady, confirmRepository } =
    useActiveRepository();
  const [phase, setPhase]               = useState<"idle" | "initializing">("idle");
  const [isOrchestrating, setOrch]      = useState(false);
  const [cipherState, setCipherState]   = useState<CipherAgentState>(CIPHER_IDLE);
  const [activity, setActivity]         = useState<AgentActivity>(NO_ACTIVITY);

  // Read prefill from URL (?prefill=...) — set by Architecture Workspace "Ask V#" button.
  const searchParams   = useSearchParams();
  const prefillMessage = searchParams.get("prefill")  ?? undefined;
  const sessionId      = searchParams.get("session")  ?? undefined;

  function handleRepoConfirm(repo: GitHubRepositorySummary) {
    confirmRepository(repo);
    setPhase("initializing");
  }

  if (!userLoaded || isLoading || !contextReady) return <WorkspaceLoading />;
  if (data?.connectionRequired) return <WorkspaceBootstrap />;

  if (!hasConfirmedRepository && phase !== "initializing") {
    return (
      <RepositoryOnboarding
        repositories={data?.repositories ?? []}
        githubOwner={data?.owner ?? ""}
        onConfirm={handleRepoConfirm}
      />
    );
  }

  if (phase === "initializing" && activeRepository) {
    return (
      <AtlasInitialization
        repository={activeRepository}
        onComplete={() => setPhase("idle")}
      />
    );
  }

  return (
    <>
      {data?.scopesMissing === true && <ScopeReconnectBanner />}

      {/* ── Two-column layout: chat + agent panel ─────────── */}
      <div className="flex h-[calc(100vh-7.5rem)] gap-3">

        {/* Main session */}
        <div className="min-w-0 flex-1">
          <WorkspaceSession
            onOrchestrationChange={setOrch}
            onCipherStateChange={setCipherState}
            onActivityChange={setActivity}
            prefillMessage={prefillMessage}
            sessionId={sessionId}
          />
        </div>

        {/* Agent panel — hidden on screens smaller than xl */}
        <div className="hidden w-[228px] shrink-0 xl:flex xl:flex-col">
          <AgentTeamPanel
            activeRepository={activeRepository}
            isOrchestrating={isOrchestrating}
            cipherState={cipherState}
            activity={activity}
          />
        </div>
      </div>
    </>
  );
}
