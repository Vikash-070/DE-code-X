"use client";

import Link from "next/link";
import { ArrowRight, BrainCircuit, Github, Network, Play, ShieldCheck, Terminal, Workflow, Zap } from "lucide-react";
import { motion } from "framer-motion";

import { Reveal } from "@/components/motion/reveal";
import { AmbientBackground } from "@/components/primitives/ambient-background";
import { RepositoryGraph } from "@/components/primitives/repository-graph";
import { Section, SectionHeader } from "@/components/primitives/section";
import { Button } from "@/components/ui/button";

const logos = ["GitHub", "OpenAI", "Next.js", "Docker", "Supabase", "Vercel"];
const features = [
  "Tutorial Intelligence",
  "Repo Graph Engine",
  "Architecture Awareness",
  "Security Validation",
  "CI/CD Sandbox",
  "Prompt Optimization",
  "BYOK AI Models",
  "AI Implementation Copilot"
];

export function LandingPage() {
  return (
    <main className="relative min-h-screen bg-black text-white">
      <AmbientBackground />
      <header className="fixed left-0 right-0 top-4 z-50 px-4">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between rounded-full border border-white/10 bg-black/45 px-4 shadow-2xl shadow-black/30 backdrop-blur-2xl sm:px-6">
          <Link href="/" className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-full border border-emerald-300/30 bg-forest-700/50 shadow-glow">
              <Network className="h-4 w-4 text-emerald-200" />
            </span>
            <span className="text-sm font-semibold tracking-[0.22em] text-white">DE-code X</span>
          </Link>
          <div className="hidden items-center gap-1 lg:flex">
            {["Features", "Workflow", "Security", "Architecture", "Docs"].map((link) => (
              <a key={link} href={`#${link.toLowerCase()}`} className="rounded-full px-4 py-2 text-sm text-zinc-400 transition hover:bg-white/[0.06] hover:text-white">
                {link}
              </a>
            ))}
          </div>
          <Button asChild variant="forest" className="h-10">
            <Link href="/auth">Start Analysis</Link>
          </Button>
        </nav>
      </header>

      <section className="relative min-h-screen px-5 pb-20 pt-36 text-center sm:px-8">
        <div className="mx-auto max-w-7xl">
          <Reveal>
            <div className="mx-auto mb-7 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-zinc-300 backdrop-blur-xl">
              <BrainCircuit className="h-4 w-4 text-emerald-200" />
              AI implementation infrastructure for serious engineering teams
            </div>
          </Reveal>
          <Reveal delay={0.08}>
            <h1 className="mx-auto max-w-5xl text-balance text-5xl font-semibold tracking-[-0.055em] sm:text-7xl lg:text-[96px] lg:leading-[0.95]">
              Turn Tutorials Into Production-Ready Features
            </h1>
          </Reveal>
          <Reveal delay={0.16}>
            <p className="mx-auto mt-8 max-w-3xl text-pretty text-lg leading-8 text-zinc-400 sm:text-xl">
              Architecture-aware AI that analyzes tutorials, repositories, implementation risks, and security before code reaches production.
            </p>
          </Reveal>
          <Reveal delay={0.24}>
            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link href="/auth">Start Analysis <ArrowRight className="h-4 w-4" /></Link>
              </Button>
              <Button asChild size="lg" variant="ghost">
                <Link href="/dashboard"><Play className="h-4 w-4" /> Watch Demo</Link>
              </Button>
            </div>
          </Reveal>
          <Reveal delay={0.32}>
            <div className="premium-border glass mx-auto mt-16 max-w-6xl rounded-[32px] p-3">
              <RepositoryGraph className="min-h-[560px]" />
            </div>
          </Reveal>
        </div>
      </section>

      <div className="border-y border-white/[0.07] bg-white/[0.025] px-5 py-8 backdrop-blur-xl">
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {logos.map((logo) => <div key={logo} className="rounded-full border border-white/10 bg-black/30 px-5 py-2 text-center text-sm font-medium text-zinc-300">{logo}</div>)}
        </div>
      </div>

      <Section id="workflow">
        <SectionHeader eyebrow="Workflow" title="From inspiration to MCP execution, with architectural truth preserved." />
        <div className="mt-16 grid gap-4 lg:grid-cols-4">
          {[
            ["Feature Intelligence", BrainCircuit],
            ["Repository Analysis", Network],
            ["Security Validation", ShieldCheck],
            ["Codex MCP Context", Terminal]
          ].map(([title, Icon], index) => (
            <Reveal key={title as string} delay={index * 0.08}>
              <motion.div whileHover={{ y: -8 }} className="glass rounded-3xl p-6">
                <Icon className="h-6 w-6 text-emerald-200" />
                <h3 className="mt-10 text-xl font-semibold">{title as string}</h3>
                <p className="mt-4 text-sm leading-6 text-zinc-400">Structured intelligence for implementation decisions, code generation, review, and production readiness.</p>
              </motion.div>
            </Reveal>
          ))}
        </div>
      </Section>

      <Section id="features" className="bg-[#030303]">
        <SectionHeader eyebrow="Platform" title="An elite operating layer for AI-assisted software delivery." />
        <div className="mt-16 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {features.map((feature) => (
            <motion.div key={feature} whileHover={{ y: -8 }} className="glass rounded-3xl p-6">
              <Zap className="h-5 w-5 text-emerald-200" />
              <h3 className="mt-10 text-lg font-semibold">{feature}</h3>
            </motion.div>
          ))}
        </div>
      </Section>

      <Section id="security">
        <div className="premium-border relative overflow-hidden rounded-[36px] border border-white/10 bg-[#020504] px-6 py-20 text-center sm:px-10">
          <div className="absolute inset-0 moving-grid opacity-20" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(29,118,89,.34),transparent_52%)]" />
          <div className="relative mx-auto max-w-4xl">
            <h2 className="text-balance text-5xl font-semibold tracking-[-0.045em] sm:text-7xl">Stop Blindly Shipping AI Code</h2>
            <p className="mx-auto mt-7 max-w-2xl text-lg leading-8 text-zinc-400">DE-code X transforms tutorials into production-safe implementation intelligence.</p>
            <div className="mt-10 flex flex-col justify-center gap-3 sm:flex-row">
              <Button asChild size="lg"><Link href="/auth">Start Analysis</Link></Button>
              <Button asChild size="lg" variant="ghost"><Link href="/auth">Start Analysis</Link></Button>
            </div>
          </div>
        </div>
      </Section>

      <footer className="border-t border-white/[0.07] px-5 py-10">
        <div className="mx-auto flex max-w-7xl flex-col gap-8 text-sm text-zinc-500 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3 text-white"><Network className="h-5 w-5 text-emerald-200" /><span className="font-semibold tracking-[0.22em]">DE-code X</span></div>
          <div className="flex flex-wrap gap-5">{["Product", "Docs", "Security", "GitHub", "Company"].map((item) => <a key={item} href="#" className="transition hover:text-white">{item}</a>)}</div>
        </div>
      </footer>
    </main>
  );
}
