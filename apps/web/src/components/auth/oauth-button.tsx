"use client";

import { useState } from "react";
import { useSignIn, useSignUp } from "@clerk/nextjs";
import type { LucideIcon } from "lucide-react";

type OAuthStrategy = "oauth_google";

export function OAuthButton({
  mode,
  strategy,
  icon: Icon,
  children
}: {
  mode: "signin" | "signup";
  strategy: OAuthStrategy;
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
  const [loading, setLoading] = useState(false);

  async function startOAuth() {
    const flow = mode === "signin" ? signIn : signUp;
    if (!flow || loading) return;
    setLoading(true);
    await flow.sso({
      strategy,
      redirectUrl: "/workspace",
      redirectCallbackUrl: "/sso-callback"
    });
  }

  return (
    <button
      type="button"
      onClick={startOAuth}
      disabled={loading}
      className="flex h-12 w-full items-center justify-center gap-3 rounded-full border border-white/10 bg-white/[0.04] text-sm transition hover:border-white/20 hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-60"
    >
      <Icon className={`h-4 w-4 transition-opacity ${loading ? "opacity-40" : ""}`} />
      {loading ? "Connecting…" : children}
    </button>
  );
}
