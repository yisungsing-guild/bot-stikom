-- Add optional uploader relation on TrainingData
ALTER TABLE "TrainingData" ADD COLUMN IF NOT EXISTS "uploadedById" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'TrainingData_uploadedById_fkey'
  ) THEN
    ALTER TABLE "TrainingData"
    ADD CONSTRAINT "TrainingData_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "AdminUser"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "TrainingData_uploadedById_idx" ON "TrainingData"("uploadedById");
