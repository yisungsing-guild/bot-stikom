ALTER TABLE "TrainingData"
  ADD COLUMN IF NOT EXISTS "governanceStatus" TEXT NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS "governanceOwner" TEXT,
  ADD COLUMN IF NOT EXISTS "governanceVersion" TEXT,
  ADD COLUMN IF NOT EXISTS "validFrom" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "validTo" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "governanceMetadata" JSONB;

CREATE INDEX IF NOT EXISTS "TrainingData_governanceStatus_idx" ON "TrainingData"("governanceStatus");
CREATE INDEX IF NOT EXISTS "TrainingData_validTo_idx" ON "TrainingData"("validTo");

CREATE TABLE IF NOT EXISTS "InboundEventDedupe" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'whatsapp',
  "chatId" TEXT NOT NULL,
  "messageId" TEXT,
  "dedupeKey" TEXT NOT NULL,
  "textHash" TEXT,
  "inboundTs" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InboundEventDedupe_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "InboundEventDedupe_dedupeKey_key" ON "InboundEventDedupe"("dedupeKey");
CREATE INDEX IF NOT EXISTS "InboundEventDedupe_chatId_idx" ON "InboundEventDedupe"("chatId");
CREATE INDEX IF NOT EXISTS "InboundEventDedupe_messageId_idx" ON "InboundEventDedupe"("messageId");
CREATE INDEX IF NOT EXISTS "InboundEventDedupe_createdAt_idx" ON "InboundEventDedupe"("createdAt");

CREATE TABLE IF NOT EXISTS "UserFeedback" (
  "id" TEXT NOT NULL,
  "chatId" TEXT NOT NULL,
  "feedbackType" TEXT NOT NULL,
  "userText" TEXT NOT NULL,
  "lastBotAnswer" TEXT,
  "lastBotSource" TEXT,
  "status" TEXT NOT NULL DEFAULT 'open',
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserFeedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "UserFeedback_chatId_idx" ON "UserFeedback"("chatId");
CREATE INDEX IF NOT EXISTS "UserFeedback_feedbackType_idx" ON "UserFeedback"("feedbackType");
CREATE INDEX IF NOT EXISTS "UserFeedback_status_idx" ON "UserFeedback"("status");
CREATE INDEX IF NOT EXISTS "UserFeedback_createdAt_idx" ON "UserFeedback"("createdAt");

CREATE TABLE IF NOT EXISTS "RagTrace" (
  "id" TEXT NOT NULL,
  "chatId" TEXT,
  "question" TEXT NOT NULL,
  "normalizedQuestion" TEXT,
  "intent" TEXT,
  "source" TEXT,
  "confidenceScore" DOUBLE PRECISION,
  "confidenceTier" TEXT,
  "routeStage" TEXT,
  "selectedContextCount" INTEGER NOT NULL DEFAULT 0,
  "topSources" JSONB,
  "debug" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RagTrace_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "RagTrace_chatId_idx" ON "RagTrace"("chatId");
CREATE INDEX IF NOT EXISTS "RagTrace_source_idx" ON "RagTrace"("source");
CREATE INDEX IF NOT EXISTS "RagTrace_intent_idx" ON "RagTrace"("intent");
CREATE INDEX IF NOT EXISTS "RagTrace_createdAt_idx" ON "RagTrace"("createdAt");
