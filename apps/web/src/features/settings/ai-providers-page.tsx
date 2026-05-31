"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  ShieldCheck,
  Trash2,
  Zap
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────

type Provider = "anthropic" | "openrouter" | "openai" | "gemini";

interface ConfiguredProvider {
  provider: Provider;
  model:    string | null;
  isActive: boolean;
  lastUsedAt: string | null;
  configuredAt: string;
}

interface ProviderMeta {
  id:       Provider;
  label:    string;
  detail:   string;
  keyHint:  string;
  models:   { value: string; label: string }[];
  docsUrl:  string;
}

// ─── Provider definitions ─────────────────────────────────

const PROVIDERS: ProviderMeta[] = [
  {
    id:      "anthropic",
    label:   "Anthropic",
    detail:  "Claude models — highest reasoning quality for architecture analysis.",
    keyHint: "sk-ant-api03-…",
    docsUrl: "https://console.anthropic.com/account/keys",
    models:  [
      { value: "claude-haiku-3-5",             label: "Claude Haiku 3.5 — fast, efficient"    },
      { value: "claude-3-5-sonnet-20241022",    label: "Claude Sonnet 3.5 — balanced"          },
      { value: "claude-opus-4-5",               label: "Claude Opus 4.5 — maximum capability"  }
    ]
  },
  {
    id:      "openrouter",
    label:   "OpenRouter",
    detail:  "Route through OpenRouter to access Claude. One key, stable inference.",
    keyHint: "sk-or-v1-…",
    docsUrl: "https://openrouter.ai/keys",
    models:  [
      { value: "openai/gpt-4o-mini",          label: "GPT-4o Mini — recommended, fast"    },
      { value: "openai/gpt-4o",               label: "GPT-4o — higher capability"         },
      { value: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet"                  },
      { value: "anthropic/claude-3.5-haiku",  label: "Claude 3.5 Haiku"                   }
    ]
  },
  {
    id:      "openai",
    label:   "OpenAI",
    detail:  "GPT-4o and GPT-4o Mini for implementation analysis.",
    keyHint: "sk-proj-…",
    docsUrl: "https://platform.openai.com/api-keys",
    models:  [
      { value: "gpt-4o-mini", label: "GPT-4o Mini — fast, low cost" },
      { value: "gpt-4o",      label: "GPT-4o — high capability"      }
    ]
  },
  {
    id:      "gemini",
    label:   "Google Gemini",
    detail:  "Gemini 2.5 Flash & Pro. Free tier available — great for cost-sensitive analysis.",
    keyHint: "AIza… or AQ.…",
    docsUrl: "https://aistudio.google.com/apikey",
    models:  [
      { value: "gemini-2.5-flash",       label: "Gemini 2.5 Flash — recommended, fast + cheap" },
      { value: "gemini-2.5-flash-lite",  label: "Gemini 2.5 Flash Lite — cheapest"             },
      { value: "gemini-2.5-pro",         label: "Gemini 2.5 Pro — maximum capability"          },
      { value: "gemini-2.0-flash",       label: "Gemini 2.0 Flash"                             },
      { value: "gemini-1.5-pro",         label: "Gemini 1.5 Pro (legacy)"                      },
      { value: "gemini-1.5-flash",       label: "Gemini 1.5 Flash (legacy)"                    }
    ]
  }
];

// ─── Key entry form ───────────────────────────────────────

function ProviderForm({
  meta,
  onSaved,
  onCancel
}: {
  meta: ProviderMeta;
  onSaved: (record: ConfiguredProvider) => void;
  onCancel: () => void;
}) {
  const [apiKey, setApiKey]     = useState("");
  const [model, setModel]       = useState(meta.models[0]?.value ?? "");
  const [showKey, setShowKey]   = useState(false);
  const [testing, setTesting]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState<string | null>(null);

  async function handleSave(withTest: boolean) {
    if (!apiKey.trim()) { setError("API key is required"); return; }
    setError(null);

    withTest ? setTesting(true) : setSaving(true);

    try {
      const res = await fetch("/api/settings/ai-providers", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          provider: meta.id,
          apiKey:   apiKey.trim(),
          model:    model || undefined,
          testConnection: withTest
        })
      });

      const data = (await res.json()) as { error?: string } & Partial<ConfiguredProvider>;

      if (!res.ok) {
        setError(data.error ?? "Failed to save");
        return;
      }

      onSaved(data as ConfiguredProvider);
    } catch {
      setError("Network error — please try again");
    } finally {
      setTesting(false);
      setSaving(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      className="mt-4 space-y-4 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5"
    >
      {/* API Key input */}
      <div>
        <label className="mb-2 block text-xs text-zinc-500">API Key</label>
        <div className="flex items-center gap-2 rounded-xl border border-white/8 bg-black/40 px-4 py-2.5">
          <KeyRound className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
          <input
            type={showKey ? "text" : "password"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={meta.keyHint}
            className="flex-1 bg-transparent text-sm text-zinc-200 placeholder-zinc-700 outline-none"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            onClick={() => setShowKey((v) => !v)}
            className="shrink-0 text-zinc-700 transition hover:text-zinc-500"
            type="button"
          >
            {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        </div>
        <a
          href={meta.docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1.5 inline-block text-[11px] text-zinc-700 transition hover:text-zinc-500"
        >
          Get API key ↗
        </a>
      </div>

      {/* Model selector */}
      <div>
        <label className="mb-2 block text-xs text-zinc-500">Default Model</label>
        <div className="relative">
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full appearance-none rounded-xl border border-white/8 bg-black/40 px-4 py-2.5 pr-8 text-sm text-zinc-300 outline-none"
          >
            {meta.models.map((m) => (
              <option key={m.value} value={m.value} className="bg-zinc-900">
                {m.label}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
        </div>
      </div>

      {/* Error */}
      {error && (
        <p className="rounded-xl border border-red-300/15 bg-red-300/[0.05] px-4 py-2.5 text-xs text-red-300/80">
          {error}
        </p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3">
        <Button
          variant="forest"
          size="sm"
          onClick={() => handleSave(true)}
          disabled={testing || saving || !apiKey.trim()}
        >
          {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
          {testing ? "Testing…" : "Test & Save"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => handleSave(false)}
          disabled={testing || saving || !apiKey.trim()}
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {saving ? "Saving…" : "Save without testing"}
        </Button>
        <button
          onClick={onCancel}
          className="ml-auto text-xs text-zinc-600 transition hover:text-zinc-400"
        >
          Cancel
        </button>
      </div>
    </motion.div>
  );
}

// ─── Provider row ─────────────────────────────────────────

function ProviderRow({
  meta,
  configured,
  onUpdate,
  onRemove
}: {
  meta:       ProviderMeta;
  configured: ConfiguredProvider | null;
  onUpdate:   (record: ConfiguredProvider) => void;
  onRemove:   (provider: Provider) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [removing, setRemoving] = useState(false);

  async function handleRemove() {
    setRemoving(true);
    try {
      await fetch("/api/settings/ai-providers", {
        method:  "DELETE",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ provider: meta.id })
      });
      onRemove(meta.id);
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="rounded-[20px] border border-white/[0.06] bg-white/[0.015] p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <p className="text-sm font-medium text-zinc-200">{meta.label}</p>
            {configured?.isActive && (
              <span className="flex items-center gap-1 rounded-full border border-emerald-200/15 bg-forest-700/15 px-2 py-0.5 text-[10px] text-emerald-300/70">
                <CheckCircle2 className="h-2.5 w-2.5" />
                Active
              </span>
            )}
          </div>
          <p className="mt-1 text-xs leading-5 text-zinc-600">{meta.detail}</p>
          {configured && (
            <p className="mt-2 text-[11px] text-zinc-700">
              Model: {configured.model ?? "default"}
              {configured.lastUsedAt && (
                <> · Last used {new Date(configured.lastUsedAt).toLocaleDateString()}</>
              )}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {configured ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowForm((v) => !v)}
              >
                Replace key
              </Button>
              <button
                onClick={handleRemove}
                disabled={removing}
                className="grid h-7 w-7 place-items-center rounded-full text-zinc-700 transition hover:text-red-400/70"
              >
                {removing
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Trash2 className="h-3.5 w-3.5" />
                }
              </button>
            </>
          ) : (
            <Button
              variant="forest"
              size="sm"
              onClick={() => setShowForm((v) => !v)}
            >
              <KeyRound className="h-3.5 w-3.5" />
              Configure
            </Button>
          )}
        </div>
      </div>

      <AnimatePresence>
        {showForm && (
          <ProviderForm
            meta={meta}
            onSaved={(record) => { onUpdate(record); setShowForm(false); }}
            onCancel={() => setShowForm(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────

export function AIProvidersPage() {
  const [configured, setConfigured] = useState<ConfiguredProvider[]>([]);
  const [loading, setLoading]       = useState(true);

  useEffect(() => {
    fetch("/api/settings/ai-providers")
      .then((r) => r.json() as Promise<{ providers: ConfiguredProvider[] }>)
      .then((data) => setConfigured(data.providers ?? []))
      .catch(() => setConfigured([]))
      .finally(() => setLoading(false));
  }, []);

  function handleUpdate(record: ConfiguredProvider) {
    setConfigured((prev) => {
      const existing = prev.findIndex((p) => p.provider === record.provider);
      if (existing >= 0) {
        const next = [...prev];
        next[existing] = record;
        return next;
      }
      return [...prev, record];
    });
  }

  function handleRemove(provider: Provider) {
    setConfigured((prev) => prev.filter((p) => p.provider !== provider));
  }

  const hasAny = configured.length > 0;

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <p className="text-xs uppercase tracking-[0.26em] text-zinc-600">AI Configuration</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-white">
          AI Providers
        </h1>
        <p className="mt-3 text-sm leading-6 text-zinc-500">
          Bring your own API keys. Keys are encrypted at rest using AES-256-GCM.
          They are never exposed to the browser or included in network responses.
        </p>
      </motion.div>

      {/* Security notice */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.06 }}
        className="flex items-start gap-3 rounded-2xl border border-emerald-200/10 bg-forest-700/[0.08] px-4 py-3.5"
      >
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300/60" />
        <div className="text-xs leading-5 text-zinc-500">
          <span className="text-zinc-400">Keys are server-side only.</span>{" "}
          Your browser communicates with DE-code X internal API routes — never directly with AI providers.
          Raw keys are encrypted before storage and decrypted only during orchestration.
        </div>
      </motion.div>

      {/* Status — none configured */}
      {!loading && !hasAny && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-xs text-zinc-700"
        >
          No providers configured. The analysis pipeline will use the built-in mock engine until a key is added.
        </motion.p>
      )}

      {/* Provider list */}
      <div className="space-y-3">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-[88px] animate-pulse rounded-[20px] bg-white/[0.02]" />
          ))
        ) : (
          PROVIDERS.map((meta, i) => (
            <motion.div
              key={meta.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 + i * 0.05 }}
            >
              <ProviderRow
                meta={meta}
                configured={configured.find((c) => c.provider === meta.id) ?? null}
                onUpdate={handleUpdate}
                onRemove={handleRemove}
              />
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
}
