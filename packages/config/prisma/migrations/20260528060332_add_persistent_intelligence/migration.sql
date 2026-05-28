-- CreateTable
CREATE TABLE "file_intelligence" (
    "id" TEXT NOT NULL,
    "repoFullName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "blobSHA" TEXT NOT NULL,
    "branch" TEXT NOT NULL DEFAULT 'main',
    "agentId" TEXT NOT NULL DEFAULT 'cipher',
    "findings" JSONB NOT NULL,
    "nodeIds" TEXT[],
    "confidence" TEXT NOT NULL DEFAULT 'partial',
    "analyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "file_intelligence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repository_snapshots" (
    "id" TEXT NOT NULL,
    "repoFullName" TEXT NOT NULL,
    "branch" TEXT NOT NULL DEFAULT 'main',
    "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fileEntries" JSONB NOT NULL,

    CONSTRAINT "repository_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "file_intelligence_repoFullName_branch_idx" ON "file_intelligence"("repoFullName", "branch");

-- CreateIndex
CREATE UNIQUE INDEX "file_intelligence_repoFullName_filePath_branch_key" ON "file_intelligence"("repoFullName", "filePath", "branch");

-- CreateIndex
CREATE UNIQUE INDEX "repository_snapshots_repoFullName_branch_key" ON "repository_snapshots"("repoFullName", "branch");
