import { describe, expect, it } from "vitest";

import { JobStatus, ResponseStatus } from "@/generated/prisma/client";
import { RESPONSE_NOTIFICATION_RETRY_STALE_MS, shouldRetryResponseNotification } from "@/lib/jobs/notification-retry-policy";

const now = new Date("2026-07-07T12:00:00.000Z");
const staleUpdatedAt = new Date(now.getTime() - RESPONSE_NOTIFICATION_RETRY_STALE_MS - 1000);
const recentUpdatedAt = new Date(now.getTime() - RESPONSE_NOTIFICATION_RETRY_STALE_MS + 1000);

describe("response notification retry policy", () => {
  it("retries a failed AI analysis even when Telegram was skipped by the missing AI color", () => {
    expect(
      shouldRetryResponseNotification(
        {
          status: ResponseStatus.COMPLETED,
          updatedAt: staleUpdatedAt,
          aiStatus: JobStatus.FAILED,
          telegramStatus: JobStatus.SKIPPED,
          aiEnabled: true,
          telegramEnabled: true,
        },
        now,
      ),
    ).toBe(true);
  });

  it("does not retry a successfully evaluated response that was intentionally filtered out of Telegram", () => {
    expect(
      shouldRetryResponseNotification(
        {
          status: ResponseStatus.COMPLETED,
          updatedAt: staleUpdatedAt,
          aiStatus: JobStatus.SUCCESS,
          telegramStatus: JobStatus.SKIPPED,
          aiEnabled: true,
          telegramEnabled: true,
        },
        now,
      ),
    ).toBe(false);
  });

  it("retries failed Telegram delivery after AI has already succeeded", () => {
    expect(
      shouldRetryResponseNotification(
        {
          status: ResponseStatus.COMPLETED,
          updatedAt: staleUpdatedAt,
          aiStatus: JobStatus.SUCCESS,
          telegramStatus: JobStatus.FAILED,
          aiEnabled: true,
          telegramEnabled: true,
        },
        now,
      ),
    ).toBe(true);
  });

  it("waits for the stale interval before retrying a recent failure", () => {
    expect(
      shouldRetryResponseNotification(
        {
          status: ResponseStatus.COMPLETED,
          updatedAt: recentUpdatedAt,
          aiStatus: JobStatus.FAILED,
          telegramStatus: JobStatus.SKIPPED,
          aiEnabled: true,
          telegramEnabled: true,
        },
        now,
      ),
    ).toBe(false);
  });

  it("does not retry unfinished responses", () => {
    expect(
      shouldRetryResponseNotification(
        {
          status: ResponseStatus.IN_PROGRESS,
          updatedAt: staleUpdatedAt,
          aiStatus: JobStatus.FAILED,
          telegramStatus: JobStatus.FAILED,
          aiEnabled: true,
          telegramEnabled: true,
        },
        now,
      ),
    ).toBe(false);
  });
});
