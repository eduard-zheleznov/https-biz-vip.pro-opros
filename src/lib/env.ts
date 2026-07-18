import { z } from "zod";

import { DEFAULT_MEMBER_PASSWORD } from "@/lib/defaults";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  SESSION_COOKIE_NAME: z.string().min(1).default("survey_builder_session"),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(14),
  SESSION_SECRET: z.string().min(32),
  APP_URL: z.string().url(),
  UPLOAD_DIR: z.string().min(1),
  DEFAULT_ADMIN_EMAIL: z.string().email(),
  DEFAULT_ADMIN_PASSWORD: z.string().min(8),
  DEFAULT_MEMBER_PASSWORD: z.string().min(8).optional().default(DEFAULT_MEMBER_PASSWORD),
  OPENAI_API_KEY: z.string().optional().default(""),
  OPENAI_MODEL: z.string().optional().default("gpt-5.2"),
  OPENROUTER_API_KEY: z.string().optional().default(""),
  OPENROUTER_MODEL: z.string().optional().default("openai/gpt-4.1-mini"),
  OPENROUTER_BASE_URL: z.string().optional().default(""),
  TELEGRAM_BOT_TOKEN: z.string().optional().default(""),
  TELEGRAM_API_BASE_URL: z.string().url().optional().default("https://api.telegram.org"),
});

export const env = envSchema.parse({
  DATABASE_URL: process.env.DATABASE_URL,
  SESSION_COOKIE_NAME: process.env.SESSION_COOKIE_NAME,
  SESSION_TTL_DAYS: process.env.SESSION_TTL_DAYS,
  SESSION_SECRET: process.env.SESSION_SECRET,
  APP_URL: process.env.APP_URL,
  UPLOAD_DIR: process.env.UPLOAD_DIR,
  DEFAULT_ADMIN_EMAIL: process.env.DEFAULT_ADMIN_EMAIL,
  DEFAULT_ADMIN_PASSWORD: process.env.DEFAULT_ADMIN_PASSWORD,
  DEFAULT_MEMBER_PASSWORD: process.env.DEFAULT_MEMBER_PASSWORD,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENROUTER_MODEL: process.env.OPENROUTER_MODEL,
  OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_API_BASE_URL: process.env.TELEGRAM_API_BASE_URL,
});
