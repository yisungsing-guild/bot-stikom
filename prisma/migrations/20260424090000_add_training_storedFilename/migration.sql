-- Add storedFilename column to TrainingData
ALTER TABLE "TrainingData" ADD COLUMN IF NOT EXISTS "storedFilename" TEXT;

CREATE INDEX IF NOT EXISTS "TrainingData_storedFilename_idx" ON "TrainingData"("storedFilename");
