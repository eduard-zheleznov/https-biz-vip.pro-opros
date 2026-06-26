ALTER TABLE "NotificationConfig"
  ADD COLUMN "telegramRecipientUserIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "telegramChatIdOverrides" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "NotificationConfig"
SET
  "telegramRecipientUserIds" = CASE
    WHEN "telegramRecipientUserId" IS NULL OR btrim("telegramRecipientUserId") = '' THEN ARRAY[]::TEXT[]
    ELSE ARRAY["telegramRecipientUserId"]
  END,
  "telegramChatIdOverrides" = CASE
    WHEN "telegramChatIdOverride" IS NULL OR btrim("telegramChatIdOverride") = '' THEN ARRAY[]::TEXT[]
    ELSE ARRAY["telegramChatIdOverride"]
  END;
