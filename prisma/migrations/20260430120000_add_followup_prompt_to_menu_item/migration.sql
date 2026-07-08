-- AlterTable: add followupPrompt column to MenuItem for submenu follow-up instructions
ALTER TABLE "MenuItem" ADD COLUMN "followupPrompt" TEXT;
