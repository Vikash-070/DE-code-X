ALTER TABLE "tutorial_analyses" ADD COLUMN "repository_full_name" TEXT;
ALTER TABLE "tutorial_analyses" ADD COLUMN "pipeline_status" TEXT NOT NULL DEFAULT 'idle';
ALTER TABLE "tutorial_analyses" ADD COLUMN "agent_outputs" JSONB;
