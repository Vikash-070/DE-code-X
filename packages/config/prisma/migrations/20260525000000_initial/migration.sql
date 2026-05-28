CREATE TABLE "users" (
  "id" TEXT NOT NULL,
  "clerkId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT,
  "avatarUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "projects" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "repositories" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "githubId" TEXT,
  "name" TEXT NOT NULL,
  "fullName" TEXT NOT NULL,
  "defaultBranch" TEXT NOT NULL DEFAULT 'main',
  "graphSnapshot" JSONB,
  "architectureMap" JSONB,
  "lastScannedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "repositories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tutorial_analyses" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceUrl" TEXT,
  "rawInput" TEXT NOT NULL,
  "extractedFeature" JSONB NOT NULL,
  "compatibilityFindings" JSONB NOT NULL,
  "securityFindings" JSONB NOT NULL,
  "scalabilityFindings" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tutorial_analyses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "implementation_sessions" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "tutorialAnalysisId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "roadmap" JSONB NOT NULL,
  "affectedFiles" JSONB NOT NULL,
  "dependencyChanges" JSONB NOT NULL,
  "generatedPrompts" JSONB NOT NULL,
  "mcpPayload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "implementation_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_clerkId_key" ON "users"("clerkId");
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "projects_slug_key" ON "projects"("slug");
CREATE UNIQUE INDEX "repositories_githubId_key" ON "repositories"("githubId");

ALTER TABLE "projects" ADD CONSTRAINT "projects_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tutorial_analyses" ADD CONSTRAINT "tutorial_analyses_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "implementation_sessions" ADD CONSTRAINT "implementation_sessions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
