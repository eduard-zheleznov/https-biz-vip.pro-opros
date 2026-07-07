import { JobStatus, ResponseStatus } from "@/generated/prisma/client";

export const RESPONSE_NOTIFICATION_RETRY_BATCH_SIZE = 25;
export const RESPONSE_NOTIFICATION_RETRY_STALE_MS = 2 * 60 * 1000;
export const RESPONSE_NOTIFICATION_RETRY_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;

type RetryableJobStatus = typeof JobStatus.PENDING | typeof JobStatus.FAILED;

export type ResponseNotificationRetryCandidate = {
  status: ResponseStatus;
  updatedAt: Date;
  aiStatus: JobStatus;
  telegramStatus: JobStatus;
  aiEnabled: boolean;
  telegramEnabled: boolean;
};

export function getResponseNotificationRetryWindow(now = new Date()) {
  return {
    staleBefore: new Date(now.getTime() - RESPONSE_NOTIFICATION_RETRY_STALE_MS),
    startedAfter: new Date(now.getTime() - RESPONSE_NOTIFICATION_RETRY_LOOKBACK_MS),
  };
}

function isRetryableJobStatus(status: JobStatus): status is RetryableJobStatus {
  return status === JobStatus.PENDING || status === JobStatus.FAILED;
}

export function shouldRetryResponseNotification(candidate: ResponseNotificationRetryCandidate, now = new Date()) {
  if (candidate.status === ResponseStatus.IN_PROGRESS) {
    return false;
  }

  const { staleBefore } = getResponseNotificationRetryWindow(now);
  if (candidate.updatedAt > staleBefore) {
    return false;
  }

  const shouldRetryAi = candidate.aiEnabled && isRetryableJobStatus(candidate.aiStatus);
  const shouldRetryTelegram = candidate.telegramEnabled && isRetryableJobStatus(candidate.telegramStatus);

  return shouldRetryAi || shouldRetryTelegram;
}
