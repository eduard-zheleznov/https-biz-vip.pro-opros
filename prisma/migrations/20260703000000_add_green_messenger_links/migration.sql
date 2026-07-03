ALTER TABLE "AiAnalysisRule"
  ADD COLUMN "completionGreenMaxUrl" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "completionGreenTelegramUrl" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "completionGreenWhatsappUrl" TEXT NOT NULL DEFAULT '';
