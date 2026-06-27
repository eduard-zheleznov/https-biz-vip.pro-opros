ALTER TABLE "NotificationConfig"
  ADD COLUMN "telegramAiFilterEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "telegramAiAllowedColors" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "AiAnalysisRule"
  ADD COLUMN "completionRoutingEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "completionProcessingTitle" TEXT NOT NULL DEFAULT 'Ваши ответы обрабатываются',
  ADD COLUMN "completionProcessingMessage" TEXT NOT NULL DEFAULT 'Подождите совсем чуть-чуть. Мы анализируем ответы и подбираем следующий шаг.',
  ADD COLUMN "completionGreenTitle" TEXT NOT NULL DEFAULT 'Поздравляем, вы нам подходите',
  ADD COLUMN "completionGreenMessage" TEXT NOT NULL DEFAULT 'Напишите руководителю, и он подберёт удобное время для общения.',
  ADD COLUMN "completionYellowTitle" TEXT NOT NULL DEFAULT 'Спасибо за ваши ответы',
  ADD COLUMN "completionYellowMessage" TEXT NOT NULL DEFAULT 'Ваши ответы зафиксированы. При необходимости мы с вами свяжемся.',
  ADD COLUMN "completionRedTitle" TEXT NOT NULL DEFAULT 'Спасибо за ваши ответы',
  ADD COLUMN "completionRedMessage" TEXT NOT NULL DEFAULT 'Ваши ответы зафиксированы. При необходимости мы с вами свяжемся.',
  ADD COLUMN "completionFallbackTitle" TEXT NOT NULL DEFAULT 'Спасибо за ваши ответы',
  ADD COLUMN "completionFallbackMessage" TEXT NOT NULL DEFAULT 'Ваши ответы зафиксированы. При необходимости мы с вами свяжемся.';

ALTER TABLE "ResponseSession"
  ADD COLUMN "aiResultColor" TEXT;
