import { prisma } from "@/lib/prisma";

export async function getOrCreateWorkspace(clerkId: string, email: string, name?: string | null) {
  let user = await prisma.user.findUnique({ where: { clerkId } });

  if (!user) {
    user = await prisma.user.create({
      data: { clerkId, email, name: name ?? null }
    });
  }

  let project = await prisma.project.findFirst({ where: { ownerId: user.id } });

  if (!project) {
    project = await prisma.project.create({
      data: {
        name: "Default Workspace",
        slug: `workspace-${user.id.slice(-8)}`,
        ownerId: user.id
      }
    });
  }

  return { user, project };
}
