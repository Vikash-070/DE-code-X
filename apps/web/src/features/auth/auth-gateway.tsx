"use client";

import { useState } from "react";
import Link from "next/link";
import { SignInButton, SignUpButton } from "@clerk/nextjs";
import { Mail, Network, ShieldCheck } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

import { OAuthButton } from "@/components/auth/oauth-button";
import { AmbientBackground } from "@/components/primitives/ambient-background";
import { RepositoryGraph } from "@/components/primitives/repository-graph";
import { Button } from "@/components/ui/button";

export function AuthGateway() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const ClerkAction = mode === "signin" ? SignInButton : SignUpButton;

  return (
    <main className="relative min-h-screen overflow-hidden bg-black text-white">
      <AmbientBackground />
      <div className="grid min-h-screen lg:grid-cols-[1.1fr_0.9fr]">
        <section className="relative hidden items-center px-10 py-16 lg:flex">
          <div className="w-full">
            <Link href="/" className="mb-12 flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-2xl border border-emerald-300/25 bg-forest-700/45 shadow-glow">
                <Network className="h-5 w-5 text-emerald-200" />
              </span>
              <span className="text-sm font-semibold tracking-[0.22em]">DE-code X</span>
            </Link>
            <h1 className="max-w-2xl text-6xl font-semibold tracking-[-0.055em]">Sign into your AI operating system.</h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-zinc-400">Identity layer. Connect your engineering infrastructure — GitHub repositories, private access, organization scope — inside the workspace after sign-in.</p>
            <div className="premium-border glass mt-12 rounded-[32px] p-3">
              <RepositoryGraph />
            </div>
          </div>
        </section>
        <section className="flex items-center justify-center px-5 py-12">
          <motion.div initial={{ opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} className="glass w-full max-w-md rounded-[32px] p-6 sm:p-8">
            <div className="mb-8 flex rounded-full border border-white/10 bg-black/40 p-1">
              {[
                ["signin", "Sign In"],
                ["signup", "Create Account"]
              ].map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setMode(key as "signin" | "signup")}
                  className="relative h-10 flex-1 rounded-full text-sm text-zinc-400 transition hover:text-white"
                >
                  {mode === key ? <motion.span layoutId="auth-mode" className="absolute inset-0 rounded-full bg-white text-black" /> : null}
                  <span className="relative z-10">{label}</span>
                </button>
              ))}
            </div>
            <AnimatePresence mode="wait">
              <motion.div
                key={mode}
                initial={{ opacity: 0, x: mode === "signin" ? -12 : 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: mode === "signin" ? 12 : -12 }}
                transition={{ duration: 0.35 }}
              >
                <p className="text-xs uppercase tracking-[0.28em] text-emerald-300/70">{mode === "signin" ? "Welcome back" : "Create workspace"}</p>
                <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em]">{mode === "signin" ? "Enter the platform" : "Initialize workspace"}</h2>
                <div className="mt-8">
                  <OAuthButton mode={mode} strategy="oauth_google" icon={Mail}>
                    Continue with Google
                  </OAuthButton>
                </div>
                <div className="my-8 flex items-center gap-4">
                  <div className="h-px flex-1 bg-white/10" />
                  <span className="text-xs text-zinc-600">or</span>
                  <div className="h-px flex-1 bg-white/10" />
                </div>
                <ClerkAction mode="modal" forceRedirectUrl="/workspace">
                  <Button className="w-full" variant="ghost">
                    Continue with email
                  </Button>
                </ClerkAction>
                <div id="clerk-captcha" />
              </motion.div>
            </AnimatePresence>
            <div className="mt-8 flex items-center gap-3 rounded-2xl border border-emerald-200/15 bg-forest-700/15 p-4 text-sm text-zinc-300">
              <ShieldCheck className="h-5 w-5 text-emerald-200" />
              Identity only. GitHub repository access is granted separately inside the workspace.
            </div>
          </motion.div>
        </section>
      </div>
    </main>
  );
}
