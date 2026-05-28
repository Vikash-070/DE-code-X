/**
 * Package signal table — maps npm package names to canonical system names.
 *
 * Rules:
 * - Production dependencies only (devDependencies excluded at scan time by caller)
 * - @types/* packages filtered BEFORE this lookup by the registry builder
 * - Test-only packages (jest, vitest, @testing-library/*) are intentionally absent
 * - Scoped packages use full name e.g. "@clerk/nextjs" not "clerk"
 * - Lock file transitive deps are NEVER scanned — package.json only
 *
 * Adding a new package:
 * 1. Add the exact npm package name as the key
 * 2. Point to the correct canonical SystemName
 * 3. Use a human-readable component label (shown in V# responses)
 *
 * Do NOT add packages that appear only in devDependencies by convention
 * (e.g. @testing-library/*, @storybook/*, eslint-plugin-*).
 */

import type { SystemName } from "./system-vocabulary";

export type PackageSignalEntry = {
  system:    SystemName;
  /** Human-readable label shown in V# system map e.g. "Clerk", "Prisma ORM". */
  component: string;
};

export type PackageSignalTable = Record<string, PackageSignalEntry>;

export const PACKAGE_SIGNALS: PackageSignalTable = {

  // ─── Authentication ──────────────────────────────────────
  "@clerk/nextjs":              { system: "Authentication",         component: "Clerk" },
  "@clerk/clerk-react":         { system: "Authentication",         component: "Clerk" },
  "@clerk/express":             { system: "Authentication",         component: "Clerk" },
  "@clerk/backend":             { system: "Authentication",         component: "Clerk" },
  "next-auth":                  { system: "Authentication",         component: "NextAuth" },
  "lucia":                      { system: "Authentication",         component: "Lucia" },
  "oslo":                       { system: "Authentication",         component: "Lucia/Oslo" },
  "jose":                       { system: "Authentication",         component: "JOSE/JWT" },
  "jsonwebtoken":               { system: "Authentication",         component: "JWT" },
  "passport":                   { system: "Authentication",         component: "Passport" },
  "passport-local":             { system: "Authentication",         component: "Passport" },
  "passport-google-oauth20":    { system: "Authentication",         component: "Passport/Google" },
  "passport-github2":           { system: "Authentication",         component: "Passport/GitHub" },
  "better-auth":                { system: "Authentication",         component: "BetterAuth" },
  "auth.js":                    { system: "Authentication",         component: "Auth.js" },
  "kinde-authjs":               { system: "Authentication",         component: "Kinde" },
  "@kinde-oss/kinde-auth-nextjs": { system: "Authentication",      component: "Kinde" },
  "firebase":                   { system: "Authentication",         component: "Firebase Auth" },

  // ─── Database ────────────────────────────────────────────
  "@prisma/client":             { system: "Database",               component: "Prisma" },
  "prisma":                     { system: "Database",               component: "Prisma" },
  "drizzle-orm":                { system: "Database",               component: "Drizzle" },
  "mongoose":                   { system: "Database",               component: "Mongoose/MongoDB" },
  "pg":                         { system: "Database",               component: "PostgreSQL" },
  "mysql2":                     { system: "Database",               component: "MySQL" },
  "better-sqlite3":             { system: "Database",               component: "SQLite" },
  "@supabase/supabase-js":      { system: "Database",               component: "Supabase" },
  "typeorm":                    { system: "Database",               component: "TypeORM" },
  "sequelize":                  { system: "Database",               component: "Sequelize" },
  "knex":                       { system: "Database",               component: "Knex" },
  "kysely":                     { system: "Database",               component: "Kysely" },
  "@neon-tech/serverless":      { system: "Database",               component: "Neon" },
  "@neondatabase/serverless":   { system: "Database",               component: "Neon" },
  "mongodb":                    { system: "Database",               component: "MongoDB" },

  // ─── AI Orchestration ────────────────────────────────────
  "openai":                     { system: "AI Orchestration",       component: "OpenAI" },
  "@anthropic-ai/sdk":          { system: "AI Orchestration",       component: "Anthropic" },
  "anthropic":                  { system: "AI Orchestration",       component: "Anthropic" },
  "langchain":                  { system: "AI Orchestration",       component: "LangChain" },
  "@langchain/core":            { system: "AI Orchestration",       component: "LangChain" },
  "@langchain/openai":          { system: "AI Orchestration",       component: "LangChain/OpenAI" },
  "@langchain/anthropic":       { system: "AI Orchestration",       component: "LangChain/Anthropic" },
  "llamaindex":                 { system: "AI Orchestration",       component: "LlamaIndex" },
  "replicate":                  { system: "AI Orchestration",       component: "Replicate" },
  "groq-sdk":                   { system: "AI Orchestration",       component: "Groq" },
  "ai":                         { system: "AI Orchestration",       component: "Vercel AI SDK" },
  "@ai-sdk/openai":             { system: "AI Orchestration",       component: "Vercel AI SDK" },
  "@ai-sdk/anthropic":          { system: "AI Orchestration",       component: "Vercel AI SDK" },
  "cohere-ai":                  { system: "AI Orchestration",       component: "Cohere" },
  "@cohere-ai/cohere-ai":       { system: "AI Orchestration",       component: "Cohere" },
  "mistralai":                  { system: "AI Orchestration",       component: "Mistral" },
  "@mistralai/mistralai":       { system: "AI Orchestration",       component: "Mistral" },
  "openrouter-ai":              { system: "AI Orchestration",       component: "OpenRouter" },

  // ─── Realtime Messaging ──────────────────────────────────
  "socket.io":                  { system: "Realtime Messaging",     component: "Socket.IO" },
  "socket.io-client":           { system: "Realtime Messaging",     component: "Socket.IO" },
  "pusher":                     { system: "Realtime Messaging",     component: "Pusher" },
  "pusher-js":                  { system: "Realtime Messaging",     component: "Pusher" },
  "ably":                       { system: "Realtime Messaging",     component: "Ably" },
  "liveblocks":                 { system: "Realtime Messaging",     component: "Liveblocks" },
  "@liveblocks/client":         { system: "Realtime Messaging",     component: "Liveblocks" },
  "@liveblocks/react":          { system: "Realtime Messaging",     component: "Liveblocks" },
  "partykit":                   { system: "Realtime Messaging",     component: "PartyKit" },
  "partysocket":                { system: "Realtime Messaging",     component: "PartyKit" },
  "ws":                         { system: "Realtime Messaging",     component: "WebSockets" },
  "y-websocket":                { system: "Realtime Messaging",     component: "Yjs/WebSocket" },
  "centrifuge":                 { system: "Realtime Messaging",     component: "Centrifuge" },

  // ─── File Uploads ────────────────────────────────────────
  "multer":                     { system: "File Uploads",           component: "Multer" },
  "formidable":                 { system: "File Uploads",           component: "Formidable" },
  "busboy":                     { system: "File Uploads",           component: "Busboy" },
  "@aws-sdk/client-s3":         { system: "File Uploads",           component: "AWS S3" },
  "@aws-sdk/s3-request-presigner": { system: "File Uploads",        component: "AWS S3" },
  "aws-sdk":                    { system: "File Uploads",           component: "AWS SDK" },
  "uploadthing":                { system: "File Uploads",           component: "UploadThing" },
  "@uploadthing/react":         { system: "File Uploads",           component: "UploadThing" },
  "@uploadthing/next":          { system: "File Uploads",           component: "UploadThing" },
  "cloudinary":                 { system: "File Uploads",           component: "Cloudinary" },
  "@cloudinary/url-gen":        { system: "File Uploads",           component: "Cloudinary" },
  "sharp":                      { system: "File Uploads",           component: "Sharp/Image" },
  "@vercel/blob":               { system: "File Uploads",           component: "Vercel Blob" },
  "imagekit":                   { system: "File Uploads",           component: "ImageKit" },

  // ─── Payments ────────────────────────────────────────────
  "stripe":                     { system: "Payments",               component: "Stripe" },
  "@stripe/stripe-js":          { system: "Payments",               component: "Stripe" },
  "@stripe/react-stripe-js":    { system: "Payments",               component: "Stripe" },
  "lemonsqueezy":               { system: "Payments",               component: "LemonSqueezy" },
  "@lemonsqueezy/lemonsqueezy-js": { system: "Payments",            component: "LemonSqueezy" },
  "paddle-js":                  { system: "Payments",               component: "Paddle" },
  "@paddle/paddle-js":          { system: "Payments",               component: "Paddle" },
  "braintree":                  { system: "Payments",               component: "Braintree" },
  "paypal-rest-sdk":            { system: "Payments",               component: "PayPal" },
  "@paypal/react-paypal-js":    { system: "Payments",               component: "PayPal" },

  // ─── Queue Systems ───────────────────────────────────────
  "bull":                       { system: "Queue Systems",          component: "Bull" },
  "bullmq":                     { system: "Queue Systems",          component: "BullMQ" },
  "bee-queue":                  { system: "Queue Systems",          component: "Bee Queue" },
  "agenda":                     { system: "Queue Systems",          component: "Agenda" },
  "node-cron":                  { system: "Queue Systems",          component: "node-cron" },
  "cron":                       { system: "Queue Systems",          component: "cron" },
  "inngest":                    { system: "Queue Systems",          component: "Inngest" },
  "trigger.dev":                { system: "Queue Systems",          component: "Trigger.dev" },
  "@trigger.dev/sdk":           { system: "Queue Systems",          component: "Trigger.dev" },
  "@trigger.dev/react":         { system: "Queue Systems",          component: "Trigger.dev" },
  "p-queue":                    { system: "Queue Systems",          component: "p-queue" },
  "queue":                      { system: "Queue Systems",          component: "queue" },

  // ─── Infrastructure/Caching ──────────────────────────────
  "redis":                      { system: "Infrastructure/Caching", component: "Redis" },
  "ioredis":                    { system: "Infrastructure/Caching", component: "ioredis/Redis" },
  "@upstash/redis":             { system: "Infrastructure/Caching", component: "Upstash Redis" },
  "@upstash/ratelimit":         { system: "Infrastructure/Caching", component: "Upstash" },
  "memjs":                      { system: "Infrastructure/Caching", component: "Memcached" },
  "node-cache":                 { system: "Infrastructure/Caching", component: "node-cache" },
  "lru-cache":                  { system: "Infrastructure/Caching", component: "LRU Cache" },
  "cache-manager":              { system: "Infrastructure/Caching", component: "Cache Manager" },
  "keyv":                       { system: "Infrastructure/Caching", component: "Keyv" },
};
