# AI Zone Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional per-survey AI color routing for Telegram notifications and respondent completion screens.

**Architecture:** Store the new per-survey settings in `NotificationConfig` and `AiAnalysisRule`, store parsed AI color on `ResponseSession`, and reuse the existing background worker as the single place where AI analysis and Telegram delivery are decided. Render `/done` through a small client component only when AI completion routing is enabled.

**Tech Stack:** Next.js App Router, React Server/Client Components, Prisma/PostgreSQL, pg-boss worker, Vitest, Tailwind CSS.

---

### Task 1: AI Color Helpers

**Files:**
- Modify: `src/lib/results.ts`
- Modify: `src/lib/results.test.ts`

- [ ] Write failing tests that `extractAiResultColor` recognizes Russian fields, object-like notes, loose text, and emojis.
- [ ] Write failing tests that `shouldSendTelegramForAiResult` keeps current behavior when filtering is off, sends only selected colors when filtering is on, and skips unknown colors.
- [ ] Implement exported helpers in `src/lib/results.ts`.
- [ ] Run `npm test -- src/lib/results.test.ts`.

### Task 2: Database Schema

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260627170000_ai_zone_routing/migration.sql`

- [ ] Add fields to `NotificationConfig`, `AiAnalysisRule`, and `ResponseSession`.
- [ ] Add SQL migration with safe defaults and nullable response color.
- [ ] Run `npm run db:generate`.
- [ ] Run type check via `DEFAULT_MEMBER_PASSWORD=12345678 npm run build`.

### Task 3: Settings Persistence

**Files:**
- Modify: `src/lib/data.ts`
- Modify: `src/app/app/surveys/[surveyId]/page.tsx`

- [ ] Extend `updateSurveySettings` input with Telegram AI filter and completion routing fields.
- [ ] Normalize selected colors; if filter is enabled with no colors, save `GREEN`.
- [ ] Validate completion routing requires enabled AI with a usable prompt/key.
- [ ] Add admin settings controls with safe defaults.
- [ ] Run targeted tests and build.

### Task 4: Worker Routing

**Files:**
- Modify: `src/jobs/worker.ts`
- Modify: `src/lib/data.ts`

- [ ] Parse and save `aiResultColor` whenever AI analysis succeeds or uses an existing note.
- [ ] Apply Telegram filter after AI analysis and before sending.
- [ ] Keep response saving and AI note saving independent from Telegram filtering.
- [ ] Ensure retry Telegram uses the latest filter settings.
- [ ] Run full tests.

### Task 5: Completion Screen

**Files:**
- Create: `src/components/survey/public-completion.tsx`
- Create: `src/app/api/responses/[surveyId]/completion/route.ts`
- Modify: `src/app/s/[slug]/done/page.tsx`
- Modify: `src/lib/data.ts`

- [ ] Add public completion state function that reads the respondent cookie and returns processing/final text.
- [ ] Add polling API endpoint.
- [ ] Replace static done card with a client component when routing is enabled.
- [ ] Keep existing static completion page when routing is disabled.
- [ ] Add smooth loading animation and responsive layout.

### Task 6: Verification and Deployment

**Files:**
- Modify as needed after QA.

- [ ] Run `npm test`.
- [ ] Run `npm run lint`.
- [ ] Run `DEFAULT_MEMBER_PASSWORD=12345678 npm run build`.
- [ ] Verify admin settings UI with Playwright.
- [ ] Deploy via staging archive, preserving `.env`, uploads, database, and existing API keys.
- [ ] Verify production services, public survey URL, and database counts.
