-- AlterTable: Add missing processing and storage metadata columns to TrainingData
ALTER TABLE "TrainingData"
  ADD COLUMN IF NOT EXISTS "sourceUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "storageType" TEXT,
  ADD COLUMN IF NOT EXISTS "transcriptText" TEXT,
  ADD COLUMN IF NOT EXISTS "processingStatus" TEXT NOT NULL DEFAULT 'pending';
