import { JobStatus, ResponseStatus } from "@/generated/prisma/client";
import { getBoss } from "@/lib/jobs/boss";
import { RESPONSE_NOTIFICATION_QUEUE } from "@/lib/jobs/queues";
import {
  RESPONSE_NOTIFICATION_RETRY_BATCH_SIZE,
  getResponseNotificationRetryWindow,
  shouldRetryResponseNotification,
} from "@/lib/jobs/notification-retry-policy";
import { prisma } from "@/lib/prisma";

function isRetryableJobStatus(status: JobStatus) {
  return status === JobStatus.PENDING || status === JobStatus.FAILED;
}

export async function retryStaleResponseNotifications(now = new Date()) {
  const { staleBefore, startedAfter } = getResponseNotificationRetryWindow(now);
  const candidates = await prisma.responseSession.findMany({
    where: {
      status: {
        in: [ResponseStatus.COMPLETED, ResponseStatus.PARTIAL, ResponseStatus.TIMED_OUT],
      },
      startedAt: {
        gte: startedAfter,
      },
      updatedAt: {
        lt: staleBefore,
      },
      OR: [
        {
          aiStatus: {
            in: [JobStatus.PENDING, JobStatus.FAILED],
          },
        },
        {
          telegramStatus: {
            in: [JobStatus.PENDING, JobStatus.FAILED],
          },
        },
      ],
    },
    orderBy: {
      updatedAt: "asc",
    },
    take: RESPONSE_NOTIFICATION_RETRY_BATCH_SIZE,
    include: {
      survey: {
        include: {
          aiAnalysisRule: true,
          notificationConfig: true,
        },
      },
    },
  });

  const retryableCandidates = candidates.filter((candidate) => {
    const aiEnabled = Boolean(candidate.survey.aiAnalysisRule?.enabled && candidate.survey.aiAnalysisRule.prompt.trim());
    const telegramEnabled = Boolean(candidate.survey.notificationConfig?.telegramEnabled);

    return shouldRetryResponseNotification(
      {
        status: candidate.status,
        updatedAt: candidate.updatedAt,
        aiStatus: candidate.aiStatus,
        telegramStatus: candidate.telegramStatus,
        aiEnabled,
        telegramEnabled,
      },
      now,
    );
  });

  if (!retryableCandidates.length) {
    return {
      count: 0,
      ids: [] as string[],
    };
  }

  const boss = await getBoss();
  const ids: string[] = [];

  for (const candidate of retryableCandidates) {
    const aiEnabled = Boolean(candidate.survey.aiAnalysisRule?.enabled && candidate.survey.aiAnalysisRule.prompt.trim());
    const telegramEnabled = Boolean(candidate.survey.notificationConfig?.telegramEnabled);
    const aiNeedsRetry = aiEnabled && isRetryableJobStatus(candidate.aiStatus);
    const telegramNeedsRetry = telegramEnabled && isRetryableJobStatus(candidate.telegramStatus);

    await prisma.responseSession.update({
      where: {
        id: candidate.id,
      },
      data: {
        aiStatus: aiEnabled ? (aiNeedsRetry ? JobStatus.PENDING : candidate.aiStatus) : JobStatus.SKIPPED,
        telegramStatus: telegramEnabled
          ? candidate.telegramStatus === JobStatus.SUCCESS
            ? JobStatus.SUCCESS
            : telegramNeedsRetry || aiNeedsRetry
              ? JobStatus.PENDING
              : candidate.telegramStatus
          : JobStatus.SKIPPED,
      },
    });
    await boss.send(RESPONSE_NOTIFICATION_QUEUE, {
      sessionId: candidate.id,
    });
    ids.push(candidate.id);
  }

  return {
    count: ids.length,
    ids,
  };
}
