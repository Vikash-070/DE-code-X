/*
  Warnings:

  - You are about to drop the column `agent_outputs` on the `tutorial_analyses` table. All the data in the column will be lost.
  - You are about to drop the column `pipeline_status` on the `tutorial_analyses` table. All the data in the column will be lost.
  - You are about to drop the column `repository_full_name` on the `tutorial_analyses` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "tutorial_analyses" DROP COLUMN "agent_outputs",
DROP COLUMN "pipeline_status",
DROP COLUMN "repository_full_name",
ADD COLUMN     "agentOutputs" JSONB,
ADD COLUMN     "pipelineStatus" TEXT NOT NULL DEFAULT 'idle',
ADD COLUMN     "repositoryFullName" TEXT;

-- CreateTable
CREATE TABLE "user_provider_keys" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "encryptedKey" TEXT NOT NULL,
    "model" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_provider_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_provider_keys_userId_provider_key" ON "user_provider_keys"("userId", "provider");

-- AddForeignKey
ALTER TABLE "user_provider_keys" ADD CONSTRAINT "user_provider_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
