-- DropIndex
DROP INDEX "TrainingData_divisionKey_idx";

-- DropIndex
DROP INDEX "TrainingData_storedFilename_idx";

-- DropIndex
DROP INDEX "TrainingData_uploadedById_idx";

-- AlterTable
ALTER TABLE "RagEvalItem" ALTER COLUMN "updatedAt" DROP DEFAULT;
