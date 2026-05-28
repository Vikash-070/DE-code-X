# DE-code X — Claude Code Project Instructions

## Project Context

DE-code X is an implementation intelligence workspace — NOT a chatbot, NOT an AI IDE clone.
Engineers use it to understand repositories, analyze patterns, compare architecture ideas, and collaborate with V# (the AI copilot).

Stack: Next.js 15, Clerk v7, OpenRouter (gpt-4o-mini), Supabase/Prisma, Turborepo monorepo.
Path: `C:\Users\VIKASH\OneDrive\Documents\De-codex`
App: `apps/web/src`

## Security (non-negotiable)

- NEVER expose user API keys to frontend
- NEVER store raw provider keys in localStorage
- NEVER persist plaintext keys in database
- API keys must remain server-side only
- Use encrypted persistence (AES-256-GCM via ENCRYPTION_KEY env var)
- Frontend communicates only with DE-code X internal API routes — never directly with AI providers

## Engineering Rules

- No overengineering — MVP-first
- No embeddings/vector DB yet
- No autonomous agents / orchestration complexity
- Prefer simple, deterministic architecture
- Streaming smoothness is a product requirement, not a nice-to-have

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
