/**
 * getOrProvisionUser — resolve (or create) the DB User row for a Clerk session.
 *
 * Every API route that needs the internal user.id calls this instead of a bare
 * prisma.user.findUnique. When the user row doesn't exist yet (first request
 * after a fresh DB push, account re-creation, etc.) we upsert it from Clerk data
 * so no route ever returns 401 just because the row is missing.
 *
 * The upsert keys on `email` (not clerkId) so SSO / re-link edge cases are safe.
 *
 * Returns null only when Clerk auth is missing or the DB is unreachable.
 */

import { clerkClient } from "@clerk/nextjs/server";
import { prisma }      from "@/lib/prisma";

export interface ProvisionedUser {
  id:      string;
  clerkId: string;
  email:   string;
}

export async function getOrProvisionUser(clerkId: string): Promise<ProvisionedUser | null> {
  // Fast path: user row already exists.
  const existing = await prisma.user.findUnique({
    where:  { clerkId },
    select: { id: true, clerkId: true, email: true },
  }).catch(() => null);

  if (existing) return existing;

  // Slow path: first request for this user — fetch from Clerk and upsert.
  try {
    const client    = await clerkClient();
    const clerkUser = await client.users.getUser(clerkId);
    const email     = clerkUser.emailAddresses[0]?.emailAddress ?? `${clerkId}@clerk.local`;
    const name      = clerkUser.fullName ?? undefined;

    const user = await prisma.user.upsert({
      where:  { email },
      create: { clerkId, email, name },
      update: { clerkId, name },
      select: { id: true, clerkId: true, email: true },
    });

    return user;
  } catch {
    return null; // DB unreachable or Clerk unavailable
  }
}
