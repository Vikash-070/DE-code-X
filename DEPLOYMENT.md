# Deploying DE-code X to production (Render)

DE-code X is a Next.js 15 app with Clerk auth, a Postgres (Supabase) database via
Prisma, encrypted per-user API keys, and streaming AI routes. It is **not** a
static site — it needs server runtime + secrets. Render runs it as a long-lived
Node web service, which fits this repo (apps/web has no package.json; we build
and start from the root).

---

## 1. Prerequisites (you set these up — they hold real secrets)

### a) Clerk — production instance
1. Clerk dashboard → create/switch to a **Production** instance.
2. Add a **GitHub OAuth** connection; in your GitHub OAuth app set the callback to
   your Clerk prod domain (Clerk shows the exact URL).
3. Request the scopes the app uses: `repo`, `read:user`, `read:org`, `workflow`.
4. Copy `pk_live_…` (publishable) and `sk_live_…` (secret).

### b) Supabase — production database
1. Create a Supabase project; copy the Postgres connection string.
   - Use the **pooled** connection (port `6543`, `?pgbouncer=true`) as `DATABASE_URL`.
2. Apply the schema (from your machine, pointing at the prod DB):
   ```bash
   DATABASE_URL="<prod-url>" npx prisma db push --schema packages/config/prisma/schema.prisma
   ```

### c) ENCRYPTION_KEY (AES-256-GCM, 32 bytes / 64 hex chars)
Generate **once** and keep it stable forever (it decrypts stored user keys —
rotating it invalidates every saved API key):
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 2. Environment variables (set in Render dashboard → Environment)

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | ✅ | Supabase pooled Postgres URL |
| `ENCRYPTION_KEY` | ✅ | 64 hex chars; **stable across deploys** |
| `CLERK_SECRET_KEY` | ✅ | `sk_live_…` |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | ✅ | `pk_live_…` — **needed at build time** (inlined into the client bundle) |
| `NODE_VERSION` | ✅ | `20` (set in render.yaml) |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | optional | only if you override Clerk defaults |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | optional | " |

> ⚠️ `NEXT_PUBLIC_*` vars are baked in **at build time**. Add them before the
> first deploy, and re-deploy if you change them.

---

## 3. Deploy on Render

**Option A — Blueprint (uses `render.yaml`, recommended):**
1. Render dashboard → **New → Blueprint**.
2. Connect `github.com/Vikash-070/DE-code-X`, pick the `main` branch.
3. Render reads `render.yaml` (service `decode-x`). Fill in the `sync: false`
   secrets when prompted, then **Apply**.

**Option B — Manual web service:**
- New → **Web Service** → connect repo → branch `main`.
- Runtime: **Node**. Build: `npm install && npm run build:prod`.
  Start: `npm run start:prod`. Health check path: `/`.
- Add the env vars from the table above.

Build pipeline (`build:prod`): `prisma generate` → `next build apps/web`.
Start (`start:prod`): `next start apps/web -p $PORT`.

---

## 4. Post-deploy checks
1. Open the Render URL → landing page renders (health check `/` is 200).
2. Sign in with Clerk → connect GitHub → confirm a repo loads.
3. In **Settings → AI Providers**, add an OpenRouter key → confirm it saves
   (this exercises `ENCRYPTION_KEY`).
4. Ask V# something → confirm the response **streams** (validates the long-lived
   server handles streaming; Render has no function timeout).
5. Open the **Architecture Workspace** → the canvas loads; "Load call wires" and
   "Explain"/"Find notable issues" work (validates GitHub token + OpenRouter).

---

## 5. Production hardening follow-ups (recommended, not blocking)
- **Redis (Upstash) for rate-limit + caches.** The rate limiter and the
  narration/findings/tree caches are **in-process**. On a single Render instance
  they work, but they don't share state across instances — so the moment you
  scale to >1 instance (or autoscale), move them to Redis. The guard API in
  `server/security/guards.ts` is structured to swap the backing store.
- **Run on every deploy:** ensure DB migrations are applied (`prisma db push` /
  `migrate deploy`) before the new build serves traffic.
- **Rotate** the dev `ENCRYPTION_KEY` — never reuse it in prod.

---

## Other hosts
- **Vercel:** best Next.js DX, but this layout needs a tweak first — `apps/web`
  has no `package.json`, which Vercel's Next detection expects. Either add
  `apps/web/package.json` or configure Root Directory + build command. Vercel is
  serverless, so the in-process caches reset per invocation → add Redis. Set
  `export const maxDuration = 60` on the streaming routes (Hobby caps function
  time low).
- **Fly.io / Railway:** same shape as Render — a Dockerfile or the `build:prod` /
  `start:prod` scripts work directly.
