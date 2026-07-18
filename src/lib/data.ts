import { createHash } from "node:crypto";

import bcrypt from "bcryptjs";
import { addDays } from "date-fns";
import ExcelJS from "exceljs";
import mammoth from "mammoth";
import { nanoid } from "nanoid";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PDFParse } from "pdf-parse";

import {
  AiProvider,
  BlockType,
  JobStatus,
  ResponseStatus,
  SurveyFolderKey,
  SurveyLifecycleStatus,
  UserRole,
  UserStatus,
  type Prisma,
} from "@/generated/prisma/client";
import { withBasePath } from "@/lib/base-path";
import { env } from "@/lib/env";
import {
  DEFAULT_AI_COMPLETION_COPY,
  buildResultCopyText,
  buildResultPromptOverrides,
  calculateScorePercent,
  extractAiResultColor,
  extractSurveyAnalysisMaxScore,
  inferAiScoreSummary,
  normalizeAiResultColors,
  resolveAiCompletionContent,
  type AiCompletionCopy,
} from "@/lib/results";
import { buildUniquePublicSlug, normalizePublicSlugInput } from "@/lib/public-slug";
import { RESPONSE_NOTIFICATION_QUEUE, RESPONSE_TIMEOUT_QUEUE } from "@/lib/jobs/queues";
import { getBoss } from "@/lib/jobs/boss";
import {
  canManageParticipantsByPermission,
  getSurveyAbilities,
  hasAnySurveyAbility,
  hasSurveyAbility,
  type SurveyAbility,
} from "@/lib/permissions";
import { extractAiNoteColor, generateSurveyDraftFromPrompt, transcribeVoiceAnswer } from "@/lib/integrations/openai";
import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret, getSecretLastFour } from "@/lib/secrets";
import {
  calculateSurveyMaxScore,
  calculateSurveyQuestionMaxScore,
  coerceSurveyNavigationTargets,
  createBlock,
  createDefaultSurveySchema,
  evaluateAnswer,
  evaluateUnansweredAverageAnswer,
  isBlockAnswered,
  isCombinedTextBelowMinimum,
  isTextAnswerBelowMinimum,
  isFinishSurveyTarget,
  getNextSequentialBlockId,
  mapAnswersToRows,
  normalizeTextAnswerValue,
  normalizeSurveySchema,
  stringifyAnswerValue,
  validateSurveySchema,
} from "@/lib/survey-schema";
import type { AdditionalInfoItem, SurveyBlock, SurveySchema } from "@/types/surveys";
import { slugify } from "@/lib/utils";
import { resolveTelegramChatIdByUsername } from "@/lib/integrations/telegram";
import { deleteStoredFile, readStoredFile, saveUploadedFile } from "@/lib/storage";
import type { PublicCompletionMessengerLink, PublicCompletionState } from "@/types/public-completion";

const PUBLIC_RESPONSE_COOKIE_PREFIX = "survey_response_";
const MAX_EXTRACTED_ATTACHMENT_CHARS = 12000;
const MAX_EXTRACTED_ATTACHMENTS_TOTAL_CHARS = 30000;
const RESPONSE_TIMEOUT_CLIENT_GRACE_MS = 15000;
const MAX_MESSENGER_URL_LENGTH = 2000;
export const RESPONSE_TIMER_EXPIRED_MESSAGE = "Время прохождения истекло.";

const GREEN_MESSENGERS = [
  {
    id: "max",
    label: "MAX",
    field: "completionGreenMaxUrl",
    allowedProtocols: ["http:", "https:", "max:"],
  },
  {
    id: "telegram",
    label: "Telegram",
    field: "completionGreenTelegramUrl",
    allowedProtocols: ["http:", "https:", "tg:"],
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    field: "completionGreenWhatsappUrl",
    allowedProtocols: ["http:", "https:", "whatsapp:"],
  },
] as const;

type GreenMessengerField = (typeof GREEN_MESSENGERS)[number]["field"];
type GreenMessengerSource = Partial<Record<GreenMessengerField, string | null>>;

function ensureMessengerProtocol(value: string) {
  if (/^[a-z][a-z0-9+.-]*:/iu.test(value)) {
    return value;
  }

  if (/^(?:t\.me|telegram\.me|wa\.me|api\.whatsapp\.com|max\.ru|max\.com)\//iu.test(value)) {
    return `https://${value}`;
  }

  return value;
}

function normalizeMessengerUrl(
  value: string | null | undefined,
  config: (typeof GREEN_MESSENGERS)[number],
) {
  const normalized = ensureMessengerProtocol((value ?? "").trim()).slice(0, MAX_MESSENGER_URL_LENGTH);
  if (!normalized) {
    return "";
  }

  try {
    const url = new URL(normalized);
    if ((config.allowedProtocols as readonly string[]).includes(url.protocol)) {
      return normalized;
    }
  } catch {
    return "";
  }

  return "";
}

function buildGreenMessengerLinks(source: GreenMessengerSource | null | undefined): PublicCompletionMessengerLink[] {
  if (!source) {
    return [];
  }

  return GREEN_MESSENGERS.flatMap((config) => {
    const href = normalizeMessengerUrl(source[config.field], config);
    return href ? [{ id: config.id, label: config.label, href }] : [];
  });
}

export class ResponseTimerExpiredError extends Error {
  constructor() {
    super(RESPONSE_TIMER_EXPIRED_MESSAGE);
  }
}

const RETAKE_LINK_TTL_DAYS = 7;

async function isPublicSlugTaken(publicSlug: string, excludeSurveyId?: string) {
  const existing = await prisma.survey.findFirst({
    where: {
      publicSlug,
      ...(excludeSurveyId ? { id: { not: excludeSurveyId } } : {}),
    },
    select: { id: true },
  });

  return Boolean(existing);
}

function decryptOptionalSecret(payload: string | null | undefined) {
  try {
    return decryptSecret(payload);
  } catch {
    return null;
  }
}

function truncateExtractedText(value: string, limit = MAX_EXTRACTED_ATTACHMENT_CHARS) {
  const normalized = value.replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();

  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, limit).trim()}\n\n[Текст файла обрезан до ${limit} символов.]`;
}

function isTextLikeMimeType(mimeType: string) {
  return (
    mimeType.startsWith("text/") ||
    [
      "application/json",
      "application/xml",
      "application/csv",
      "application/x-ndjson",
      "application/javascript",
      "application/typescript",
    ].includes(mimeType)
  );
}

async function extractPdfText(buffer: Buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

async function extractSpreadsheetText(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const rows: string[] = [];

  workbook.eachSheet((sheet) => {
    rows.push(`Лист: ${sheet.name}`);
    sheet.eachRow((row) => {
      const values = row.values;
      if (!Array.isArray(values)) {
        return;
      }

      const text = values
        .slice(1)
        .map((cell) => {
          if (cell == null) {
            return "";
          }

          if (typeof cell === "object" && "text" in cell && typeof cell.text === "string") {
            return cell.text;
          }

          return String(cell);
        })
        .filter(Boolean)
        .join(" | ");

      if (text) {
        rows.push(text);
      }
    });
  });

  return rows.join("\n");
}

async function extractAttachmentText(asset: {
  id?: string;
  originalName: string;
  mimeType: string;
  storagePath: string;
}) {
  const mimeType = asset.mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
  const buffer = await readStoredFile(asset.storagePath);

  if (isTextLikeMimeType(mimeType)) {
    return buffer.toString("utf8");
  }

  if (mimeType === "application/pdf" || asset.originalName.toLowerCase().endsWith(".pdf")) {
    return extractPdfText(buffer);
  }

  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    asset.originalName.toLowerCase().endsWith(".docx")
  ) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    asset.originalName.toLowerCase().endsWith(".xlsx")
  ) {
    return extractSpreadsheetText(buffer);
  }

  return "";
}

async function buildExtractedAttachmentTexts(
  answers: Array<{
    blockType: string;
    prompt: string;
    rawValue: Prisma.JsonValue | null;
  }>,
) {
  const requestedAttachments: Array<{
    answerPrompt: string;
    id: string;
  }> = [];

  for (const answer of answers) {
    if (answer.blockType !== "TEXT") {
      continue;
    }

    const textAnswer = normalizeTextAnswerValue(answer.rawValue);
    for (const attachment of textAnswer.attachments) {
      if (attachment.kind === "file") {
        requestedAttachments.push({
          answerPrompt: answer.prompt,
          id: attachment.id,
        });
      }
    }
  }

  if (requestedAttachments.length === 0) {
    return "";
  }

  const assets = await prisma.mediaAsset.findMany({
    where: {
      id: {
        in: requestedAttachments.map((attachment) => attachment.id),
      },
    },
  });
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const blocks: string[] = [];
  let totalChars = 0;

  for (const requestedAttachment of requestedAttachments) {
    if (totalChars >= MAX_EXTRACTED_ATTACHMENTS_TOTAL_CHARS) {
      blocks.push(
        `[Часть файлов не добавлена в анализ: общий лимит извлеченного текста ${MAX_EXTRACTED_ATTACHMENTS_TOTAL_CHARS} символов.]`,
      );
      break;
    }

    const asset = assetsById.get(requestedAttachment.id);
    if (!asset) {
      blocks.push(
        [
          `Прикрепленный файл к вопросу "${requestedAttachment.answerPrompt}": файл не найден в хранилище.`,
          "Содержимое файла не удалось прочитать автоматически.",
        ].join("\n"),
      );
      continue;
    }

    try {
      const extractedText = truncateExtractedText(
        await extractAttachmentText({
          id: asset.id,
          originalName: asset.originalName,
          mimeType: asset.mimeType,
          storagePath: asset.storagePath,
        }),
      );
      const remainingChars = MAX_EXTRACTED_ATTACHMENTS_TOTAL_CHARS - totalChars;
      const textForAnalysis =
        extractedText.length > 0
          ? truncateExtractedText(extractedText, remainingChars)
          : "Содержимое файла не удалось прочитать автоматически или файл не содержит текстового слоя.";
      const block = [
        `Прикрепленный файл к вопросу "${requestedAttachment.answerPrompt}": ${asset.originalName}`,
        `Тип файла: ${asset.mimeType}`,
        "Содержимое файла для анализа:",
        textForAnalysis,
      ].join("\n");

      blocks.push(block);
      totalChars += textForAnalysis.length;
    } catch (error) {
      blocks.push(
        [
          `Прикрепленный файл к вопросу "${requestedAttachment.answerPrompt}": ${asset.originalName}`,
          `Тип файла: ${asset.mimeType}`,
          `Содержимое файла не удалось прочитать автоматически: ${
            error instanceof Error ? error.message : "ошибка чтения файла"
          }`,
        ].join("\n"),
      );
    }
  }

  return blocks.length > 0 ? ["Прикрепленные файлы:", ...blocks].join("\n\n") : "";
}

function hashToken(token: string) {
  return createHash("sha256").update(`${token}:${env.SESSION_SECRET}`).digest("hex");
}

function sessionCookieOptions(expiresAt: Date) {
  const secure = env.APP_URL.startsWith("https://");

  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    expires: expiresAt,
  };
}

function publicResponseCookieName(surveyId: string) {
  return `${PUBLIC_RESPONSE_COOKIE_PREFIX}${surveyId}`;
}

async function createSessionForUser(userId: string) {
  const token = nanoid(48);
  const tokenHash = hashToken(token);
  const expiresAt = addDays(new Date(), env.SESSION_TTL_DAYS);

  await prisma.session.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
    },
  });

  const cookieStore = await cookies();
  cookieStore.set(env.SESSION_COOKIE_NAME, token, sessionCookieOptions(expiresAt));
}

async function clearSessionCookie() {
  const cookieStore = await cookies();
  const token = cookieStore.get(env.SESSION_COOKIE_NAME)?.value;

  if (token) {
    await prisma.session.deleteMany({
      where: { tokenHash: hashToken(token) },
    });
  }

  cookieStore.set(env.SESSION_COOKIE_NAME, "", {
    ...sessionCookieOptions(new Date(0)),
    expires: new Date(0),
    maxAge: 0,
  });
  cookieStore.delete(env.SESSION_COOKIE_NAME);
}

async function revokeUserSessions(userId: string) {
  await prisma.session.deleteMany({
    where: { userId },
  });
}

async function getSessionRecord() {
  const cookieStore = await cookies();
  const token = cookieStore.get(env.SESSION_COOKIE_NAME)?.value;

  if (!token) {
    return null;
  }

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      user: true,
    },
  });

  if (!session || session.expiresAt < new Date() || session.user.status === UserStatus.DELETED) {
    return null;
  }

  await prisma.session.update({
    where: { id: session.id },
    data: { lastSeenAt: new Date() },
  });

  return session;
}

export async function getCurrentUser() {
  const session = await getSessionRecord();
  return session?.user ?? null;
}

export async function requireCurrentUser() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  return user;
}

export async function requireAdminUser() {
  const user = await requireCurrentUser();
  if (user.role !== UserRole.ADMIN) {
    redirect("/app");
  }

  return user;
}

async function getParticipantManagerScope(actorId: string) {
  const actor = await prisma.user.findUnique({
    where: { id: actorId },
    include: {
      permissions: true,
    },
  });

  if (!actor) {
    return null;
  }

  if (actor.role === UserRole.ADMIN) {
    return {
      actor,
      isAdmin: true,
      canManage: true,
      accessibleSurveyIds: [] as string[],
    };
  }

  const canManage = actor.permissions.some((permission) => permission.canCreate);
  const accessibleSurveyIds = Array.from(
    new Set(
      actor.permissions
        .filter(
          (permission) =>
            permission.canView || permission.canCreate || permission.canEdit || permission.canDelete || permission.canResults,
        )
        .map((permission) => permission.surveyId),
    ),
  );

  return {
    actor,
    isAdmin: false,
    canManage,
    accessibleSurveyIds,
  };
}

export async function canManageParticipants(actorId: string) {
  const scope = await getParticipantManagerScope(actorId);
  if (!scope) {
    return false;
  }

  if (scope.isAdmin) {
    return true;
  }

  return canManageParticipantsByPermission(
    scope.actor.permissions.find((permission) => permission.canCreate),
    actorId,
  );
}

export async function requireParticipantManagerUser() {
  const user = await requireCurrentUser();
  if (!(await canManageParticipants(user.id))) {
    redirect("/app");
  }

  return user;
}

export async function loginWithPassword(email: string, password: string) {
  const user = await prisma.user.findUnique({
    where: {
      email: email.trim().toLowerCase(),
    },
  });

  if (!user?.passwordHash) {
    return { ok: false as const, error: "Неверный логин или пароль." };
  }

  if (user.status === UserStatus.DELETED) {
    return { ok: false as const, error: "Пользователь был удалён." };
  }

  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) {
    return { ok: false as const, error: "Неверный логин или пароль." };
  }

  await createSessionForUser(user.id);
  return { ok: true as const, user };
}

export async function logoutCurrentUser() {
  await clearSessionCookie();
}

async function persistPasswordUpdate(userId: string, password: string, options?: { revokeSessions?: boolean }) {
  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash,
      forcePasswordChange: false,
      status: UserStatus.ACTIVE,
    },
  });

  if (options?.revokeSessions) {
    await revokeUserSessions(userId);
  }
}

export async function updatePassword(userId: string, password: string) {
  await persistPasswordUpdate(userId, password);
}

export async function resetPasswordWithInitialPassword(email: string, initialPassword: string, nextPassword: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedInitialPassword = initialPassword.trim();
  const normalizedNextPassword = nextPassword.trim();

  if (!normalizedEmail) {
    return { ok: false as const, error: "Укажите электронную почту аккаунта." };
  }

  if (!normalizedInitialPassword) {
    return { ok: false as const, error: "Введите первоначальный пароль." };
  }

  if (normalizedNextPassword.length < 8) {
    return { ok: false as const, error: "Новый пароль должен содержать минимум 8 символов." };
  }

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (!user?.passwordHash || user.status === UserStatus.DELETED) {
    return { ok: false as const, error: "Пользователь с такой электронной почтой не найден." };
  }

  if (normalizedInitialPassword !== env.DEFAULT_MEMBER_PASSWORD) {
    return { ok: false as const, error: "Неверный первоначальный пароль." };
  }

  await persistPasswordUpdate(user.id, normalizedNextPassword, { revokeSessions: true });
  return { ok: true as const };
}

export async function updateProfile(userId: string, input: { displayName: string }) {
  await prisma.user.update({
    where: { id: userId },
    data: {
      displayName: input.displayName.trim(),
    },
  });
}

export async function createParticipant(email: string, invitedById: string) {
  const normalizedEmail = email.trim().toLowerCase();

  if (!(await canManageParticipants(invitedById))) {
    throw new Error("Недостаточно прав для приглашения участников.");
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (existingUser?.role === UserRole.ADMIN) {
    throw new Error("Нельзя приглашать администраторский аккаунт как участника.");
  }

  const member =
    existingUser ??
    (await prisma.user.create({
      data: {
        email: normalizedEmail,
        role: UserRole.MEMBER,
        status: UserStatus.INVITED,
        forcePasswordChange: true,
      },
    }));

  const token = nanoid(48);
  const tokenHash = hashToken(token);
  const expiresAt = addDays(new Date(), 7);

  await prisma.invitation.create({
    data: {
      email: normalizedEmail,
      tokenHash,
      invitedById,
      createdUserId: member.id,
      expiresAt,
    },
  });

  return {
    member,
    inviteUrl: `${env.APP_URL}/invite/${token}`,
    expiresAt,
  };
}

export async function acceptInvitation(token: string) {
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { createdUser: true },
  });

  if (!invitation || invitation.revokedAt || invitation.acceptedAt) {
    throw new Error("Ссылка приглашения недействительна.");
  }

  if (invitation.expiresAt < new Date()) {
    throw new Error("Срок действия приглашения истёк.");
  }

  if (!invitation.createdUser) {
    throw new Error("Приглашение не связано с участником.");
  }

  const defaultPasswordHash = await bcrypt.hash(env.DEFAULT_MEMBER_PASSWORD, 12);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: invitation.createdUser.id },
      data: {
        passwordHash: defaultPasswordHash,
        status: UserStatus.ACTIVE,
        forcePasswordChange: true,
      },
    }),
    prisma.invitation.update({
      where: { id: invitation.id },
      data: {
        acceptedAt: new Date(),
      },
    }),
  ]);

  await createSessionForUser(invitation.createdUser.id);

  return invitation.createdUser;
}

function buildSurveyInclude(userId: string) {
  return {
    owner: true,
    folder: true,
    currentVersion: true,
    publishedVersion: true,
    notificationConfig: true,
    aiAnalysisRule: true,
    mediaAssets: true,
    permissions: {
      where: { userId },
    },
    _count: {
      select: {
        responses: true,
      },
    },
  } satisfies Prisma.SurveyInclude;
}

function buildSurveyListWhere(actorId: string, includeResultsOnly = false) {
  if (includeResultsOnly) {
    return {
      OR: [
        { ownerId: actorId },
        {
          permissions: {
            some: {
              userId: actorId,
              canResults: true,
            },
          },
        },
      ],
    } satisfies Prisma.SurveyWhereInput;
  }

  return {
    OR: [
      { ownerId: actorId },
      {
        permissions: {
          some: {
            userId: actorId,
            OR: [{ canView: true }, { canEdit: true }, { canDelete: true }, { canResults: true }],
          },
        },
      },
    ],
  } satisfies Prisma.SurveyWhereInput;
}

async function resolveSurveyAccess(surveyId: string, actorId: string, ability: "view" | "create" | "edit" | "delete" | "results") {
  const [actor, survey] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: actorId } }),
    prisma.survey.findUnique({
      where: { id: surveyId },
      include: {
        permissions: {
          where: { userId: actorId },
        },
      },
    }),
  ]);

  if (!survey) {
    throw new Error("Опрос не найден.");
  }

  const permission = survey.permissions[0] ?? null;
  if (!hasSurveyAbility(actor, permission, survey.ownerId, ability)) {
    throw new Error("Недостаточно прав для действия с этим опросом.");
  }

  return { actor, survey, permission };
}

async function resolveSurveyAccessAny(surveyId: string, actorId: string, abilities: SurveyAbility[]) {
  const [actor, survey] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: actorId } }),
    prisma.survey.findUnique({
      where: { id: surveyId },
      include: {
        permissions: {
          where: { userId: actorId },
        },
      },
    }),
  ]);

  if (!survey) {
    throw new Error("Опрос не найден.");
  }

  const permission = survey.permissions[0] ?? null;
  const abilityMap = getSurveyAbilities(actor, permission, survey.ownerId);
  if (!hasAnySurveyAbility(abilityMap, abilities)) {
    throw new Error("Недостаточно прав для действия с этим опросом.");
  }

  return { actor, survey, permission, abilities: abilityMap };
}

export async function getDashboardData(actorId: string) {
  const actor = await prisma.user.findUniqueOrThrow({
    where: { id: actorId },
  });

  const where = actor.role === UserRole.ADMIN ? {} : buildSurveyListWhere(actorId);

  const [surveys, folders, participants, recentResponses] = await Promise.all([
    prisma.survey.findMany({
      where,
      include: buildSurveyInclude(actorId),
      orderBy: [{ updatedAt: "desc" }],
    }),
    prisma.folder.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.user.count({
      where: {
        role: UserRole.MEMBER,
        status: {
          not: UserStatus.DELETED,
        },
      },
    }),
    prisma.responseSession.findMany({
      where: actor.role === UserRole.ADMIN ? {} : { survey: buildSurveyListWhere(actorId, true) },
      include: {
        survey: true,
        answers: {
          orderBy: { sortOrder: "asc" },
        },
      },
      take: 8,
      orderBy: { startedAt: "desc" },
    }),
  ]);

  const surveysWithAbilities = surveys.map((survey) => ({
    ...survey,
    abilities: getSurveyAbilities(actor, survey.permissions[0] ?? null, survey.ownerId),
  }));

  return {
    actor,
    surveys: surveysWithAbilities,
    folders,
    participants,
    recentResponses,
  };
}

export async function createFolder(name: string, createdById: string) {
  await requireCurrentUser();

  const normalizedName = name.trim();
  if (!normalizedName) {
    throw new Error("Название папки не может быть пустым.");
  }

  return prisma.folder.create({
    data: {
      name: normalizedName,
      slug: `${slugify(normalizedName)}-${nanoid(6)}`,
      createdById,
    },
  });
}

export async function renameFolder(folderId: string, actorId: string, name: string) {
  const normalizedName = name.trim();
  if (!normalizedName) {
    throw new Error("Название папки не может быть пустым.");
  }

  const folder = await prisma.folder.findUniqueOrThrow({
    where: { id: folderId },
  });

  const actor = await prisma.user.findUniqueOrThrow({
    where: { id: actorId },
  });

  if (actor.role !== UserRole.ADMIN && folder.createdById !== actorId) {
    throw new Error("Недостаточно прав для изменения папки.");
  }

  return prisma.folder.update({
    where: { id: folderId },
    data: {
      name: normalizedName,
      slug: `${slugify(normalizedName)}-${folder.id.slice(-6).toLowerCase()}`,
    },
  });
}

export async function deleteFolder(folderId: string, actorId: string) {
  const folder = await prisma.folder.findUniqueOrThrow({
    where: { id: folderId },
  });

  const actor = await prisma.user.findUniqueOrThrow({
    where: { id: actorId },
  });

  if (actor.role !== UserRole.ADMIN && folder.createdById !== actorId) {
    throw new Error("Недостаточно прав для удаления папки.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.survey.updateMany({
      where: { folderId },
      data: {
        folderId: null,
        folderKey: SurveyFolderKey.MY_SURVEYS,
      },
    });

    await tx.folder.delete({
      where: { id: folderId },
    });
  });
}

async function createSurveyRecord(
  ownerId: string,
  schemaInput: SurveySchema,
  options?: {
    changeSummary?: string;
  },
) {
  const schema = coerceSurveyNavigationTargets(normalizeSurveySchema(schemaInput, schemaInput.title));
  const validationErrors = validateSurveySchema(schema);
  if (validationErrors.length) {
    throw new Error(validationErrors[0]);
  }
  const publicSlug = await buildUniquePublicSlug(schema.title, (candidate) => isPublicSlugTaken(candidate));

  return prisma.$transaction(async (tx) => {
    const survey = await tx.survey.create({
      data: {
        title: schema.title,
        description: schema.description,
        ownerId,
        publicSlug,
        language: schema.settings.language,
        autoScrollEnabled: schema.settings.autoScrollEnabled,
        timerEnabled: schema.settings.timerEnabled,
        timerSeconds: schema.settings.timerSeconds,
        completionMessage: schema.settings.completionMessage,
      },
    });

    const version = await tx.surveyVersion.create({
      data: {
        surveyId: survey.id,
        versionNumber: 1,
        title: schema.title,
        description: schema.description,
        schema: schema as unknown as Prisma.InputJsonValue,
        createdById: ownerId,
        changeSummary: options?.changeSummary?.trim() || "Первичная версия",
      },
    });

    await tx.survey.update({
      where: { id: survey.id },
      data: {
        currentVersionId: version.id,
        lastVersionNumber: 1,
      },
    });

    await tx.notificationConfig.create({
      data: {
        surveyId: survey.id,
      },
    });

    await tx.aiAnalysisRule.create({
      data: {
        surveyId: survey.id,
        enabled: false,
        prompt: "",
      },
    });

    return survey;
  });
}

export async function createSurvey(ownerId: string) {
  return createSurveyRecord(ownerId, createDefaultSurveySchema());
}

export async function createSurveyFromPrompt(
  ownerId: string,
  input: {
    prompt: string;
    provider?: AiProvider | null;
    apiKey?: string | null;
    model?: string | null;
  },
) {
  const normalizedPrompt = input.prompt.trim();
  if (!normalizedPrompt) {
    throw new Error("Опишите в промте, какой опрос нужно создать.");
  }

  const generatedDraft = await generateSurveyDraftFromPrompt({
    prompt: normalizedPrompt,
    provider: input.provider,
    apiKey: input.apiKey,
    model: input.model,
  });

  const schema = coerceSurveyNavigationTargets(normalizeSurveySchema(generatedDraft, "Опрос, созданный ИИ"));

  if (!schema.blocks.length) {
    throw new Error("AI не сгенерировал ни одного блока.");
  }

  if (schema.blocks[0]?.type !== "WELCOME") {
    schema.blocks = [createBlock("WELCOME", 1), ...schema.blocks];
  }

  return createSurveyRecord(ownerId, coerceSurveyNavigationTargets(schema), {
    changeSummary: "Первичная версия, созданная ИИ",
  });
}

export async function duplicateSurvey(surveyId: string, actorId: string) {
  await resolveSurveyAccessAny(surveyId, actorId, ["view", "edit"]);

  const source = await prisma.survey.findUniqueOrThrow({
    where: { id: surveyId },
    include: {
      currentVersion: true,
      notificationConfig: true,
      aiAnalysisRule: true,
    },
  });

  const schema = normalizeSurveySchema(
    source.currentVersion?.schema ?? createDefaultSurveySchema(source.title),
    source.title,
  );
  const nextTitle = `${source.title} (копия)`;
  const publicSlug = await buildUniquePublicSlug(nextTitle, (candidate) => isPublicSlugTaken(candidate));

  return prisma.$transaction(async (tx) => {
    const survey = await tx.survey.create({
      data: {
        title: nextTitle,
        description: source.description,
        ownerId: actorId,
        publicSlug,
        folderId: source.folderId,
        folderKey: source.folderId ? SurveyFolderKey.CUSTOM : SurveyFolderKey.MY_SURVEYS,
        language: source.language,
        autoScrollEnabled: source.autoScrollEnabled,
        timerEnabled: source.timerEnabled,
        timerSeconds: source.timerSeconds,
        completionMessage: source.completionMessage,
      },
    });

    const version = await tx.surveyVersion.create({
      data: {
        surveyId: survey.id,
        versionNumber: 1,
        title: nextTitle,
        description: source.description,
        schema: {
          ...schema,
          title: nextTitle,
        } as unknown as Prisma.InputJsonValue,
        createdById: actorId,
        changeSummary: `Дубликат опроса ${source.title}`,
      },
    });

    await tx.survey.update({
      where: { id: survey.id },
      data: {
        currentVersionId: version.id,
        lastVersionNumber: 1,
      },
    });

    await tx.notificationConfig.create({
      data: {
        surveyId: survey.id,
        telegramEnabled: source.notificationConfig?.telegramEnabled ?? false,
        telegramRecipientUserId: source.notificationConfig?.telegramRecipientUserId ?? null,
        telegramRecipientUserIds: source.notificationConfig?.telegramRecipientUserIds ?? [],
        telegramChatIdOverride: source.notificationConfig?.telegramChatIdOverride ?? null,
        telegramChatIdOverrides: source.notificationConfig?.telegramChatIdOverrides ?? [],
      },
    });

    await tx.aiAnalysisRule.create({
      data: {
        surveyId: survey.id,
        enabled: source.aiAnalysisRule?.enabled ?? false,
        provider: source.aiAnalysisRule?.provider ?? AiProvider.OPENROUTER,
        prompt: source.aiAnalysisRule?.prompt ?? "",
        model: source.aiAnalysisRule?.model ?? null,
        apiKeyEncrypted: source.aiAnalysisRule?.apiKeyEncrypted ?? null,
        apiKeyLastFour: source.aiAnalysisRule?.apiKeyLastFour ?? null,
        completionGreenMaxUrl: source.aiAnalysisRule?.completionGreenMaxUrl ?? "",
        completionGreenTelegramUrl: source.aiAnalysisRule?.completionGreenTelegramUrl ?? "",
        completionGreenWhatsappUrl: source.aiAnalysisRule?.completionGreenWhatsappUrl ?? "",
      },
    });

    return survey;
  });
}

export async function renameSurvey(surveyId: string, actorId: string, title: string) {
  const normalizedTitle = title.trim();
  if (!normalizedTitle) {
    throw new Error("Название опроса не может быть пустым.");
  }

  await resolveSurveyAccess(surveyId, actorId, "edit");

  const source = await prisma.survey.findUniqueOrThrow({
    where: { id: surveyId },
    include: {
      currentVersion: true,
    },
  });

  const schema = normalizeSurveySchema(
    source.currentVersion?.schema ?? createDefaultSurveySchema(source.title),
    source.title,
  );

  return saveSurveyDraft(surveyId, actorId, {
    schema: {
      ...schema,
      title: normalizedTitle,
    },
    changeSummary: "Переименование опроса",
    folderId: source.folderId,
  });
}

type SaveSurveyInput = {
  schema: SurveySchema;
  changeSummary?: string;
  folderId?: string | null;
};

export async function saveSurveyDraft(surveyId: string, actorId: string, input: SaveSurveyInput) {
  await resolveSurveyAccess(surveyId, actorId, "edit");

  const normalizedSchema = coerceSurveyNavigationTargets(normalizeSurveySchema(input.schema, input.schema.title));
  const validationErrors = validateSurveySchema(normalizedSchema);
  if (validationErrors.length) {
    throw new Error(validationErrors[0]);
  }

  return prisma.$transaction(async (tx) => {
    const survey = await tx.survey.findUniqueOrThrow({
      where: { id: surveyId },
      include: { currentVersion: true },
    });
    const persistedSchema = normalizeSurveySchema(survey.currentVersion?.schema ?? normalizedSchema, normalizedSchema.title);
    const schemaForVersion = {
      ...normalizedSchema,
      settings: {
        ...normalizedSchema.settings,
        autoScrollEnabled: survey.autoScrollEnabled,
        timerEnabled: survey.timerEnabled,
        timerSeconds: survey.timerEnabled ? survey.timerSeconds : null,
        completionMessage: survey.completionMessage,
        showProgressBar: persistedSchema.settings.showProgressBar,
        showRestartButton: persistedSchema.settings.showRestartButton,
        typography: persistedSchema.settings.typography,
        mobileTypography: persistedSchema.settings.mobileTypography,
      },
    };

    const nextVersion = survey.lastVersionNumber + 1;
    const version = await tx.surveyVersion.create({
      data: {
        surveyId,
        versionNumber: nextVersion,
        title: schemaForVersion.title,
        description: schemaForVersion.description,
        schema: schemaForVersion as unknown as Prisma.InputJsonValue,
        changeSummary: input.changeSummary?.trim() || `Версия ${nextVersion}`,
        createdById: actorId,
      },
    });

    await tx.survey.update({
      where: { id: surveyId },
      data: {
        title: schemaForVersion.title,
        description: schemaForVersion.description,
        currentVersionId: version.id,
        lastVersionNumber: nextVersion,
        language: schemaForVersion.settings.language,
        folderId: input.folderId === undefined ? survey.folderId : input.folderId,
        folderKey: input.folderId ? SurveyFolderKey.CUSTOM : survey.folderKey,
      },
    });

    return version;
  });
}

export async function updateSurveyPublicSlug(surveyId: string, actorId: string, inputPublicSlug: string) {
  const { survey } = await resolveSurveyAccess(surveyId, actorId, "edit");
  const publicSlug = normalizePublicSlugInput(inputPublicSlug);

  if (publicSlug !== survey.publicSlug && (await isPublicSlugTaken(publicSlug, surveyId))) {
    throw new Error("Этот адрес ссылки уже занят другим опросом.");
  }

  return prisma.survey.update({
    where: { id: surveyId },
    data: { publicSlug },
    select: {
      publicSlug: true,
      updatedAt: true,
    },
  });
}

export async function updateSurveySettings(
  surveyId: string,
  actorId: string,
  input: {
    autoScrollEnabled: boolean;
    showProgressBar: boolean;
    timerEnabled: boolean;
    timerSeconds: number | null;
    completionMessage: string;
    showRestartButton: boolean;
    additionalInfoItems?: AdditionalInfoItem[];
    typography: SurveySchema["settings"]["typography"];
    mobileTypography: SurveySchema["settings"]["mobileTypography"];
    telegramEnabled: boolean;
    telegramRecipientUserId?: string | null;
    telegramRecipientUserIds?: string[];
    telegramChatIdOverride?: string | null;
    telegramChatIdOverrides?: string[];
    telegramAiFilterEnabled: boolean;
    telegramAiAllowedColors?: string[];
    aiEnabled: boolean;
    aiProvider?: AiProvider | null;
    aiPrompt: string;
    aiModel?: string | null;
    aiApiKey?: string | null;
    aiClearApiKey?: boolean;
    completionRoutingEnabled: boolean;
    completionProcessingTitle?: string | null;
    completionProcessingMessage?: string | null;
    completionGreenTitle?: string | null;
    completionGreenMessage?: string | null;
    completionGreenMaxUrl?: string | null;
    completionGreenTelegramUrl?: string | null;
    completionGreenWhatsappUrl?: string | null;
    completionYellowTitle?: string | null;
    completionYellowMessage?: string | null;
    completionRedTitle?: string | null;
    completionRedMessage?: string | null;
    completionFallbackTitle?: string | null;
    completionFallbackMessage?: string | null;
  },
) {
  await resolveSurveyAccess(surveyId, actorId, "edit");

  const existingAiRule = await prisma.aiAnalysisRule.findUnique({
    where: { surveyId },
  });
  const existingNotificationConfig = await prisma.notificationConfig.findUnique({
    where: { surveyId },
    select: {
      telegramRecipientUserId: true,
      telegramRecipientUserIds: true,
      telegramChatIdOverride: true,
      telegramChatIdOverrides: true,
    },
  });
  const surveyVersions = await prisma.survey.findUniqueOrThrow({
    where: { id: surveyId },
    select: {
      currentVersion: {
        select: {
          id: true,
          title: true,
          schema: true,
        },
      },
      publishedVersion: {
        select: {
          id: true,
          title: true,
          schema: true,
        },
      },
    },
  });

  if (input.timerEnabled && (!input.timerSeconds || input.timerSeconds <= 0)) {
    throw new Error("Для таймера укажите положительное количество секунд.");
  }

  const normalizedPrompt = input.aiPrompt.trim();
  const normalizedTelegramAiAllowedColors = normalizeAiResultColors(input.telegramAiAllowedColors ?? [], {
    fallbackToGreen: input.telegramAiFilterEnabled,
  });
  const telegramAiAllowedColors = input.telegramAiFilterEnabled ? normalizedTelegramAiAllowedColors : [];
  const completionCopy = {
    processingTitle: input.completionProcessingTitle?.trim() || DEFAULT_AI_COMPLETION_COPY.processingTitle,
    processingMessage: input.completionProcessingMessage?.trim() || DEFAULT_AI_COMPLETION_COPY.processingMessage,
    greenTitle: input.completionGreenTitle?.trim() || DEFAULT_AI_COMPLETION_COPY.greenTitle,
    greenMessage: input.completionGreenMessage?.trim() || DEFAULT_AI_COMPLETION_COPY.greenMessage,
    yellowTitle: input.completionYellowTitle?.trim() || DEFAULT_AI_COMPLETION_COPY.yellowTitle,
    yellowMessage: input.completionYellowMessage?.trim() || DEFAULT_AI_COMPLETION_COPY.yellowMessage,
    redTitle: input.completionRedTitle?.trim() || DEFAULT_AI_COMPLETION_COPY.redTitle,
    redMessage: input.completionRedMessage?.trim() || DEFAULT_AI_COMPLETION_COPY.redMessage,
    fallbackTitle: input.completionFallbackTitle?.trim() || DEFAULT_AI_COMPLETION_COPY.fallbackTitle,
    fallbackMessage: input.completionFallbackMessage?.trim() || DEFAULT_AI_COMPLETION_COPY.fallbackMessage,
  };
  const completionGreenMessengerUrls = {
    completionGreenMaxUrl: normalizeMessengerUrl(input.completionGreenMaxUrl, GREEN_MESSENGERS[0]),
    completionGreenTelegramUrl: normalizeMessengerUrl(input.completionGreenTelegramUrl, GREEN_MESSENGERS[1]),
    completionGreenWhatsappUrl: normalizeMessengerUrl(input.completionGreenWhatsappUrl, GREEN_MESSENGERS[2]),
  };
  const normalizedProvider = input.aiProvider ?? existingAiRule?.provider ?? AiProvider.OPENROUTER;
  const normalizedApiKey = input.aiApiKey?.trim() ?? "";
  const nextApiKeyEncrypted = input.aiClearApiKey
    ? null
    : normalizedApiKey
      ? encryptSecret(normalizedApiKey)
      : existingAiRule?.apiKeyEncrypted ?? null;
  const nextApiKeyLastFour = input.aiClearApiKey
    ? null
    : normalizedApiKey
      ? getSecretLastFour(normalizedApiKey)
      : existingAiRule?.apiKeyLastFour ?? null;
  const hasProviderFallbackKey =
    normalizedProvider === AiProvider.OPENROUTER ? Boolean(env.OPENROUTER_API_KEY) : Boolean(env.OPENAI_API_KEY);
  const activeVersionUpdates = new Map<string, Prisma.InputJsonValue>();
  const applySchemaSettings = (schema: SurveySchema) => {
    const nextAdditionalInfoItems = input.additionalInfoItems ?? schema.settings.additionalInfoItems;
    const nextAdditionalInfoIds = new Set(nextAdditionalInfoItems.map((item) => item.id));

    return {
      ...schema,
      settings: {
        ...schema.settings,
        autoScrollEnabled: input.autoScrollEnabled,
        timerEnabled: input.timerEnabled,
        timerSeconds: input.timerEnabled ? input.timerSeconds : null,
        completionMessage: input.completionMessage.trim() || "Спасибо за опрос!",
        showProgressBar: input.showProgressBar,
        showRestartButton: input.showRestartButton,
        additionalInfoItems: nextAdditionalInfoItems,
        typography: input.typography,
        mobileTypography: input.mobileTypography,
      },
      blocks: schema.blocks.map((block) => ({
        ...block,
        additionalInfoItemIds: block.additionalInfoItemIds.filter((id) => nextAdditionalInfoIds.has(id)),
        additionalInfoItems: [],
      })) as SurveyBlock[],
    } satisfies SurveySchema;
  };

  if (surveyVersions.currentVersion) {
    const currentSchema = coerceSurveyNavigationTargets(
      normalizeSurveySchema(surveyVersions.currentVersion.schema, surveyVersions.currentVersion.title),
    );
    activeVersionUpdates.set(surveyVersions.currentVersion.id, applySchemaSettings(currentSchema) as unknown as Prisma.InputJsonValue);
  }

  if (surveyVersions.publishedVersion && !activeVersionUpdates.has(surveyVersions.publishedVersion.id)) {
    const publishedSchema = coerceSurveyNavigationTargets(
      normalizeSurveySchema(surveyVersions.publishedVersion.schema, surveyVersions.publishedVersion.title),
    );
    activeVersionUpdates.set(surveyVersions.publishedVersion.id, applySchemaSettings(publishedSchema) as unknown as Prisma.InputJsonValue);
  }

  if (input.aiEnabled && !normalizedPrompt) {
    throw new Error("Для AI-анализа заполните prompt.");
  }

  if (input.completionRoutingEnabled && (!input.aiEnabled || !normalizedPrompt)) {
    throw new Error("Для финального экрана по AI-зоне включите AI-анализ и заполните prompt.");
  }

  if (input.aiEnabled && !nextApiKeyEncrypted && !hasProviderFallbackKey) {
    throw new Error(
      normalizedProvider === AiProvider.OPENROUTER
        ? "Для OpenRouter укажите API-ключ в настройках опроса или в окружении сервера."
        : "Для OpenAI укажите API-ключ в настройках опроса или в окружении сервера.",
    );
  }

  const existingTelegramRecipientUserIds =
    existingNotificationConfig?.telegramRecipientUserIds?.length
      ? existingNotificationConfig.telegramRecipientUserIds
      : existingNotificationConfig?.telegramRecipientUserId
        ? [existingNotificationConfig.telegramRecipientUserId]
        : [];
  const requestedTelegramRecipientUserIds =
    input.telegramRecipientUserIds === undefined && input.telegramRecipientUserId === undefined
      ? existingTelegramRecipientUserIds.length
        ? existingTelegramRecipientUserIds
        : input.telegramEnabled
          ? [actorId]
          : []
      : Array.from(
          new Set(
            [...(input.telegramRecipientUserIds ?? []), input.telegramRecipientUserId ?? ""]
              .map((id) => id.trim())
              .filter(Boolean),
          ),
        ).slice(0, 25);
  const validTelegramRecipientUserIds = requestedTelegramRecipientUserIds.length
    ? await prisma.user
        .findMany({
          where: {
            id: { in: requestedTelegramRecipientUserIds },
            status: { not: UserStatus.DELETED },
          },
          select: { id: true },
        })
        .then((users) => {
          const validIds = new Set(users.map((user) => user.id));
          return requestedTelegramRecipientUserIds.filter((id) => validIds.has(id));
        })
    : [];
  const existingTelegramChatIdOverrides =
    existingNotificationConfig?.telegramChatIdOverrides?.length
      ? existingNotificationConfig.telegramChatIdOverrides
      : existingNotificationConfig?.telegramChatIdOverride
        ? [existingNotificationConfig.telegramChatIdOverride]
        : [];
  const telegramChatIdOverrides =
    input.telegramChatIdOverrides === undefined && input.telegramChatIdOverride === undefined
      ? existingTelegramChatIdOverrides
      : Array.from(
          new Set(
            [...(input.telegramChatIdOverrides ?? []), input.telegramChatIdOverride ?? ""]
              .map((chatId) => chatId.trim())
              .filter(Boolean),
          ),
        ).slice(0, 25);

  await prisma.$transaction([
    prisma.survey.update({
      where: { id: surveyId },
      data: {
        autoScrollEnabled: input.autoScrollEnabled,
        timerEnabled: input.timerEnabled,
        timerSeconds: input.timerEnabled ? input.timerSeconds : null,
        completionMessage: input.completionMessage.trim() || "Спасибо за опрос!",
      },
    }),
    prisma.notificationConfig.upsert({
      where: { surveyId },
      update: {
        telegramEnabled: input.telegramEnabled,
        telegramAiFilterEnabled: input.telegramAiFilterEnabled,
        telegramAiAllowedColors,
        telegramRecipientUserId: validTelegramRecipientUserIds[0] ?? null,
        telegramRecipientUserIds: validTelegramRecipientUserIds,
        telegramChatIdOverride: telegramChatIdOverrides[0] ?? null,
        telegramChatIdOverrides,
      },
      create: {
        surveyId,
        telegramEnabled: input.telegramEnabled,
        telegramAiFilterEnabled: input.telegramAiFilterEnabled,
        telegramAiAllowedColors,
        telegramRecipientUserId: validTelegramRecipientUserIds[0] ?? null,
        telegramRecipientUserIds: validTelegramRecipientUserIds,
        telegramChatIdOverride: telegramChatIdOverrides[0] ?? null,
        telegramChatIdOverrides,
      },
    }),
    prisma.aiAnalysisRule.upsert({
      where: { surveyId },
      update: {
        enabled: input.aiEnabled,
        provider: normalizedProvider,
        prompt: normalizedPrompt,
        model: input.aiModel?.trim() || null,
        apiKeyEncrypted: nextApiKeyEncrypted,
        apiKeyLastFour: nextApiKeyLastFour,
        completionRoutingEnabled: input.completionRoutingEnabled,
        completionProcessingTitle: completionCopy.processingTitle,
        completionProcessingMessage: completionCopy.processingMessage,
        completionGreenTitle: completionCopy.greenTitle,
        completionGreenMessage: completionCopy.greenMessage,
        completionGreenMaxUrl: completionGreenMessengerUrls.completionGreenMaxUrl,
        completionGreenTelegramUrl: completionGreenMessengerUrls.completionGreenTelegramUrl,
        completionGreenWhatsappUrl: completionGreenMessengerUrls.completionGreenWhatsappUrl,
        completionYellowTitle: completionCopy.yellowTitle,
        completionYellowMessage: completionCopy.yellowMessage,
        completionRedTitle: completionCopy.redTitle,
        completionRedMessage: completionCopy.redMessage,
        completionFallbackTitle: completionCopy.fallbackTitle,
        completionFallbackMessage: completionCopy.fallbackMessage,
      },
      create: {
        surveyId,
        enabled: input.aiEnabled,
        provider: normalizedProvider,
        prompt: normalizedPrompt,
        model: input.aiModel?.trim() || null,
        apiKeyEncrypted: nextApiKeyEncrypted,
        apiKeyLastFour: nextApiKeyLastFour,
        completionRoutingEnabled: input.completionRoutingEnabled,
        completionProcessingTitle: completionCopy.processingTitle,
        completionProcessingMessage: completionCopy.processingMessage,
        completionGreenTitle: completionCopy.greenTitle,
        completionGreenMessage: completionCopy.greenMessage,
        completionGreenMaxUrl: completionGreenMessengerUrls.completionGreenMaxUrl,
        completionGreenTelegramUrl: completionGreenMessengerUrls.completionGreenTelegramUrl,
        completionGreenWhatsappUrl: completionGreenMessengerUrls.completionGreenWhatsappUrl,
        completionYellowTitle: completionCopy.yellowTitle,
        completionYellowMessage: completionCopy.yellowMessage,
        completionRedTitle: completionCopy.redTitle,
        completionRedMessage: completionCopy.redMessage,
        completionFallbackTitle: completionCopy.fallbackTitle,
        completionFallbackMessage: completionCopy.fallbackMessage,
      },
    }),
    ...Array.from(activeVersionUpdates.entries()).map(([versionId, schema]) =>
      prisma.surveyVersion.update({
        where: { id: versionId },
        data: {
          schema,
        },
      }),
    ),
  ]);
}

export async function publishSurvey(surveyId: string, actorId: string) {
  await resolveSurveyAccess(surveyId, actorId, "edit");

  const survey = await prisma.survey.findUniqueOrThrow({
    where: { id: surveyId },
    include: { currentVersion: true },
  });

  if (!survey.currentVersionId) {
    throw new Error("Невозможно опубликовать опрос без сохранённой версии.");
  }

  await prisma.survey.update({
    where: { id: surveyId },
    data: {
      publishedVersionId: survey.currentVersionId,
      lifecycleStatus: SurveyLifecycleStatus.PUBLISHED,
      publishedAt: new Date(),
      archivedAt: null,
      purgeAt: null,
      folderKey: survey.folderId ? SurveyFolderKey.CUSTOM : SurveyFolderKey.MY_SURVEYS,
    },
  });
}

export async function archiveSurvey(surveyId: string, actorId: string) {
  await resolveSurveyAccess(surveyId, actorId, "delete");

  await prisma.survey.update({
    where: { id: surveyId },
    data: {
      lifecycleStatus: SurveyLifecycleStatus.ARCHIVED,
      folderKey: SurveyFolderKey.ARCHIVE,
      archivedAt: new Date(),
      purgeAt: addDays(new Date(), 30),
    },
  });
}

export async function deleteSurveyPermanently(surveyId: string, actorId: string) {
  await resolveSurveyAccess(surveyId, actorId, "delete");

  const survey = await prisma.survey.findUniqueOrThrow({
    where: { id: surveyId },
    include: {
      mediaAssets: true,
    },
  });

  if (survey.lifecycleStatus !== SurveyLifecycleStatus.ARCHIVED) {
    throw new Error("Навсегда можно удалить только опрос из архива.");
  }

  await prisma.survey.delete({
    where: { id: surveyId },
  });

  for (const asset of survey.mediaAssets) {
    await deleteStoredFile(asset.storagePath);
  }
}

export async function restoreSurvey(surveyId: string, actorId: string) {
  await resolveSurveyAccess(surveyId, actorId, "edit");

  const survey = await prisma.survey.findUniqueOrThrow({
    where: { id: surveyId },
  });

  await prisma.survey.update({
    where: { id: surveyId },
    data: {
      lifecycleStatus: survey.publishedVersionId ? SurveyLifecycleStatus.PUBLISHED : SurveyLifecycleStatus.DRAFT,
      folderKey: SurveyFolderKey.RESTORED,
      archivedAt: null,
      purgeAt: null,
    },
  });
}

export async function rollbackSurveyToVersion(surveyId: string, versionId: string, actorId: string) {
  await resolveSurveyAccess(surveyId, actorId, "edit");

  return prisma.$transaction(async (tx) => {
    const [survey, version] = await Promise.all([
      tx.survey.findUniqueOrThrow({ where: { id: surveyId } }),
      tx.surveyVersion.findUniqueOrThrow({ where: { id: versionId } }),
    ]);

    if (version.surveyId !== surveyId) {
      throw new Error("Версия не принадлежит выбранному опросу.");
    }

    const nextVersionNumber = survey.lastVersionNumber + 1;
    const rollbackVersion = await tx.surveyVersion.create({
      data: {
        surveyId,
        versionNumber: nextVersionNumber,
        title: version.title,
        description: version.description,
        schema: version.schema as unknown as Prisma.InputJsonValue,
        createdById: actorId,
        changeSummary: `Откат к версии ${version.versionNumber}`,
      },
    });

    await tx.survey.update({
      where: { id: surveyId },
      data: {
        title: version.title,
        description: version.description,
        currentVersionId: rollbackVersion.id,
        lastVersionNumber: nextVersionNumber,
      },
    });

    return rollbackVersion;
  });
}

export async function moveSurveyToFolder(surveyId: string, actorId: string, folderId: string | null) {
  await resolveSurveyAccess(surveyId, actorId, "edit");

  await prisma.survey.update({
    where: { id: surveyId },
    data: {
      folderId,
      folderKey: folderId ? SurveyFolderKey.CUSTOM : SurveyFolderKey.MY_SURVEYS,
    },
  });
}

export async function getSurveyEditorData(surveyId: string, actorId: string) {
  const access = await resolveSurveyAccessAny(surveyId, actorId, ["view", "edit", "results"]);

  const survey = await prisma.survey.findUniqueOrThrow({
    where: { id: surveyId },
    include: {
      ...buildSurveyInclude(actorId),
      versions: {
        orderBy: { versionNumber: "desc" },
        take: 20,
      },
      responses: {
        orderBy: { startedAt: "desc" },
        take: 20,
        include: {
          answers: {
            orderBy: { sortOrder: "asc" },
          },
        },
      },
    },
  });

  const abilities = getSurveyAbilities(access.actor, survey.permissions[0] ?? null, survey.ownerId);
  const schema = coerceSurveyNavigationTargets(
    normalizeSurveySchema(
      survey.currentVersion?.schema ?? createDefaultSurveySchema(survey.title),
      survey.title,
    ),
  );

  return {
    survey,
    abilities,
    schema: {
      ...schema,
      settings: {
        ...schema.settings,
        autoScrollEnabled: survey.autoScrollEnabled,
        timerEnabled: survey.timerEnabled,
        timerSeconds: survey.timerEnabled ? survey.timerSeconds : null,
        completionMessage: survey.completionMessage,
      },
    },
  };
}

export async function getPublishedSurveyBySlug(publicSlug: string) {
  const survey = await prisma.survey.findUnique({
    where: { publicSlug },
    include: {
      publishedVersion: true,
      notificationConfig: true,
      aiAnalysisRule: true,
      mediaAssets: true,
    },
  });

  if (!survey || !survey.publishedVersion) {
    return null;
  }

  const schema = coerceSurveyNavigationTargets(normalizeSurveySchema(survey.publishedVersion.schema, survey.title));

  return {
    survey,
    schema: {
      ...schema,
      settings: {
        ...schema.settings,
        autoScrollEnabled: survey.autoScrollEnabled,
        timerEnabled: survey.timerEnabled,
        timerSeconds: survey.timerEnabled ? survey.timerSeconds : null,
        completionMessage: survey.completionMessage,
      },
    },
  };
}

function buildAiCompletionCopy(
  source:
    | {
        completionProcessingTitle: string;
        completionProcessingMessage: string;
        completionGreenTitle: string;
        completionGreenMessage: string;
        completionYellowTitle: string;
        completionYellowMessage: string;
        completionRedTitle: string;
        completionRedMessage: string;
        completionFallbackTitle: string;
        completionFallbackMessage: string;
      }
    | null
    | undefined,
): AiCompletionCopy {
  return {
    processingTitle: source?.completionProcessingTitle ?? DEFAULT_AI_COMPLETION_COPY.processingTitle,
    processingMessage: source?.completionProcessingMessage ?? DEFAULT_AI_COMPLETION_COPY.processingMessage,
    greenTitle: source?.completionGreenTitle ?? DEFAULT_AI_COMPLETION_COPY.greenTitle,
    greenMessage: source?.completionGreenMessage ?? DEFAULT_AI_COMPLETION_COPY.greenMessage,
    yellowTitle: source?.completionYellowTitle ?? DEFAULT_AI_COMPLETION_COPY.yellowTitle,
    yellowMessage: source?.completionYellowMessage ?? DEFAULT_AI_COMPLETION_COPY.yellowMessage,
    redTitle: source?.completionRedTitle ?? DEFAULT_AI_COMPLETION_COPY.redTitle,
    redMessage: source?.completionRedMessage ?? DEFAULT_AI_COMPLETION_COPY.redMessage,
    fallbackTitle: source?.completionFallbackTitle ?? DEFAULT_AI_COMPLETION_COPY.fallbackTitle,
    fallbackMessage: source?.completionFallbackMessage ?? DEFAULT_AI_COMPLETION_COPY.fallbackMessage,
  };
}

export async function getPublicResponseCompletionState(surveyId: string): Promise<PublicCompletionState> {
  const survey = await prisma.survey.findUniqueOrThrow({
    where: { id: surveyId },
    include: {
      publishedVersion: true,
      aiAnalysisRule: true,
    },
  });
  const schema = normalizeSurveySchema(survey.publishedVersion?.schema ?? createDefaultSurveySchema(survey.title), survey.title);
  const cookieStore = await cookies();
  const respondentKey = cookieStore.get(publicResponseCookieName(surveyId))?.value;
  const response = respondentKey
    ? await prisma.responseSession.findFirst({
        where: {
          surveyId,
          respondentKey,
          status: {
            not: ResponseStatus.IN_PROGRESS,
          },
        },
        orderBy: { startedAt: "desc" },
        select: {
          aiNote: true,
          aiResultColor: true,
          aiStatus: true,
        },
      })
    : null;
  const aiRule = survey.aiAnalysisRule;
  const routingEnabled = Boolean(aiRule?.completionRoutingEnabled && aiRule.enabled && aiRule.prompt.trim() && response);
  const color = extractAiResultColor(response?.aiResultColor ?? response?.aiNote);
  const content = resolveAiCompletionContent({
    routingEnabled,
    aiStatus: routingEnabled ? (response?.aiStatus ?? JobStatus.SKIPPED) : JobStatus.SKIPPED,
    color,
    defaultTitle: survey.completionMessage || schema.settings.completionMessage || "Спасибо за опрос!",
    copy: buildAiCompletionCopy(aiRule),
  });

  return {
    ...content,
    routingEnabled,
    messengerLinks: content.phase === "final" && content.color === "GREEN" ? buildGreenMessengerLinks(aiRule) : [],
    showRestartButton: schema.settings.showRestartButton,
    restartHref: `/s/${survey.publicSlug}?restart=1`,
  };
}

export async function listParticipants(actorId: string) {
  const scope = await getParticipantManagerScope(actorId);
  if (!scope?.canManage) {
    throw new Error("Недостаточно прав для управления участниками.");
  }

  const [participants, surveys] = await Promise.all([
    prisma.user.findMany({
      where: scope.isAdmin
        ? {
            role: UserRole.MEMBER,
          }
        : {
            role: UserRole.MEMBER,
            acceptedInvitation: {
              invitedById: actorId,
            },
          },
      include: {
        telegramConnection: true,
        permissions: scope.isAdmin
          ? true
          : {
              where: {
                surveyId: {
                  in: scope.accessibleSurveyIds,
                },
              },
            },
      },
      orderBy: [{ status: "asc" }, { email: "asc" }],
    }),
    scope.isAdmin
      ? prisma.survey.findMany({
          include: {
            permissions: true,
          },
          orderBy: [{ updatedAt: "desc" }],
        })
      : prisma.survey.findMany({
          where: {
            id: {
              in: scope.accessibleSurveyIds,
            },
          },
          include: {
            permissions: true,
          },
          orderBy: [{ updatedAt: "desc" }],
        }),
  ]);

  return { participants, surveys };
}

export async function updateSurveyPermission(
  actorId: string,
  input: {
    userId: string;
    surveyId: string;
    canView: boolean;
    canCreate: boolean;
    canEdit: boolean;
    canDelete: boolean;
    canResults: boolean;
  },
) {
  const scope = await getParticipantManagerScope(actorId);
  if (!scope?.canManage) {
    throw new Error("Недостаточно прав для изменения прав доступа.");
  }

  if (!scope.isAdmin) {
    const [targetUser, survey] = await Promise.all([
      prisma.user.findUnique({
        where: { id: input.userId },
        include: {
          acceptedInvitation: true,
        },
      }),
      prisma.survey.findUnique({
        where: { id: input.surveyId },
        select: {
          ownerId: true,
          permissions: {
            where: {
              userId: actorId,
            },
            take: 1,
          },
        },
      }),
    ]);

    if (input.userId === actorId) {
      throw new Error("Нельзя менять собственные права доступа.");
    }

    if (!targetUser || targetUser.acceptedInvitation?.invitedById !== actorId) {
      throw new Error("Можно настраивать права только своим участникам.");
    }

    if (!survey) {
      throw new Error("Опрос не найден.");
    }

    const actorPermission = survey.ownerId === actorId ? null : survey.permissions[0];
    const actorCapabilities = {
      canView: survey.ownerId === actorId || Boolean(actorPermission?.canView),
      canEdit: survey.ownerId === actorId || Boolean(actorPermission?.canEdit),
      canDelete: survey.ownerId === actorId || Boolean(actorPermission?.canDelete),
      canResults: survey.ownerId === actorId || Boolean(actorPermission?.canResults),
      canCreate: true,
    };

    if (
      (input.canView && !actorCapabilities.canView) ||
      (input.canEdit && !actorCapabilities.canEdit) ||
      (input.canDelete && !actorCapabilities.canDelete) ||
      (input.canResults && !actorCapabilities.canResults) ||
      (input.canCreate && !actorCapabilities.canCreate)
    ) {
      throw new Error("Нельзя выдавать права, которых нет у текущего участника.");
    }
  }

  await prisma.surveyPermission.upsert({
    where: {
      surveyId_userId: {
        surveyId: input.surveyId,
        userId: input.userId,
      },
    },
    update: {
      canView: input.canView,
      canCreate: input.canCreate,
      canEdit: input.canEdit,
      canDelete: input.canDelete,
      canResults: input.canResults,
    },
    create: input,
  });
}

export async function deleteParticipant(actorId: string, userId: string) {
  const scope = await getParticipantManagerScope(actorId);
  if (!scope?.canManage) {
    throw new Error("Недостаточно прав для удаления участников.");
  }

  if (!scope.isAdmin) {
    const participant = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        acceptedInvitation: true,
      },
    });

    if (!participant || participant.acceptedInvitation?.invitedById !== actorId) {
      throw new Error("Можно удалять только своих участников.");
    }
  }

  await prisma.$transaction([
    prisma.session.deleteMany({
      where: { userId },
    }),
    prisma.user.update({
      where: { id: userId },
      data: {
        status: UserStatus.DELETED,
        deletedAt: new Date(),
      },
    }),
  ]);
}

export async function getProfileData(userId: string) {
  return prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      telegramConnection: true,
    },
  });
}

export async function syncTelegramConnection(userId: string, username: string) {
  const chatId = await resolveTelegramChatIdByUsername(username);

  const connection = await prisma.telegramConnection.upsert({
    where: { userId },
    update: {
      username,
      chatId,
      status: chatId ? "ACTIVE" : "PENDING",
      activatedAt: chatId ? new Date() : null,
      lastCheckAt: new Date(),
    },
    create: {
      userId,
      username,
      chatId,
      status: chatId ? "ACTIVE" : "PENDING",
      activatedAt: chatId ? new Date() : null,
      lastCheckAt: new Date(),
    },
  });

  return connection;
}

export async function listSurveyResults(
  surveyId: string,
  actorId: string,
  filters: {
    status?: ResponseStatus | "ALL";
    dateFrom?: string | null;
    dateTo?: string | null;
    sort?: "newest" | "oldest" | "score_desc" | "score_asc";
    search?: string | null;
  },
) {
  await resolveSurveyAccess(surveyId, actorId, "results");
  await expireTimedOutResponseSessionsForSurvey(surveyId);

  const orderBy =
    filters.sort === "oldest"
      ? ({ startedAt: "asc" } satisfies Prisma.ResponseSessionOrderByWithRelationInput)
      : filters.sort === "score_desc"
        ? ({ totalScore: "desc" } satisfies Prisma.ResponseSessionOrderByWithRelationInput)
        : filters.sort === "score_asc"
          ? ({ totalScore: "asc" } satisfies Prisma.ResponseSessionOrderByWithRelationInput)
          : ({ startedAt: "desc" } satisfies Prisma.ResponseSessionOrderByWithRelationInput);

  const results = await prisma.responseSession.findMany({
    where: {
      surveyId,
      status: filters.status && filters.status !== "ALL" ? filters.status : undefined,
      NOT: {
        status: ResponseStatus.IN_PROGRESS,
      },
      startedAt: {
        gte: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
        lte: filters.dateTo ? new Date(`${filters.dateTo}T23:59:59.999Z`) : undefined,
      },
    },
    include: {
      answers: {
        orderBy: { sortOrder: "asc" },
      },
    },
    orderBy,
  });

  const normalizedSearch = normalizeResultsSearchTerm(filters.search);
  if (!normalizedSearch) {
    return results;
  }

  return results.filter((result) => resultMatchesResultsSearch(result, normalizedSearch));
}

const AI_RESULT_SEARCH_MARKERS: Record<NonNullable<ReturnType<typeof extractAiNoteColor>>, string> = {
  КРАСНЫЙ: "🔴",
  ЖЕЛТЫЙ: "🟡",
  ЗЕЛЕНЫЙ: "🟢",
};

function normalizeResultsSearchTerm(value: string | null | undefined) {
  return value?.normalize("NFKC").toLocaleLowerCase("ru-RU").replaceAll("ё", "е").trim() ?? "";
}

function flattenJsonSearchValues(value: Prisma.JsonValue | null | undefined): string[] {
  if (value == null) {
    return [];
  }

  if (typeof value === "string") {
    return [value];
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenJsonSearchValues(item));
  }

  if (typeof value === "object") {
    return Object.values(value as Prisma.JsonObject).flatMap((item) => flattenJsonSearchValues(item as Prisma.JsonValue));
  }

  return [];
}

function resultMatchesResultsSearch(
  result: {
    id: string;
    status: ResponseStatus;
    aiNote: string | null;
    respondentData: Prisma.JsonValue | null;
    answers: Parameters<typeof mapAnswersToRows>[0];
  },
  normalizedSearch: string,
) {
  const aiColor = extractAiNoteColor(result.aiNote);
  const searchableParts = [
    result.id,
    result.status,
    result.aiNote ?? "",
    ...(aiColor ? [aiColor, AI_RESULT_SEARCH_MARKERS[aiColor]] : []),
    ...flattenJsonSearchValues(result.respondentData),
    ...mapAnswersToRows(result.answers).flatMap((answer) => [answer.prompt, answer.value]),
  ];

  return searchableParts.some((part) => normalizeResultsSearchTerm(part).includes(normalizedSearch));
}

export async function getResponseCopyText(responseId: string, actorId: string) {
  const response = await prisma.responseSession.findUnique({
    where: { id: responseId },
    include: {
      answers: {
        orderBy: { sortOrder: "asc" },
      },
      surveyVersion: true,
    survey: {
      include: {
        publishedVersion: true,
        aiAnalysisRule: true,
      },
    },
    },
  });

  if (!response) {
    throw new Error("Результат не найден.");
  }

  await resolveSurveyAccess(response.surveyId, actorId, "results");
  const schema = normalizeSurveySchema(
    response.surveyVersion?.schema ?? response.survey.publishedVersion?.schema ?? createDefaultSurveySchema(response.survey.title),
    response.surveyVersion?.title ?? response.survey.title,
  );
  const analysisMaxScore = extractSurveyAnalysisMaxScore(response.survey.aiAnalysisRule?.prompt);
  const configuredMaxScore = schema.settings.scoringEnabled ? calculateSurveyMaxScore(schema) : 0;
  const questionMaxScore = calculateSurveyQuestionMaxScore(schema);
  const maxScore = analysisMaxScore ?? (configuredMaxScore > 0 ? configuredMaxScore : questionMaxScore);
  const aiScoreSummary = inferAiScoreSummary(response.aiNote, maxScore);
  const totalScore = configuredMaxScore > 0 ? response.totalScore : (aiScoreSummary?.totalScore ?? response.totalScore);
  const hasScoreSummary = configuredMaxScore > 0;

  return buildResultCopyText({
    surveyTitle: response.survey.title,
    status: response.status,
    totalScore,
    maxScore,
    startedAt: response.startedAt,
    completedAt: response.completedAt,
    answers: response.answers,
    aiNote: response.aiNote,
    answerPromptOverrides: buildResultPromptOverrides(schema),
    includeScore: hasScoreSummary,
    includeAnswerScores: configuredMaxScore > 0,
  });
}

export async function deleteSurveyResult(surveyId: string, responseId: string, actorId: string) {
  await resolveSurveyAccess(surveyId, actorId, "delete");

  const response = await prisma.responseSession.findUnique({
    where: { id: responseId },
    select: {
      id: true,
      surveyId: true,
    },
  });

  if (!response || response.surveyId !== surveyId) {
    throw new Error("Результат не найден.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.responseAnswer.deleteMany({
      where: { sessionId: response.id },
    });

    await tx.responseSession.delete({
      where: { id: response.id },
    });
  });
}

export async function retryResponseTelegramNotification(surveyId: string, responseId: string, actorId: string) {
  await resolveSurveyAccess(surveyId, actorId, "results");

  const response = await prisma.responseSession.findFirst({
    where: {
      id: responseId,
      surveyId,
    },
    include: {
      survey: {
        include: {
          notificationConfig: true,
        },
      },
    },
  });

  if (!response) {
    throw new Error("Р РµР·СѓР»СЊС‚Р°С‚ РЅРµ РЅР°Р№РґРµРЅ.");
  }

  if (response.status === ResponseStatus.IN_PROGRESS) {
    throw new Error("Telegram-СѓРІРµРґРѕРјР»РµРЅРёРµ РјРѕР¶РЅРѕ РїРѕРІС‚РѕСЂРёС‚СЊ С‚РѕР»СЊРєРѕ РґР»СЏ Р·Р°РІРµСЂС€С‘РЅРЅРѕРіРѕ СЂРµР·СѓР»СЊС‚Р°С‚Р°.");
  }

  if (!response.survey.notificationConfig?.telegramEnabled) {
    throw new Error("Telegram-СѓРІРµРґРѕРјР»РµРЅРёСЏ РґР»СЏ СЌС‚РѕРіРѕ РѕРїСЂРѕСЃР° РІС‹РєР»СЋС‡РµРЅС‹.");
  }

  await prisma.responseSession.update({
    where: { id: response.id },
    data: {
      telegramStatus: JobStatus.PENDING,
    },
  });

  try {
    const boss = await getBoss();
    await boss.send(RESPONSE_NOTIFICATION_QUEUE, {
      sessionId: response.id,
    });
  } catch (error) {
    await prisma.responseSession.update({
      where: { id: response.id },
      data: {
        telegramStatus: JobStatus.FAILED,
      },
    });
    throw error;
  }
}

export async function recalculateTimedOutResponseResult(surveyId: string, responseId: string, actorId: string) {
  await resolveSurveyAccess(surveyId, actorId, "results");

  const response = await prisma.responseSession.findFirst({
    where: {
      id: responseId,
      surveyId,
    },
    include: {
      answers: {
        orderBy: { sortOrder: "asc" },
      },
      surveyVersion: true,
      survey: {
        include: {
          publishedVersion: true,
          notificationConfig: true,
          aiAnalysisRule: true,
        },
      },
    },
  });

  if (!response) {
    throw new Error("Р РµР·СѓР»СЊС‚Р°С‚ РЅРµ РЅР°Р№РґРµРЅ.");
  }

  if (response.status !== ResponseStatus.TIMED_OUT) {
    throw new Error("РџРµСЂРµСЃС‡РёС‚Р°С‚СЊ РјРѕР¶РЅРѕ С‚РѕР»СЊРєРѕ СЂРµР·СѓР»СЊС‚Р°С‚ СЃ РёСЃС‚С‘РєС€РёРј РІСЂРµРјРµРЅРµРј.");
  }

  const schema = buildResponseSchema(response.survey, response.surveyVersion);
  const updated = await prisma.$transaction(async (tx) => {
    const answers = await persistTimedOutAverageAnswers(tx, response.id, schema, response.answers);

    return tx.responseSession.update({
      where: { id: response.id },
      data: {
        totalScore: answers.reduce((sum, answer) => sum + answer.score, 0),
        aiNote: null,
        aiResultColor: null,
        aiStatus: response.survey.aiAnalysisRule?.enabled ? JobStatus.PENDING : JobStatus.SKIPPED,
        telegramStatus: response.survey.notificationConfig?.telegramEnabled ? JobStatus.PENDING : JobStatus.SKIPPED,
      },
      include: {
        answers: {
          orderBy: { sortOrder: "asc" },
        },
      },
    });
  });

  const boss = await getBoss();
  await boss.send(RESPONSE_NOTIFICATION_QUEUE, {
    sessionId: updated.id,
  });

  return updated;
}

export async function createResponseRetakeLink(surveyId: string, responseId: string, actorId: string) {
  await resolveSurveyAccess(surveyId, actorId, "results");

  const response = await prisma.responseSession.findFirst({
    where: {
      id: responseId,
      surveyId,
    },
    include: {
      survey: {
        select: {
          publicSlug: true,
        },
      },
    },
  });

  if (!response) {
    throw new Error("Результат не найден.");
  }

  if (response.status === ResponseStatus.IN_PROGRESS) {
    throw new Error("Повторную ссылку можно создать только для уже завершённой попытки.");
  }

  const token = nanoid(48);
  const expiresAt = addDays(new Date(), RETAKE_LINK_TTL_DAYS);

  await prisma.responseRetakeToken.create({
    data: {
      surveyId,
      responseSessionId: response.id,
      tokenHash: hashToken(token),
      expiresAt,
    },
  });

  return {
    retakeUrl: `${env.APP_URL}/s/${response.survey.publicSlug}?retake=${token}`,
    expiresAt,
  };
}

async function getPublishedSurveyForResponse(surveyId: string) {
  const survey = await prisma.survey.findUnique({
    where: { id: surveyId },
    include: {
      publishedVersion: true,
      notificationConfig: true,
      aiAnalysisRule: true,
      owner: true,
    },
  });

  if (!survey?.publishedVersion) {
    throw new Error("Опрос ещё не опубликован.");
  }

  const schema = coerceSurveyNavigationTargets(normalizeSurveySchema(survey.publishedVersion.schema, survey.title));

  return {
    survey,
    schema: {
      ...schema,
      settings: {
        ...schema.settings,
        autoScrollEnabled: survey.autoScrollEnabled,
        timerEnabled: survey.timerEnabled,
        timerSeconds: survey.timerEnabled ? survey.timerSeconds : null,
        completionMessage: survey.completionMessage,
      },
    },
  };
}

type ResponseCompletionStatus = "COMPLETED" | "PARTIAL" | "TIMED_OUT";

type ResponseTimerAnswer = {
  blockId: string;
  blockType?: BlockType | string;
  prompt?: string;
  value?: Prisma.JsonValue;
  rawValue?: Prisma.JsonValue | null;
  score: number;
  sortOrder?: number;
  createdAt?: Date | null;
};

type ResponseTimerSession = {
  id: string;
  respondentKey?: string;
  status: ResponseStatus;
  startedAt: Date;
  timerStartedAt: Date | null;
  updatedAt: Date;
  completedAt?: Date | null;
  timedOutAt?: Date | null;
  lastBlockId: string | null;
  respondentData?: Prisma.JsonValue | null;
  answers: ResponseTimerAnswer[];
};

function getResponseTimerSeconds(schema: SurveySchema) {
  const seconds = schema.settings.timerEnabled ? schema.settings.timerSeconds : null;

  return typeof seconds === "number" && seconds > 0 ? seconds : null;
}

function shouldStartResponseTimerImmediately(schema: SurveySchema) {
  return Boolean(getResponseTimerSeconds(schema)) && schema.blocks[0]?.type !== "WELCOME";
}

function getResponseTimerDeadlineAt(timerStartedAt: Date | null, schema: SurveySchema) {
  const seconds = getResponseTimerSeconds(schema);

  if (!seconds || !timerStartedAt) {
    return null;
  }

  return new Date(timerStartedAt.getTime() + seconds * 1000);
}

function getResponseTimerExpirationState(session: Pick<ResponseTimerSession, "timerStartedAt">, schema: SurveySchema, now = new Date()) {
  const deadlineAt = getResponseTimerDeadlineAt(session.timerStartedAt, schema);
  const expired = Boolean(deadlineAt && deadlineAt <= now);
  const graceUntil = deadlineAt ? new Date(deadlineAt.getTime() + RESPONSE_TIMEOUT_CLIENT_GRACE_MS) : null;

  return {
    deadlineAt,
    expired,
    withinClientGrace: Boolean(graceUntil && now <= graceUntil),
  };
}

async function enqueueResponseTimeout(session: Pick<ResponseTimerSession, "id" | "timerStartedAt">, schema: SurveySchema) {
  const deadlineAt = getResponseTimerDeadlineAt(session.timerStartedAt, schema);

  if (!deadlineAt) {
    return;
  }

  try {
    const boss = await getBoss();
    await boss.send(
      RESPONSE_TIMEOUT_QUEUE,
      {
        sessionId: session.id,
        deadlineAt: deadlineAt.toISOString(),
      },
      {
        startAfter: deadlineAt,
        retryLimit: 3,
        retryDelay: 30,
        retryBackoff: true,
      },
    );
  } catch (error) {
    console.error("Unable to schedule response timeout", error);
  }
}

function getResponseTimerMeta(session: ResponseTimerSession, schema: SurveySchema, now = new Date()) {
  const timerDeadlineAt = getResponseTimerDeadlineAt(session.timerStartedAt, schema);
  const secondsLeft = timerDeadlineAt
    ? Math.max(0, Math.ceil((timerDeadlineAt.getTime() - now.getTime()) / 1000))
    : null;

  return {
    status: session.status,
    timerStartedAt: session.timerStartedAt,
    timerDeadlineAt,
    secondsLeft,
  };
}

function getFirstAnswerCreatedAt(answers: ResponseTimerAnswer[]) {
  return answers.reduce<Date | null>((earliest, answer) => {
    if (!answer.createdAt) {
      return earliest;
    }

    return !earliest || answer.createdAt < earliest ? answer.createdAt : earliest;
  }, null);
}

type ResponseSchemaSurvey = {
  title: string;
  autoScrollEnabled: boolean;
  timerEnabled: boolean;
  timerSeconds: number | null;
  completionMessage: string;
  publishedVersion?: {
    title: string;
    schema: Prisma.JsonValue;
  } | null;
};

type ResponseSchemaVersion = {
  title: string;
  schema: Prisma.JsonValue;
} | null;

function buildResponseSchema(survey: ResponseSchemaSurvey, surveyVersion?: ResponseSchemaVersion) {
  const normalizedSchema = coerceSurveyNavigationTargets(
    normalizeSurveySchema(
      surveyVersion?.schema ?? survey.publishedVersion?.schema ?? createDefaultSurveySchema(survey.title),
      surveyVersion?.title ?? survey.title,
    ),
  );

  return {
    ...normalizedSchema,
    settings: {
      ...normalizedSchema.settings,
      autoScrollEnabled: survey.autoScrollEnabled,
      timerEnabled: survey.timerEnabled,
      timerSeconds: survey.timerEnabled ? survey.timerSeconds : null,
      completionMessage: survey.completionMessage,
    },
  };
}

function getDefaultCompletionNextBlockId(schema: SurveySchema, block: SurveyBlock) {
  return block.nextBlockId ?? getNextSequentialBlockId(schema, block.id);
}

function getNextBlockIdFromPersistedAnswer(schema: SurveySchema, block: SurveyBlock, answer: ResponseTimerAnswer) {
  try {
    return evaluateAnswer(schema, block, answer.rawValue ?? answer.value ?? null).nextBlockId;
  } catch {
    return getDefaultCompletionNextBlockId(schema, block);
  }
}

function toPersistedBlockType(blockType: SurveyBlock["type"]) {
  return (blockType === "COMBINED" ? "TEXT" : blockType) as BlockType;
}

type ResponseAnswerClient = Pick<Prisma.TransactionClient, "responseAnswer">;

async function persistTimedOutAverageAnswers(
  db: ResponseAnswerClient,
  sessionId: string,
  schema: SurveySchema,
  answers: ResponseTimerAnswer[],
) {
  const blocksById = new Map(schema.blocks.map((block) => [block.id, block]));
  const answersByBlockId = new Map(answers.map((answer) => [answer.blockId, answer]));
  const visitedBlockIds = new Set<string>();
  const missingAnswers: Prisma.ResponseAnswerCreateManyInput[] = [];
  let currentBlockId: string | null = schema.blocks[0]?.id ?? null;

  while (currentBlockId && !isFinishSurveyTarget(currentBlockId) && !visitedBlockIds.has(currentBlockId)) {
    const block = blocksById.get(currentBlockId);
    if (!block) {
      break;
    }

    visitedBlockIds.add(currentBlockId);

    if (block.type === "WELCOME") {
      currentBlockId = getDefaultCompletionNextBlockId(schema, block);
      continue;
    }

    const existingAnswer = answersByBlockId.get(block.id);
    if (existingAnswer) {
      currentBlockId = getNextBlockIdFromPersistedAnswer(schema, block, existingAnswer);
      continue;
    }

    if (block.type !== "CONTACT") {
      const evaluated = evaluateUnansweredAverageAnswer(schema, block);
      missingAnswers.push({
        sessionId,
        blockId: block.id,
        blockType: toPersistedBlockType(evaluated.blockType),
        prompt: evaluated.prompt,
        value: evaluated.value as Prisma.InputJsonValue,
        score: evaluated.score,
        sortOrder: schema.blocks.findIndex((entry) => entry.id === block.id),
      });
      currentBlockId = evaluated.nextBlockId;
      continue;
    }

    currentBlockId = getDefaultCompletionNextBlockId(schema, block);
  }

  if (missingAnswers.length > 0) {
    await db.responseAnswer.createMany({
      data: missingAnswers,
      skipDuplicates: true,
    });

    return db.responseAnswer.findMany({
      where: { sessionId },
      orderBy: { sortOrder: "asc" },
    });
  }

  return answers;
}

async function finalizeResponseSession(
  session: Pick<ResponseTimerSession, "id" | "status" | "answers">,
  status: ResponseCompletionStatus,
  completedAt = new Date(),
  schema?: SurveySchema,
) {
  const finalized = await prisma.$transaction(async (tx) => {
    const updateResult = await tx.responseSession.updateMany({
      where: {
        id: session.id,
        status: ResponseStatus.IN_PROGRESS,
      },
      data: {
        status,
        completedAt,
        timedOutAt: status === ResponseStatus.TIMED_OUT ? completedAt : null,
      },
    });

    if (updateResult.count !== 1) {
      return {
        transitioned: false,
        response: await tx.responseSession.findUniqueOrThrow({
          where: { id: session.id },
          include: {
            answers: {
              orderBy: { sortOrder: "asc" },
            },
          },
        }),
      };
    }

    const answers =
      status === ResponseStatus.TIMED_OUT && schema
        ? await persistTimedOutAverageAnswers(tx, session.id, schema, session.answers)
        : session.answers;
    const response = await tx.responseSession.update({
      where: { id: session.id },
      data: {
        totalScore: answers.reduce((sum, answer) => sum + answer.score, 0),
      },
      include: {
        answers: {
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    return {
      transitioned: true,
      response,
    };
  });
  const updated = finalized.response;

  if (finalized.transitioned) {
    const boss = await getBoss();
    await boss.send(RESPONSE_NOTIFICATION_QUEUE, {
      sessionId: updated.id,
    });
  }

  return updated;
}

async function ensureResponseTimerState<T extends ResponseTimerSession>(
  session: T,
  schema: SurveySchema,
  options?: {
    startNow?: boolean;
    lastBlockId?: string | null;
    throwOnExpired?: boolean;
  },
) {
  const timerSeconds = getResponseTimerSeconds(schema);
  const firstBlock = schema.blocks[0] ?? null;
  const startsWithWelcome = firstBlock?.type === "WELCOME";
  const firstAnswerCreatedAt = getFirstAnswerCreatedAt(session.answers);
  const shouldStartTimer =
    Boolean(timerSeconds) &&
    !session.timerStartedAt &&
    (options?.startNow ||
      !startsWithWelcome ||
      Boolean(firstAnswerCreatedAt) ||
      Boolean(session.lastBlockId && session.lastBlockId !== firstBlock?.id));

  let timerStartedAt = session.timerStartedAt;
  if (shouldStartTimer) {
    timerStartedAt = options?.startNow
      ? new Date()
      : startsWithWelcome
        ? firstAnswerCreatedAt ?? session.updatedAt
        : session.startedAt;
  }

  const data: Prisma.ResponseSessionUpdateInput = {};
  if (timerStartedAt && !session.timerStartedAt) {
    data.timerStartedAt = timerStartedAt;
  }
  if (options && "lastBlockId" in options) {
    data.lastBlockId = options.lastBlockId ?? null;
  }

  const current =
    Object.keys(data).length > 0
      ? await prisma.responseSession.update({
          where: { id: session.id },
          data,
          include: {
            answers: {
              orderBy: { sortOrder: "asc" },
            },
          },
        })
      : session;

  if (timerStartedAt && !session.timerStartedAt) {
    await enqueueResponseTimeout(current, schema);
  }

  const meta = getResponseTimerMeta(current, schema);
  if (current.status === ResponseStatus.IN_PROGRESS && meta.timerDeadlineAt && meta.secondsLeft === 0) {
    const timedOut = await finalizeResponseSession(current, ResponseStatus.TIMED_OUT, meta.timerDeadlineAt, schema);

    if (options?.throwOnExpired) {
      throw new ResponseTimerExpiredError();
    }

    return {
      ...timedOut,
      ...getResponseTimerMeta(timedOut, schema),
    };
  }

  return {
    ...current,
    ...meta,
  };
}

async function expireTimedOutResponseSessionsForSurvey(surveyId: string) {
  const published = await getPublishedSurveyForResponse(surveyId).catch(() => null);

  if (!published || !getResponseTimerSeconds(published.schema)) {
    return;
  }

  const sessions = await prisma.responseSession.findMany({
    where: {
      surveyId,
      surveyVersionId: published.survey.publishedVersionId,
      status: ResponseStatus.IN_PROGRESS,
    },
    include: {
      answers: {
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  for (const session of sessions) {
    await ensureResponseTimerState(session, published.schema);
  }
}

type TimeoutResponseSession = {
  id: string;
  status: ResponseStatus;
  startedAt: Date;
  timerStartedAt: Date | null;
  updatedAt: Date;
  completedAt: Date | null;
  timedOutAt: Date | null;
  lastBlockId: string | null;
  respondentData: Prisma.JsonValue | null;
  answers: ResponseTimerAnswer[];
  surveyVersion: ResponseSchemaVersion;
  survey: ResponseSchemaSurvey;
};

const timeoutResponseSessionInclude = {
  answers: {
    orderBy: { sortOrder: "asc" },
  },
  surveyVersion: true,
  survey: {
    include: {
      publishedVersion: true,
    },
  },
} satisfies Prisma.ResponseSessionInclude;

async function finalizeTimedOutResponseSessionRecord(session: TimeoutResponseSession, now = new Date()) {
  if (session.status !== ResponseStatus.IN_PROGRESS) {
    return null;
  }

  const schema = buildResponseSchema(session.survey, session.surveyVersion);
  const timerState = getResponseTimerExpirationState(session, schema, now);

  if (!timerState.deadlineAt || !timerState.expired || timerState.withinClientGrace) {
    return null;
  }

  return finalizeResponseSession(session, ResponseStatus.TIMED_OUT, timerState.deadlineAt, schema);
}

export async function finalizeTimedOutResponseSession(sessionId: string, now = new Date()) {
  const session = await prisma.responseSession.findUnique({
    where: { id: sessionId },
    include: timeoutResponseSessionInclude,
  });

  if (!session) {
    return null;
  }

  return finalizeTimedOutResponseSessionRecord(session, now);
}

export async function finalizeDueTimedOutResponseSessions(now = new Date()) {
  const sessions = await prisma.responseSession.findMany({
    where: {
      status: ResponseStatus.IN_PROGRESS,
      timerStartedAt: {
        not: null,
      },
      survey: {
        timerEnabled: true,
      },
    },
    include: timeoutResponseSessionInclude,
    orderBy: { timerStartedAt: "asc" },
  });
  const finalized = [];

  for (const session of sessions) {
    const response = await finalizeTimedOutResponseSessionRecord(session, now);
    if (response) {
      finalized.push(response);
    }
  }

  return finalized;
}

async function getInProgressResponseContext(surveyId: string, options?: { handleExpired?: boolean; throwOnExpired?: boolean }) {
  const cookieStore = await cookies();
  const respondentKey = cookieStore.get(publicResponseCookieName(surveyId))?.value;

  if (!respondentKey) {
    throw new Error("Сессия прохождения не найдена.");
  }

  const session = await prisma.responseSession.findFirst({
    where: {
      surveyId,
      respondentKey,
      status: ResponseStatus.IN_PROGRESS,
    },
    include: {
      answers: {
        orderBy: { sortOrder: "asc" },
      },
      surveyVersion: true,
      survey: {
        include: {
          publishedVersion: true,
          notificationConfig: true,
          aiAnalysisRule: true,
        },
      },
    },
  });

  if (!session) {
    throw new Error("Сессия прохождения не найдена.");
  }

  const schema = buildResponseSchema(session.survey, session.surveyVersion);
  const checkedSession =
    options?.handleExpired === false
      ? session
      : await ensureResponseTimerState(session, schema, { throwOnExpired: options?.throwOnExpired ?? true });

  return {
    session: checkedSession,
    survey: session.survey,
    schema,
  };
}

export async function saveResponseAttachment(
  surveyId: string,
  blockId: string,
  file: File,
  kind: "file" | "voice",
  options?: { attachToResult?: boolean },
) {
  const { schema, survey } = await getInProgressResponseContext(surveyId);
  const block = schema.blocks.find((entry) => entry.id === blockId);

  if (!block || block.type !== "TEXT") {
    throw new Error("Файлы и голосовые ответы доступны только для текстового вопроса.");
  }

  if (kind === "voice" && !block.allowVoiceAnswer) {
    throw new Error("Голосовой ответ отключён для этого вопроса.");
  }

  if (kind === "file" && !block.allowFileAnswer) {
    throw new Error("Прикрепление файла отключено для этого вопроса.");
  }

  const saved = await saveUploadedFile(file, surveyId, {
    purpose: kind === "voice" ? "voice-answer" : "response-attachment",
  });
  const asset = await prisma.mediaAsset.create({
    data: {
      surveyId,
      originalName: saved.originalName,
      filename: saved.filename,
      mimeType: saved.mimeType,
      byteSize: saved.byteSize,
      storagePath: saved.storagePath,
    },
  });
  const aiRule = survey.aiAnalysisRule;
  const transcription =
    kind === "voice"
      ? await transcribeVoiceAnswer({
          file,
          provider: aiRule?.provider ?? null,
          apiKey: decryptOptionalSecret(aiRule?.apiKeyEncrypted),
        })
      : null;
  const shouldAttachToResult =
    kind !== "voice" || (block.attachVoiceAnswerToResult !== false && options?.attachToResult !== false);
  const result = {
    id: asset.id,
    url: withBasePath(`/api/media/${asset.id}`),
    originalName: asset.originalName,
    filename: asset.filename,
    mimeType: asset.mimeType,
    byteSize: asset.byteSize,
    kind,
    transcript: transcription?.text || null,
    transcriptionStatus: transcription ? (transcription.text ? "completed" : transcription.error ? "failed" : "skipped") : undefined,
    transcriptionError: transcription?.error || null,
  };

  if (!shouldAttachToResult) {
    await prisma.mediaAsset.delete({
      where: { id: asset.id },
    });
    await deleteStoredFile(saved.storagePath);
  }

  return result;
}

async function consumeResponseRetakeToken(surveyId: string, token: string) {
  const tokenHash = hashToken(token.trim());
  const now = new Date();
  const retakeToken = await prisma.responseRetakeToken.findUnique({
    where: { tokenHash },
  });

  if (!retakeToken || retakeToken.surveyId !== surveyId || retakeToken.usedAt || retakeToken.expiresAt <= now) {
    throw new Error("Одноразовая ссылка повторного прохождения недействительна или уже использована.");
  }

  const updated = await prisma.responseRetakeToken.updateMany({
    where: {
      id: retakeToken.id,
      usedAt: null,
      expiresAt: {
        gt: now,
      },
    },
    data: {
      usedAt: now,
    },
  });

  if (updated.count !== 1) {
    throw new Error("Одноразовая ссылка повторного прохождения уже использована.");
  }
}

export async function initResponseSession(surveyId: string, options?: { restart?: boolean; retakeToken?: string | null }) {
  const cookieStore = await cookies();
  const cookieName = publicResponseCookieName(surveyId);
  const existingRespondentKey = cookieStore.get(cookieName)?.value;

  const published = await getPublishedSurveyForResponse(surveyId);
  const retakeToken = options?.retakeToken?.trim() || null;
  const hasRetakeToken = Boolean(retakeToken);
  const restartAllowed = Boolean(options?.restart && published.schema.settings.showRestartButton) || hasRetakeToken;

  if (options?.restart && !restartAllowed) {
    throw new Error("Повторное прохождение этого опроса отключено. Запросите одноразовую ссылку у администратора.");
  }

  if (retakeToken) {
    await consumeResponseRetakeToken(surveyId, retakeToken);
  }

  if (existingRespondentKey) {
    const existing = await prisma.responseSession.findFirst({
      where: {
        surveyId,
        respondentKey: existingRespondentKey,
        surveyVersionId: published.survey.publishedVersionId,
      },
      include: {
        answers: {
          orderBy: { sortOrder: "asc" },
        },
      },
      orderBy: { startedAt: "desc" },
    });

    if (existing) {
      if (restartAllowed) {
        if (existing.status === ResponseStatus.IN_PROGRESS) {
          await finalizeResponseSession(existing, ResponseStatus.PARTIAL);
        }
      } else if (existing.status !== ResponseStatus.IN_PROGRESS) {
        return {
          ...existing,
          ...getResponseTimerMeta(existing, published.schema),
        };
      } else if (existing.status === ResponseStatus.IN_PROGRESS) {
        return ensureResponseTimerState(existing, published.schema);
      }
    }
  }

  const respondentKey = nanoid(24);
  const now = new Date();
  const session = await prisma.responseSession.create({
    data: {
      surveyId,
      surveyVersionId: published.survey.publishedVersionId,
      respondentKey,
      status: ResponseStatus.IN_PROGRESS,
      startedAt: now,
      timerStartedAt: shouldStartResponseTimerImmediately(published.schema) ? now : null,
    },
    include: {
      answers: {
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  if (session.timerStartedAt) {
    await enqueueResponseTimeout(session, published.schema);
  }

  cookieStore.set(cookieName, respondentKey, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.APP_URL.startsWith("https://"),
    path: "/",
    expires: addDays(new Date(), 30),
  });

  return {
    ...session,
    ...getResponseTimerMeta(session, published.schema),
  };
}

export async function startResponseTimer(surveyId: string, nextBlockId: string | null) {
  const { session, schema } = await getInProgressResponseContext(surveyId);
  const normalizedNextBlockId =
    nextBlockId && !isFinishSurveyTarget(nextBlockId) && schema.blocks.some((block) => block.id === nextBlockId)
      ? nextBlockId
      : null;
  const updated = await ensureResponseTimerState(session, schema, {
    startNow: true,
    lastBlockId: normalizedNextBlockId,
    throwOnExpired: true,
  });

  return {
    nextBlockId: normalizedNextBlockId,
    status: updated.status,
    timerStartedAt: updated.timerStartedAt,
    timerDeadlineAt: updated.timerDeadlineAt,
    secondsLeft: updated.secondsLeft,
  };
}

export async function recordResponseAnswer(
  surveyId: string,
  blockId: string,
  value: unknown,
  options?: { allowPartial?: boolean },
) {
  const { session, survey, schema } = await getInProgressResponseContext(surveyId, { handleExpired: false });
  const timerState = getResponseTimerExpirationState(session, schema);
  if (timerState.expired && (!timerState.withinClientGrace || !timerState.deadlineAt)) {
    await finalizeResponseSession(session, ResponseStatus.TIMED_OUT, timerState.deadlineAt ?? new Date(), schema);
    throw new ResponseTimerExpiredError();
  }

  const block = schema.blocks.find((entry) => entry.id === blockId);
  if (!block) {
    throw new Error("Вопрос не найден.");
  }

  if (block.required && !options?.allowPartial && !isBlockAnswered(block, value)) {
    throw new Error("На обязательный вопрос нужно ответить.");
  }

  if (block.type === "TEXT") {
    if (isTextAnswerBelowMinimum(block, value)) {
      throw new Error(`Минимальная длина ответа: ${block.minLength} символов.`);
    }
  }

  if (block.type === "COMBINED" && isCombinedTextBelowMinimum(block, value)) {
    throw new Error(`Минимальная длина ответа: ${block.textMinLength} символов.`);
  }

  const evaluated = evaluateAnswer(schema, block, value);
  const persistedBlockType = (evaluated.blockType === "COMBINED" ? "TEXT" : evaluated.blockType) as BlockType;
  const sortOrder = schema.blocks.findIndex((entry) => entry.id === block.id);

  await prisma.responseAnswer.upsert({
    where: {
      sessionId_blockId: {
        sessionId: session.id,
        blockId: block.id,
      },
    },
    update: {
      blockType: persistedBlockType,
      prompt: evaluated.prompt,
      value: evaluated.value as unknown as Prisma.InputJsonValue,
      rawValue: value as unknown as Prisma.InputJsonValue,
      score: evaluated.score,
      sortOrder,
    },
    create: {
      sessionId: session.id,
      blockId: block.id,
      blockType: persistedBlockType,
      prompt: evaluated.prompt,
      value: evaluated.value as unknown as Prisma.InputJsonValue,
      rawValue: value as unknown as Prisma.InputJsonValue,
      score: evaluated.score,
      sortOrder,
    },
  });

  const answers = await prisma.responseAnswer.findMany({
    where: { sessionId: session.id },
  });

  await prisma.responseSession.update({
    where: { id: session.id },
    data: {
      lastBlockId: evaluated.nextBlockId && !isFinishSurveyTarget(evaluated.nextBlockId) ? evaluated.nextBlockId : block.id,
      totalScore: answers.reduce((sum, answer) => sum + answer.score, 0),
      respondentData: (evaluated.respondentData
        ? {
            ...(session.respondentData && typeof session.respondentData === "object" ? session.respondentData : {}),
            ...evaluated.respondentData,
          }
        : session.respondentData) as unknown as Prisma.InputJsonValue,
      aiResultColor: null,
      aiStatus: survey.aiAnalysisRule?.enabled ? JobStatus.PENDING : JobStatus.SKIPPED,
      telegramStatus: survey.notificationConfig?.telegramEnabled ? JobStatus.PENDING : JobStatus.SKIPPED,
    },
  });

  if (timerState.expired && !options?.allowPartial && timerState.deadlineAt) {
    await finalizeResponseSession({ id: session.id, status: session.status, answers }, ResponseStatus.TIMED_OUT, timerState.deadlineAt, schema);
    throw new ResponseTimerExpiredError();
  }

  return evaluated;
}

export async function completeResponseSession(surveyId: string, status: "COMPLETED" | "PARTIAL" | "TIMED_OUT") {
  const cookieStore = await cookies();
  const respondentKey = cookieStore.get(publicResponseCookieName(surveyId))?.value;
  if (!respondentKey) {
    throw new Error("Сессия прохождения не найдена.");
  }

  const session = await prisma.responseSession.findFirst({
    where: {
      surveyId,
      respondentKey,
      status: ResponseStatus.IN_PROGRESS,
    },
    include: {
      answers: {
        orderBy: { sortOrder: "asc" },
      },
      surveyVersion: true,
      survey: {
        include: {
          publishedVersion: true,
        },
      },
    },
  });

  if (!session) {
    return null;
  }

  const schema = buildResponseSchema(session.survey, session.surveyVersion);

  return finalizeResponseSession(session, status, undefined, schema);
}

export async function resetInProgressResponseSession(surveyId: string) {
  const cookieStore = await cookies();
  const cookieName = publicResponseCookieName(surveyId);
  const respondentKey = cookieStore.get(cookieName)?.value;
  let deletedCount = 0;

  if (respondentKey) {
    const deleted = await prisma.responseSession.deleteMany({
      where: {
        surveyId,
        respondentKey,
        status: ResponseStatus.IN_PROGRESS,
      },
    });

    deletedCount = deleted.count;
  }

  if (deletedCount > 0) {
    cookieStore.set(cookieName, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: env.APP_URL.startsWith("https://"),
      path: "/",
      expires: new Date(0),
    });
    cookieStore.delete(cookieName);
  }

  return { ok: true, reset: deletedCount > 0 };
}

export async function purgeArchivedSurveys() {
  const expired = await prisma.survey.findMany({
    where: {
      lifecycleStatus: SurveyLifecycleStatus.ARCHIVED,
      purgeAt: {
        lte: new Date(),
      },
    },
    include: {
      mediaAssets: true,
    },
  });

  return expired;
}

export async function buildAnswersTextForResponse(sessionId: string) {
  const response = await prisma.responseSession.findUnique({
    where: { id: sessionId },
    include: {
      surveyVersion: true,
    survey: {
      include: {
        publishedVersion: true,
        aiAnalysisRule: true,
      },
    },
      answers: {
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  if (!response) {
    throw new Error("Результат не найден.");
  }

  const answers = mapAnswersToRows(response.answers).map((answer) => `${answer.prompt}: ${answer.value || "—"}`);
  const attachmentTexts = await buildExtractedAttachmentTexts(response.answers);
  const schema = normalizeSurveySchema(
    response.surveyVersion?.schema ?? response.survey.publishedVersion?.schema ?? createDefaultSurveySchema(response.survey.title),
    response.surveyVersion?.title ?? response.survey.title,
  );
  const analysisMaxScore = extractSurveyAnalysisMaxScore(response.survey.aiAnalysisRule?.prompt);
  const configuredMaxScore = schema.settings.scoringEnabled ? calculateSurveyMaxScore(schema) : 0;
  const questionMaxScore = calculateSurveyQuestionMaxScore(schema);
  const maxScore = analysisMaxScore ?? (configuredMaxScore > 0 ? configuredMaxScore : questionMaxScore);
  const scorePercent = configuredMaxScore > 0 ? calculateScorePercent(response.totalScore, maxScore) : null;
  const scoreSummary = [
    maxScore > 0 ? `Максимум за весь опрос: ${maxScore} баллов` : null,
    maxScore > 0
      ? `Важно: считай итоговый процент именно от ${maxScore} баллов максимум, даже если часть вопросов пропущена или время вышло.`
      : null,
    scorePercent == null
      ? null
      : [`Итоговая сумма баллов: ${response.totalScore} баллов из ${maxScore}`, `Итоговый результат: ${scorePercent}% из 100%`].join("\n"),
  ]
    .filter(Boolean)
    .join("\n");
  const aiScoreSummary = inferAiScoreSummary(response.aiNote, maxScore);
  const copyTotalScore = configuredMaxScore > 0 ? response.totalScore : (aiScoreSummary?.totalScore ?? response.totalScore);
  const hasScoreSummary = configuredMaxScore > 0;
  const answerPromptOverrides = buildResultPromptOverrides(schema);

  return {
    response,
    maxScore,
    configuredMaxScore,
    displayTotalScore: copyTotalScore,
    answerPromptOverrides,
    includeScore: hasScoreSummary,
    includeAnswerScores: configuredMaxScore > 0,
    answersText: [scoreSummary, answers.join("\n"), attachmentTexts].filter(Boolean).join("\n\n"),
    copyText: buildResultCopyText({
      surveyTitle: response.survey.title,
      status: response.status,
      totalScore: copyTotalScore,
      maxScore,
      startedAt: response.startedAt,
      completedAt: response.completedAt,
      answers: response.answers,
      aiNote: response.aiNote,
      answerPromptOverrides,
      includeScore: hasScoreSummary,
      includeAnswerScores: configuredMaxScore > 0,
    }),
  };
}

export async function getSurveySelectOptions(actorId: string) {
  const actor = await prisma.user.findUniqueOrThrow({ where: { id: actorId } });

  const surveys = await prisma.survey.findMany({
    where: actor.role === UserRole.ADMIN ? {} : buildSurveyListWhere(actorId),
    orderBy: [{ updatedAt: "desc" }],
    select: {
      id: true,
      title: true,
      publicSlug: true,
      ownerId: true,
      lifecycleStatus: true,
      folderKey: true,
      folderId: true,
      updatedAt: true,
      permissions: {
        where: { userId: actorId },
        select: {
          userId: true,
          canView: true,
          canCreate: true,
          canEdit: true,
          canDelete: true,
          canResults: true,
        },
      },
    },
  });

  return surveys.map((survey) => ({
    ...survey,
    abilities: getSurveyAbilities(actor, survey.permissions[0] ?? null, survey.ownerId),
  }));
}

export async function getSurveyPublicMeta(surveyId: string) {
  const survey = await prisma.survey.findUnique({
    where: { id: surveyId },
    include: {
      publishedVersion: true,
    },
  });

  if (!survey?.publishedVersion) {
    throw new Error("Опрос не опубликован.");
  }

  const schema = normalizeSurveySchema(survey.publishedVersion.schema, survey.title);

  return {
    survey,
    schema: {
      ...schema,
      settings: {
        ...schema.settings,
        autoScrollEnabled: survey.autoScrollEnabled,
        timerEnabled: survey.timerEnabled,
        timerSeconds: survey.timerEnabled ? survey.timerSeconds : null,
        completionMessage: survey.completionMessage,
      },
    },
  };
}

export function formatPublicAnswerValue(value: unknown) {
  return stringifyAnswerValue(value);
}
