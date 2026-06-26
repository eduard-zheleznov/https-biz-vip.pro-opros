import "@/jobs/load-env";

import { buildResultCopyText, inferAiScoreSummary } from "@/lib/results";
import { analyzeSurveyResult } from "@/lib/integrations/openai";
import { sendTelegramMessage } from "@/lib/integrations/telegram";
import { UserRole, UserStatus } from "@/generated/prisma/client";
import {
  buildAnswersTextForResponse,
  finalizeDueTimedOutResponseSessions,
  finalizeTimedOutResponseSession,
  purgeArchivedSurveys,
} from "@/lib/data";
import { deleteStoredFile } from "@/lib/storage";
import { prisma } from "@/lib/prisma";
import { getBoss } from "@/lib/jobs/boss";
import { ARCHIVE_PURGE_QUEUE, RESPONSE_NOTIFICATION_QUEUE, RESPONSE_TIMEOUT_QUEUE } from "@/lib/jobs/queues";
import { decryptSecret } from "@/lib/secrets";

async function run() {
  const boss = await getBoss();

  await boss.work(RESPONSE_TIMEOUT_QUEUE, async ([job]) => {
    const payload = (job.data ?? {}) as { sessionId?: string };

    if (payload.sessionId) {
      await finalizeTimedOutResponseSession(payload.sessionId);
      return;
    }

    await finalizeDueTimedOutResponseSessions();
  });

  await boss.work(RESPONSE_NOTIFICATION_QUEUE, async ([job]) => {
    const payload = (job.data ?? {}) as { sessionId?: string };
    const sessionId = payload.sessionId;
    if (!sessionId) {
      return;
    }

    const {
      response,
      answersText,
      configuredMaxScore,
      displayTotalScore,
      maxScore,
      answerPromptOverrides,
      includeAnswerScores,
    } = await buildAnswersTextForResponse(sessionId);
    const survey = await prisma.survey.findUniqueOrThrow({
      where: { id: response.surveyId },
      include: {
        owner: {
          include: {
            telegramConnection: true,
          },
        },
        permissions: {
          where: { canResults: true },
          include: {
            user: {
              include: {
                telegramConnection: true,
              },
            },
          },
        },
        notificationConfig: {
          include: {
            telegramRecipient: {
              include: {
                telegramConnection: true,
              },
            },
          },
        },
        aiAnalysisRule: true,
      },
    });

    let aiNote: string | null = response.aiNote;
    const aiRule = survey.aiAnalysisRule;
    const aiEnabled = Boolean(aiRule?.enabled && aiRule.prompt.trim());
    let chatId = "";
    if (survey.notificationConfig?.telegramEnabled) {
      const overrideChatIds = [
        ...(survey.notificationConfig.telegramChatIdOverrides ?? []),
        survey.notificationConfig.telegramChatIdOverride,
      ]
        .map((candidateChatId) => candidateChatId?.trim() ?? "")
        .filter(Boolean);
      const legacyRecipientUserIds = survey.notificationConfig.telegramRecipientUserIds ?? [];
      const legacyRecipientUsers = legacyRecipientUserIds.length
        ? await prisma.user.findMany({
            where: { id: { in: legacyRecipientUserIds }, status: UserStatus.ACTIVE },
            include: { telegramConnection: true },
          })
        : [];
      const legacyRecipientUserById = new Map(legacyRecipientUsers.map((user) => [user.id, user]));
      const configuredChatIds = [
        ...legacyRecipientUserIds.map((userId) => legacyRecipientUserById.get(userId)?.telegramConnection?.chatId),
        survey.notificationConfig.telegramRecipient?.telegramConnection?.chatId,
      ]
        .map((candidateChatId) => candidateChatId?.trim() ?? "")
        .filter(Boolean);
      const adminUsers = !configuredChatIds.length
        ? await prisma.user.findMany({
            where: { role: UserRole.ADMIN, status: UserStatus.ACTIVE },
            include: { telegramConnection: true },
          })
        : [];
      const fallbackChatIds = [
        survey.owner.telegramConnection?.chatId,
        ...survey.permissions.map((permission) =>
          permission.user.status === UserStatus.ACTIVE ? permission.user.telegramConnection?.chatId : null,
        ),
        ...adminUsers.map((user) => user.telegramConnection?.chatId),
      ]
        .map((candidateChatId) => candidateChatId?.trim() ?? "")
        .filter(Boolean);
      const chatIds = Array.from(
        new Set(
          overrideChatIds.length ? overrideChatIds : configuredChatIds.length ? configuredChatIds : fallbackChatIds,
        ),
      ).filter(Boolean);
      chatId = chatIds.join("\n");
    }
    let aiStatus: "PENDING" | "SUCCESS" | "FAILED" | "SKIPPED" = response.aiStatus;
    let telegramStatus: "PENDING" | "SUCCESS" | "FAILED" | "SKIPPED" = response.telegramStatus;

    if (aiEnabled && response.aiStatus === "SUCCESS" && aiNote) {
      aiStatus = "SUCCESS";
    } else if (aiEnabled) {
      try {
        aiNote = await analyzeSurveyResult({
          surveyTitle: survey.title,
          totalScore: response.totalScore,
          maxScore,
          answersText,
          prompt: aiRule!.prompt,
          provider: aiRule!.provider,
          apiKey: decryptSecret(aiRule!.apiKeyEncrypted),
          model: aiRule!.model,
        });

        await prisma.responseSession.update({
          where: { id: response.id },
          data: {
            aiNote,
            aiStatus: aiNote ? "SUCCESS" : "SKIPPED",
          },
        });
        aiStatus = aiNote ? "SUCCESS" : "SKIPPED";
      } catch (error) {
        console.error("AI analysis failed", error);
        await prisma.responseSession.update({
          where: { id: response.id },
          data: {
            aiStatus: "FAILED",
          },
        });
        aiStatus = "FAILED";
      }
    } else {
      await prisma.responseSession.update({
        where: { id: response.id },
        data: {
          aiStatus: "SKIPPED",
        },
      });
      aiStatus = "SKIPPED";
    }

    if (survey.notificationConfig?.telegramEnabled) {
      if (chatId) {
        try {
          const aiScoreSummary = inferAiScoreSummary(aiNote, maxScore);
          const totalScore = configuredMaxScore > 0 ? response.totalScore : (aiScoreSummary?.totalScore ?? displayTotalScore);
          const includeScore = configuredMaxScore > 0;

          await sendTelegramMessage(
            chatId,
            buildResultCopyText({
              surveyTitle: survey.title,
              status: response.status,
              totalScore,
              maxScore,
              startedAt: response.startedAt,
              completedAt: response.completedAt,
              answers: response.answers,
              aiNote,
              answerPromptOverrides,
              includeScore,
              includeAnswerScores,
              emptyAiNoteLabel:
                aiEnabled && aiStatus === "FAILED"
                  ? "Ошибка AI-анализа"
                  : aiEnabled
                    ? "AI не вернул итог"
                    : "Не выполнялся",
            }),
          );

          telegramStatus = "SUCCESS";
          await prisma.responseSession.update({
            where: { id: response.id },
            data: {
              telegramStatus,
            },
          });
        } catch (error) {
          console.error("Telegram delivery failed", error);
          telegramStatus = "FAILED";
          await prisma.responseSession.update({
            where: { id: response.id },
            data: {
              telegramStatus,
            },
          });
        }
      } else {
        telegramStatus = "SKIPPED";
        await prisma.responseSession.update({
          where: { id: response.id },
          data: {
            telegramStatus,
          },
        });
      }
    } else {
      telegramStatus = "SKIPPED";
      await prisma.responseSession.update({
        where: { id: response.id },
        data: {
          telegramStatus,
        },
      });
    }
  });

  await boss.work(ARCHIVE_PURGE_QUEUE, async () => {
    const expiredSurveys = await purgeArchivedSurveys();

    for (const survey of expiredSurveys) {
      for (const asset of survey.mediaAssets) {
        await deleteStoredFile(asset.storagePath);
      }

      await prisma.survey.delete({
        where: { id: survey.id },
      });
    }
  });

  console.info("Worker is running.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
