"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import { Network } from "lucide-react";

const HIDDEN_PATHS = ["/workspace", "/dashboard", "/connect-github", "/auth", "/sso-callback"];

export function FloatingAuthNav() {
  const pathname = usePathname();
  const isHidden = pathname === "/" || HIDDEN_PATHS.some((p) => pathname.startsWith(p));

  if (isHidden) return null;

  return (
    <div className="fixed right-4 top-24 z-[60] flex items-center gap-2 rounded-full border border-white/10 bg-black/45 p-2 shadow-premium backdrop-blur-2xl">
      <Show when="signed-out">
        <SignInButton mode="modal" forceRedirectUrl="/workspace">
          <button className="rounded-full px-4 py-2 text-sm text-zinc-300 transition hover:bg-white/[0.06] hover:text-white">
            Sign In
          </button>
        </SignInButton>
        <SignUpButton mode="modal" forceRedirectUrl="/workspace">
          <button className="rounded-full bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-emerald-50">
            Create Account
          </button>
        </SignUpButton>
      </Show>
      <Show when="signed-in">
        <Link
          href="/workspace"
          className="hidden items-center gap-2 rounded-full px-3 py-2 text-sm text-zinc-300 transition hover:bg-white/[0.06] hover:text-white sm:flex"
        >
          <Network className="h-4 w-4 text-emerald-200" />
          Workspace
        </Link>
        <UserButton />
      </Show>
    </div>
  );
}
