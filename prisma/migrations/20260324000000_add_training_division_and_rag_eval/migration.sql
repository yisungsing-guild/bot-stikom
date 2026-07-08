-- Add divisionKey on TrainingData
ALTER TABLE "TrainingData" ADD COLUMN IF NOT EXISTS "divisionKey" TEXT;
CREATE INDEX IF NOT EXISTS "TrainingData_divisionKey_idx" ON "TrainingData"("divisionKey");

-- Low-confidence / evaluation queue for RAG
CREATE TABLE IF NOT EXISTS "RagEvalItem" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "question" TEXT NOT NULL,
  "normalized" TEXT NOT NULL,
  "divisionKey" TEXT,
  "reason" TEXT NOT NULL,
  "minScore" DOUBLE PRECISION,
  "topScore" DOUBLE PRECISION,
  "contexts" JSONB,
  "occurrences" INTEGER NOT NULL DEFAULT 1,
  "resolvedAt" TIMESTAMP(3),
  "resolvedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RagEvalItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RagEvalItem_key_key" ON "RagEvalItem"("key");
CREATE INDEX IF NOT EXISTS "RagEvalItem_divisionKey_idx" ON "RagEvalItem"("divisionKey");
CREATE INDEX IF NOT EXISTS "RagEvalItem_resolvedAt_idx" ON "RagEvalItem"("resolvedAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'RagEvalItem_resolvedById_fkey'
  ) THEN
    ALTER TABLE "RagEvalItem"
    ADD CONSTRAINT "RagEvalItem_resolvedById_fkey"
    FOREIGN KEY ("resolvedById") REFERENCES "AdminUser"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
