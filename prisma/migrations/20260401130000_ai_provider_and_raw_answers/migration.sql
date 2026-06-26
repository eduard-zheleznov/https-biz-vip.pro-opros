CREATE TYPE "AiProvider" AS ENUM ('OPENAI', 'OPENROUTER');

ALTER TABLE "AiAnalysisRule"
ADD COLUMN "provider" "AiProvider" NOT NULL DEFAULT 'OPENAI',
ADD COLUMN "apiKeyEncrypted" TEXT,
ADD COLUMN "apiKeyLastFour" TEXT;

ALTER TABLE "ResponseAnswer"
ADD COLUMN "rawValue" JSONB;
