-- Create enums
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MEMBER');
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INVITED', 'DELETED');
CREATE TYPE "SurveyLifecycleStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "SurveyFolderKey" AS ENUM ('MY_SURVEYS', 'CUSTOM', 'RESTORED', 'ARCHIVE');
CREATE TYPE "BlockType" AS ENUM (
  'WELCOME',
  'CONTACT',
  'SINGLE_CHOICE',
  'MULTI_CHOICE',
  'MEDIA_CHOICE',
  'YES_NO',
  'DROPDOWN',
  'RATING',
  'RANKING',
  'SCALE',
  'SLIDER',
  'TEXT'
);
CREATE TYPE "ResponseStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'PARTIAL', 'TIMED_OUT');
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'SKIPPED');
CREATE TYPE "TelegramConnectionStatus" AS ENUM ('PENDING', 'ACTIVE', 'DISCONNECTED');

-- Create tables
CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT,
  "displayName" TEXT,
  "role" "UserRole" NOT NULL DEFAULT 'MEMBER',
  "status" "UserStatus" NOT NULL DEFAULT 'INVITED',
  "forcePasswordChange" BOOLEAN NOT NULL DEFAULT true,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Session" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Invitation" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "invitedById" TEXT NOT NULL,
  "createdUserId" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Folder" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Folder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Survey" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL DEFAULT 'Новый опрос',
  "description" TEXT NOT NULL DEFAULT '',
  "ownerId" TEXT NOT NULL,
  "currentVersionId" TEXT,
  "publishedVersionId" TEXT,
  "folderId" TEXT,
  "folderKey" "SurveyFolderKey" NOT NULL DEFAULT 'MY_SURVEYS',
  "lifecycleStatus" "SurveyLifecycleStatus" NOT NULL DEFAULT 'DRAFT',
  "publicSlug" TEXT NOT NULL,
  "language" TEXT NOT NULL DEFAULT 'ru',
  "autoScrollEnabled" BOOLEAN NOT NULL DEFAULT true,
  "timerEnabled" BOOLEAN NOT NULL DEFAULT false,
  "timerSeconds" INTEGER,
  "historyEnabled" BOOLEAN NOT NULL DEFAULT true,
  "publishedAt" TIMESTAMP(3),
  "archivedAt" TIMESTAMP(3),
  "purgeAt" TIMESTAMP(3),
  "lastVersionNumber" INTEGER NOT NULL DEFAULT 0,
  "completionMessage" TEXT NOT NULL DEFAULT 'Спасибо за опрос!',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Survey_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SurveyVersion" (
  "id" TEXT NOT NULL,
  "surveyId" TEXT NOT NULL,
  "versionNumber" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "schema" JSONB NOT NULL,
  "changeSummary" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SurveyVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SurveyPermission" (
  "id" TEXT NOT NULL,
  "surveyId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "canView" BOOLEAN NOT NULL DEFAULT false,
  "canCreate" BOOLEAN NOT NULL DEFAULT false,
  "canEdit" BOOLEAN NOT NULL DEFAULT false,
  "canDelete" BOOLEAN NOT NULL DEFAULT false,
  "canResults" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SurveyPermission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationConfig" (
  "id" TEXT NOT NULL,
  "surveyId" TEXT NOT NULL,
  "telegramEnabled" BOOLEAN NOT NULL DEFAULT false,
  "telegramRecipientUserId" TEXT,
  "telegramChatIdOverride" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TelegramConnection" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "username" TEXT,
  "chatId" TEXT,
  "status" "TelegramConnectionStatus" NOT NULL DEFAULT 'PENDING',
  "activatedAt" TIMESTAMP(3),
  "lastCheckAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TelegramConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiAnalysisRule" (
  "id" TEXT NOT NULL,
  "surveyId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "prompt" TEXT NOT NULL,
  "model" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiAnalysisRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ResponseSession" (
  "id" TEXT NOT NULL,
  "surveyId" TEXT NOT NULL,
  "surveyVersionId" TEXT,
  "respondentKey" TEXT NOT NULL,
  "status" "ResponseStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "timedOutAt" TIMESTAMP(3),
  "lastBlockId" TEXT,
  "respondentData" JSONB,
  "totalScore" INTEGER NOT NULL DEFAULT 0,
  "aiNote" TEXT,
  "aiStatus" "JobStatus" NOT NULL DEFAULT 'PENDING',
  "telegramStatus" "JobStatus" NOT NULL DEFAULT 'PENDING',
  CONSTRAINT "ResponseSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ResponseAnswer" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "blockId" TEXT NOT NULL,
  "blockType" "BlockType" NOT NULL,
  "prompt" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "score" INTEGER NOT NULL DEFAULT 0,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ResponseAnswer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MediaAsset" (
  "id" TEXT NOT NULL,
  "surveyId" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "storagePath" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- Create indexes
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");
CREATE INDEX "Session_userId_expiresAt_idx" ON "Session"("userId", "expiresAt");
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");
CREATE UNIQUE INDEX "Invitation_createdUserId_key" ON "Invitation"("createdUserId");
CREATE INDEX "Invitation_email_idx" ON "Invitation"("email");
CREATE UNIQUE INDEX "Folder_slug_key" ON "Folder"("slug");
CREATE UNIQUE INDEX "Survey_currentVersionId_key" ON "Survey"("currentVersionId");
CREATE UNIQUE INDEX "Survey_publishedVersionId_key" ON "Survey"("publishedVersionId");
CREATE UNIQUE INDEX "Survey_publicSlug_key" ON "Survey"("publicSlug");
CREATE INDEX "Survey_ownerId_idx" ON "Survey"("ownerId");
CREATE INDEX "Survey_lifecycleStatus_folderKey_idx" ON "Survey"("lifecycleStatus", "folderKey");
CREATE UNIQUE INDEX "SurveyVersion_surveyId_versionNumber_key" ON "SurveyVersion"("surveyId", "versionNumber");
CREATE INDEX "SurveyVersion_surveyId_createdAt_idx" ON "SurveyVersion"("surveyId", "createdAt");
CREATE UNIQUE INDEX "SurveyPermission_surveyId_userId_key" ON "SurveyPermission"("surveyId", "userId");
CREATE UNIQUE INDEX "NotificationConfig_surveyId_key" ON "NotificationConfig"("surveyId");
CREATE UNIQUE INDEX "TelegramConnection_userId_key" ON "TelegramConnection"("userId");
CREATE UNIQUE INDEX "AiAnalysisRule_surveyId_key" ON "AiAnalysisRule"("surveyId");
CREATE INDEX "ResponseSession_surveyId_status_startedAt_idx" ON "ResponseSession"("surveyId", "status", "startedAt");
CREATE INDEX "ResponseSession_respondentKey_idx" ON "ResponseSession"("respondentKey");
CREATE UNIQUE INDEX "ResponseAnswer_sessionId_blockId_key" ON "ResponseAnswer"("sessionId", "blockId");
CREATE INDEX "ResponseAnswer_sessionId_sortOrder_idx" ON "ResponseAnswer"("sessionId", "sortOrder");
CREATE UNIQUE INDEX "MediaAsset_storagePath_key" ON "MediaAsset"("storagePath");
CREATE INDEX "MediaAsset_surveyId_createdAt_idx" ON "MediaAsset"("surveyId", "createdAt");

-- Add foreign keys
ALTER TABLE "Session"
  ADD CONSTRAINT "Session_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Invitation"
  ADD CONSTRAINT "Invitation_invitedById_fkey"
  FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Invitation"
  ADD CONSTRAINT "Invitation_createdUserId_fkey"
  FOREIGN KEY ("createdUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Folder"
  ADD CONSTRAINT "Folder_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Survey"
  ADD CONSTRAINT "Survey_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Survey"
  ADD CONSTRAINT "Survey_folderId_fkey"
  FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SurveyVersion"
  ADD CONSTRAINT "SurveyVersion_surveyId_fkey"
  FOREIGN KEY ("surveyId") REFERENCES "Survey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SurveyVersion"
  ADD CONSTRAINT "SurveyVersion_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Survey"
  ADD CONSTRAINT "Survey_currentVersionId_fkey"
  FOREIGN KEY ("currentVersionId") REFERENCES "SurveyVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Survey"
  ADD CONSTRAINT "Survey_publishedVersionId_fkey"
  FOREIGN KEY ("publishedVersionId") REFERENCES "SurveyVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SurveyPermission"
  ADD CONSTRAINT "SurveyPermission_surveyId_fkey"
  FOREIGN KEY ("surveyId") REFERENCES "Survey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SurveyPermission"
  ADD CONSTRAINT "SurveyPermission_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificationConfig"
  ADD CONSTRAINT "NotificationConfig_surveyId_fkey"
  FOREIGN KEY ("surveyId") REFERENCES "Survey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificationConfig"
  ADD CONSTRAINT "NotificationConfig_telegramRecipientUserId_fkey"
  FOREIGN KEY ("telegramRecipientUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TelegramConnection"
  ADD CONSTRAINT "TelegramConnection_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiAnalysisRule"
  ADD CONSTRAINT "AiAnalysisRule_surveyId_fkey"
  FOREIGN KEY ("surveyId") REFERENCES "Survey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ResponseSession"
  ADD CONSTRAINT "ResponseSession_surveyId_fkey"
  FOREIGN KEY ("surveyId") REFERENCES "Survey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ResponseSession"
  ADD CONSTRAINT "ResponseSession_surveyVersionId_fkey"
  FOREIGN KEY ("surveyVersionId") REFERENCES "SurveyVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ResponseAnswer"
  ADD CONSTRAINT "ResponseAnswer_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "ResponseSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MediaAsset"
  ADD CONSTRAINT "MediaAsset_surveyId_fkey"
  FOREIGN KEY ("surveyId") REFERENCES "Survey"("id") ON DELETE CASCADE ON UPDATE CASCADE;
