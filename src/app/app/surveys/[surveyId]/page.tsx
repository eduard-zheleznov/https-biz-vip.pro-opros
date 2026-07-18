import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ChevronDown, ChevronUp } from "lucide-react";

import { AiProvider, JobStatus, ResponseStatus } from "@/generated/prisma/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DeleteResultButton } from "@/components/admin/delete-result-button";
import { GuardedSurveySettingsForm } from "@/components/admin/guarded-survey-settings-form";
import { SurveyAdditionalInfoSettings } from "@/components/admin/survey-additional-info-settings";
import { SurveyBuilder } from "@/components/admin/survey-builder";
import { SURVEY_ABILITY_LABELS, listDisplayableSurveyAbilities } from "@/lib/permissions";
import {
  BLOCK_LABELS,
  DEFAULT_SURVEY_MOBILE_TYPOGRAPHY,
  DEFAULT_SURVEY_TYPOGRAPHY,
  calculateSurveyMaxScore,
  calculateSurveyQuestionMaxScore,
  isBlockScoringConfigured,
  normalizeTextAnswerValue,
} from "@/lib/survey-schema";
import {
  getSurveyEditorData,
  listSurveyResults,
  moveSurveyToFolder,
  requireCurrentUser,
  rollbackSurveyToVersion,
  recalculateTimedOutResponseResult,
  createResponseRetakeLink,
  deleteSurveyResult,
  retryResponseTelegramNotification,
  updateSurveySettings,
} from "@/lib/data";
import { AI_MODEL_OPTIONS } from "@/lib/ai-models";
import { env } from "@/lib/env";
import { withBasePath } from "@/lib/base-path";
import { stripRichTextTokens } from "@/lib/rich-text";
import {
  buildAnswerRows,
  buildResultCopyText,
  buildResultPromptOverrides,
  calculateScorePercent,
  DEFAULT_AI_COMPLETION_COPY,
  extractAiResultColor,
  extractSurveyAnalysisMaxScore,
  inferAiScoreSummary,
} from "@/lib/results";
import { formatDateTime, formatDateTimeInTimeZone, formatResponseStatus, formatSurveyLifecycleStatus } from "@/lib/utils";
import { prisma } from "@/lib/prisma";
import type { AdditionalInfoItem, SurveyBlock, SurveySchema, TextAnswerAttachment } from "@/types/surveys";

const tabs = [
  { id: "builder", label: "Конструктор" },
  { id: "settings", label: "Настройки" },
  { id: "results", label: "Результаты" },
] as const;

function readTypographySize(formData: FormData, name: string, fallback: number) {
  const value = Number(formData.get(name));

  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.min(48, Math.max(10, Math.round(value)));
}

function parseAdditionalInfoItems(value: FormDataEntryValue | null): AdditionalInfoItem[] | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }

  if (!Array.isArray(parsed)) {
    return undefined;
  }

  const usedIds = new Set<string>();
  return parsed
    .slice(0, 100)
    .map((item, index) => {
      const source = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const rawId = typeof source.id === "string" ? source.id.trim() : "";
      let id = rawId && !usedIds.has(rawId) ? rawId : "";
      let fallbackIndex = index + 1;
      while (!id || usedIds.has(id)) {
        id = `info-${fallbackIndex}`;
        fallbackIndex += 1;
      }
      usedIds.add(id);

      return {
        id,
        label:
          typeof source.label === "string" && source.label.trim()
            ? source.label.trim().slice(0, 160)
            : `Пункт ${index + 1}`,
        description: typeof source.description === "string" ? source.description.slice(0, 6000) : "",
      };
    });
}

function parseTelegramChatIdOverrides(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return [];
  }

  return Array.from(
    new Set(
      value
        .split(/[\n,;]+/)
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ).slice(0, 25);
}

type SurveyTabId = (typeof tabs)[number]["id"];

type AiNoteTone = "green" | "yellow" | "red" | "neutral";
type ResultsQueryState = {
  status: ResponseStatus | "ALL";
  dateFrom: string;
  dateTo: string;
  sort: "newest" | "oldest" | "score_desc" | "score_asc";
  search: string;
};
type AiNoteSection =
  | {
      kind: "metric";
      label: string;
      value: string;
      comment?: string;
    }
  | {
      kind: "summary";
      label: string;
      value: string;
    }
  | {
      kind: "text";
      value: string;
    };

type ResultDisplayAnswer = {
  blockType: string;
  prompt: string;
  value: unknown;
};
type ResultDisplayTitleOptions = {
  nameOrCompanyOnly?: boolean;
};

function asResultText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }

  if (Array.isArray(value)) {
    return value.map(asResultText).filter(Boolean).join(", ");
  }

  if (value && typeof value === "object") {
    const textAnswer = normalizeTextAnswerValue(value);
    if (textAnswer.text.trim()) {
      return textAnswer.text.trim();
    }
  }

  return "";
}

function normalizeResultSearchText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ru-RU").replaceAll("ё", "е");
}

function compactResultTitleCandidate(value: string) {
  const firstLine = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine) {
    return "";
  }

  const compact = firstLine.replace(/\s+/g, " ").trim();
  const firstSegment = compact.split(/[;,]/)[0]?.trim() ?? compact;
  const candidate = firstSegment.length >= 2 ? firstSegment : compact;

  return candidate.length > 80 ? `${candidate.slice(0, 77).trim()}...` : candidate;
}

function contactValue(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }

  const source = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = asResultText(source[key]);
    if (candidate) {
      return candidate;
    }
  }

  return "";
}

function contactPhoneValue(value: unknown) {
  const phone = contactValue(value, ["phone", "phoneNumber", "tel"]);
  if (!phone) {
    return "";
  }

  if (phone.startsWith("+")) {
    return phone;
  }

  const phoneCountry = contactValue(value, ["phoneCountry", "country"]);
  const dialCode = phoneCountry.match(/\+\d+/)?.[0] ?? "";

  return dialCode ? `${dialCode} ${phone}` : phone;
}

function textAnswerByPrompt(
  answers: ResultDisplayAnswer[],
  promptTokens: string[],
  options: { skipBlockTypes?: string[] } = {},
) {
  const skippedBlockTypes = new Set(options.skipBlockTypes ?? []);

  for (const answer of answers) {
    if (skippedBlockTypes.has(answer.blockType)) {
      continue;
    }

    const prompt = normalizeResultSearchText(stripRichTextTokens(answer.prompt));
    if (!promptTokens.some((token) => prompt.includes(token))) {
      continue;
    }

    const value = compactResultTitleCandidate(asResultText(answer.value));
    if (value) {
      return value;
    }
  }

  return "";
}

function buildResultDisplayTitle(
  answers: ResultDisplayAnswer[],
  fallbackNumber: number,
  options: ResultDisplayTitleOptions = {},
) {
  const nameOrCompanyOnly = Boolean(options.nameOrCompanyOnly);

  for (const answer of answers) {
    if (answer.blockType !== "CONTACT") {
      continue;
    }

    const name = compactResultTitleCandidate(contactValue(answer.value, ["fullName", "name", "firstName"]));
    if (name) {
      return name;
    }

    const company = compactResultTitleCandidate(contactValue(answer.value, ["company", "companyName", "organization"]));
    if (company) {
      return company;
    }

    if (!nameOrCompanyOnly) {
      const phone = compactResultTitleCandidate(contactPhoneValue(answer.value));
      if (phone) {
        return phone;
      }
    }
  }

  const textTitleOptions = { skipBlockTypes: ["WELCOME"] };
  const name = textAnswerByPrompt(
    answers,
    ["подскажите ваше имя", "ваше имя", "имя и", "как вас зовут", "фамили"],
    textTitleOptions,
  );
  if (name) {
    return name;
  }

  const company = textAnswerByPrompt(
    answers,
    ["название компании", "какой компании", "из какой компании", "компан", "организац"],
    textTitleOptions,
  );
  if (company) {
    return company;
  }

  if (!nameOrCompanyOnly) {
    const phone = textAnswerByPrompt(answers, ["телефон", "номер"], textTitleOptions);
    if (phone) {
      return phone;
    }
  }

  return `Ответ ${fallbackNumber}`;
}

function buildResultFallbackNumbers<T extends { id: string; startedAt: Date | string }>(results: T[]) {
  return new Map(
    [...results]
      .sort((left, right) => {
        const leftTime = new Date(left.startedAt).getTime();
        const rightTime = new Date(right.startedAt).getTime();

        if (leftTime !== rightTime) {
          return leftTime - rightTime;
        }

        return left.id.localeCompare(right.id);
      })
      .map((result, index) => [result.id, index + 1] as const),
  );
}

function buildScoredBlockIds(schema: SurveySchema) {
  if (!schema.settings.scoringEnabled) {
    return new Set<string>();
  }

  return new Set(schema.blocks.filter((block) => isBlockScoringConfigured(block)).map((block) => block.id));
}

function getAiNoteTone(aiNote: string | null | undefined): {
  tone: AiNoteTone;
  label: string | null;
  marker: string | null;
  panelClassName: string;
  badgeClassName: string;
} {
  const token = extractAiResultColor(aiNote);

  switch (token) {
    case "GREEN":
      return {
        tone: "green",
        label: "Зелёный",
        marker: "🟢",
        panelClassName: "border-emerald-100 bg-emerald-50 text-emerald-800",
        badgeClassName: "bg-emerald-100 text-emerald-800",
      };
    case "YELLOW":
      return {
        tone: "yellow",
        label: "Жёлтый",
        marker: "🟡",
        panelClassName: "border-amber-100 bg-amber-50 text-amber-800",
        badgeClassName: "bg-amber-100 text-amber-800",
      };
    case "RED":
      return {
        tone: "red",
        label: "Красный",
        marker: "🔴",
        panelClassName: "border-rose-100 bg-rose-50 text-rose-800",
        badgeClassName: "bg-rose-100 text-rose-800",
      };
    default:
      return {
        tone: "neutral",
        label: null,
        marker: null,
        panelClassName: "border-slate-200 bg-slate-50 text-slate-700",
        badgeClassName: "bg-slate-200 text-slate-700",
      };
  }
}

function getTelegramStatusBadge(status: JobStatus) {
  switch (status) {
    case JobStatus.SUCCESS:
      return { tone: "success" as const, label: "Telegram: отправлено" };
    case JobStatus.FAILED:
      return { tone: "danger" as const, label: "Telegram: ошибка" };
    case JobStatus.PENDING:
      return { tone: "warning" as const, label: "Telegram: в очереди" };
    case JobStatus.SKIPPED:
      return { tone: "neutral" as const, label: "Telegram: не отправлялось" };
  }
}

function getTelegramStatusMessage(status: JobStatus) {
  switch (status) {
    case JobStatus.FAILED:
      return "Telegram-уведомление не отправилось. Проверьте TELEGRAM_BOT_TOKEN, подключение пользователя к Telegram и Chat ID в настройках уведомлений.";
    case JobStatus.PENDING:
      return "Telegram-уведомление ещё ожидает обработки фоновым worker-процессом.";
    case JobStatus.SKIPPED:
      return "Telegram-уведомление не отправлялось: уведомления выключены, не найден получатель или результат не попал в выбранные AI-зоны.";
    case JobStatus.SUCCESS:
      return null;
  }
}

function buildAiNoteSections(aiNote: string): AiNoteSection[] {
  const normalizedNote = aiNote
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\s+(Краткий комментарий:)/gu, "\n$1")
    .replace(/\s+(СУММАРНЫЙ БАЛЛ:)/gu, "\n$1")
    .replace(/\s+(ИТОГОВЫЙ РЕЗУЛЬТАТ:)/gu, "\n$1")
    .replace(/\s+(ЦВЕТ:)/gu, "\n$1")
    .trim();

  const sections: AiNoteSection[] = [];
  let lastMetricIndex = -1;

  for (const rawLine of normalizedNote.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^ЦВЕТ\s*:/iu.test(line)) {
      continue;
    }

    const commentMatch = line.match(/^Краткий комментарий\s*:\s*(.+)$/iu);
    if (commentMatch) {
      const comment = commentMatch[1].trim();
      const lastMetric = lastMetricIndex >= 0 ? sections[lastMetricIndex] : null;

      if (lastMetric?.kind === "metric") {
        lastMetric.comment = comment;
      } else {
        sections.push({ kind: "text", value: comment });
      }
      continue;
    }

    const entryMatch = line.match(/^([^:]+):\s*(.+)$/u);
    if (!entryMatch) {
      sections.push({ kind: "text", value: line });
      lastMetricIndex = -1;
      continue;
    }

    const label = entryMatch[1].trim();
    const rawValue = entryMatch[2].trim();
    const normalizedLabel = label.toUpperCase().replaceAll("Ё", "Е");
    const inlineCommentMatch = rawValue.match(/^(.*?)\s*Краткий комментарий\s*:\s*(.+)$/iu);
    const value = (inlineCommentMatch?.[1] ?? rawValue).trim();
    const inlineComment = inlineCommentMatch?.[2]?.trim();

    if (normalizedLabel === "СУММАРНЫЙ БАЛЛ" || normalizedLabel === "ИТОГОВЫЙ РЕЗУЛЬТАТ") {
      sections.push({
        kind: "summary",
        label,
        value,
      });
      lastMetricIndex = -1;
      continue;
    }

    sections.push({
      kind: "metric",
      label,
      value,
      comment: inlineComment,
    });
    lastMetricIndex = sections.length - 1;
  }

  return sections;
}

function StructuredAiNote({
  aiNote,
  scoreSummary,
  tone,
}: {
  aiNote: string;
  scoreSummary?: { totalScore: number; maxScore: number; percent: number } | null;
  tone: ReturnType<typeof getAiNoteTone>;
}) {
  const sections = buildAiNoteSections(aiNote);

  if (!sections.length) {
    return <p className="mt-3 whitespace-pre-line text-sm leading-7">{aiNote}</p>;
  }

  return (
    <div className="mt-3 space-y-3">
      {sections.map((section, index) => {
        if (section.kind === "summary") {
          const normalizedLabel = section.label.toUpperCase().replaceAll("Ё", "Е");
          const value =
            scoreSummary && normalizedLabel === "СУММАРНЫЙ БАЛЛ"
              ? `${scoreSummary.totalScore} баллов из ${scoreSummary.maxScore}`
              : scoreSummary && normalizedLabel === "ИТОГОВЫЙ РЕЗУЛЬТАТ"
                ? `${scoreSummary.percent}% из 100%`
                : section.value;

          return (
            <div
              key={`${section.kind}-${index}`}
              className="rounded-[20px] border border-white/70 bg-white/80 px-4 py-3 shadow-[0_14px_30px_-24px_rgba(15,23,42,0.45)]"
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{section.label}</p>
              <p className="mt-1 text-sm font-semibold leading-6 text-slate-900">{value}</p>
            </div>
          );
        }

        if (section.kind === "metric") {
          const normalizedMetricLabel = section.label.toUpperCase().replaceAll("Ё", "Е");
          const value =
            scoreSummary && (normalizedMetricLabel === "ПРОЦЕНТ" || normalizedMetricLabel === "ИТОГОВЫЙ РЕЗУЛЬТАТ")
              ? `${scoreSummary.percent}%`
              : scoreSummary &&
                  (normalizedMetricLabel === "ОЦЕНКА" || normalizedMetricLabel === "ОЦЕНКА ИИ" || normalizedMetricLabel === "БАЛЛ")
                ? `${scoreSummary.totalScore} / ${scoreSummary.maxScore}`
                : section.value;

          return (
            <div
              key={`${section.kind}-${index}`}
              className="rounded-[20px] border border-white/70 bg-white/60 px-4 py-3 shadow-[0_14px_30px_-24px_rgba(15,23,42,0.45)]"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{section.label}</p>
                <p className="text-sm font-semibold text-slate-900">{value}</p>
              </div>
              {section.comment ? (
                <p className="mt-2 text-sm leading-7 text-slate-700">
                  <span className="font-semibold text-slate-900">Краткий комментарий:</span> {section.comment}
                </p>
              ) : null}
            </div>
          );
        }

        return (
          <p
            key={`${section.kind}-${index}`}
            className="rounded-[20px] border border-white/70 bg-white/55 px-4 py-3 text-sm leading-7 text-slate-700 shadow-[0_14px_30px_-24px_rgba(15,23,42,0.45)]"
          >
            {section.value}
          </p>
        );
      })}

      {tone.label ? (
        <div className="flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">
          <span aria-hidden="true">{tone.marker}</span>
          <span>Итоговая метка: {tone.label}</span>
        </div>
      ) : null}
    </div>
  );
}

function ReadonlyBlockDetails({ block }: { block: SurveyBlock }) {
  switch (block.type) {
    case "WELCOME":
      return <p className="text-sm leading-7 text-slate-600">Кнопка запуска: {block.ctaLabel}</p>;
    case "CONTACT":
      return (
        <div className="flex flex-wrap gap-2">
          {block.fields.filter((field) => field.enabled ?? true).map((field) => (
            <Badge key={field.id} tone="neutral">
              {field.label}
              {field.required ? " *" : ""}
            </Badge>
          ))}
        </div>
      );
    case "SINGLE_CHOICE":
    case "MULTI_CHOICE":
    case "MEDIA_CHOICE":
    case "DROPDOWN":
      return (
        <div className="flex flex-wrap gap-2">
          {block.options.map((option) => (
            <Badge key={option.id} tone="neutral">
              {option.label}
            </Badge>
          ))}
        </div>
      );
    case "YES_NO":
      return (
        <div className="flex flex-wrap gap-2">
          <Badge tone="neutral">{block.yesLabel}</Badge>
          <Badge tone="neutral">{block.noLabel}</Badge>
        </div>
      );
    case "RANKING":
      return (
        <div className="flex flex-wrap gap-2">
          {block.items.map((item) => (
            <Badge key={item.id} tone="neutral">
              {item.label}
            </Badge>
          ))}
        </div>
      );
    case "RATING":
      return <p className="text-sm leading-7 text-slate-600">Шкала: 1-{block.scale}</p>;
    case "SCALE":
      return <p className="text-sm leading-7 text-slate-600">Диапазон: {block.min}-{block.max}</p>;
    case "SLIDER":
      return <p className="text-sm leading-7 text-slate-600">Ползунок: {block.min}-{block.max}, шаг {block.step}</p>;
    case "TEXT":
      return <p className="text-sm leading-7 text-slate-600">Свободный текстовый ответ</p>;
    case "COMBINED":
      return (
        <div className="flex flex-wrap gap-2">
          <Badge tone="neutral">Формат: {BLOCK_LABELS[block.inputBlock.type]}</Badge>
          <Badge tone="neutral">Плюс свободный ответ</Badge>
        </div>
      );
  }
}

function ReadonlySurveyOutline({ schema }: { schema: SurveySchema }) {
  return (
    <div className="space-y-6">
      <Card className="border-slate-200 p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Просмотр</p>
        <h2 className="mt-2 text-2xl font-semibold text-slate-950">Режим только для чтения</h2>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
          У этого аккаунта есть право просмотра опроса, но нет права редактирования. Структура и порядок блоков ниже доступны без возможности изменения.
        </p>
      </Card>

      <div className="space-y-4">
        {schema.blocks.map((block, index) => (
          <Card key={block.id} className="border-slate-200 p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Экран {index + 1} • {BLOCK_LABELS[block.type]}
                </p>
                <h3 className="mt-2 text-xl font-semibold text-slate-950">{block.title}</h3>
                {block.description ? <p className="mt-2 text-sm leading-7 text-slate-600">{block.description}</p> : null}
                {block.questionHint ? <p className="mt-2 text-xs leading-6 text-sky-700">Пояснение: {stripRichTextTokens(block.questionHint)}</p> : null}
              </div>
              <Badge tone={block.required ? "warning" : "neutral"}>
                {block.required ? "Обязательный" : "Необязательный"}
              </Badge>
            </div>
            <div className="mt-4">
              <ReadonlyBlockDetails block={block} />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default async function SurveyPage({
  params,
  searchParams,
}: {
  params: Promise<{ surveyId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { surveyId } = await params;
  const query = await searchParams;
  const user = await requireCurrentUser();
  const editorData = await getSurveyEditorData(surveyId, user.id);
  const requestedTab = typeof query.tab === "string" ? (query.tab as SurveyTabId) : "builder";
  const availableTabs = tabs.filter((item) => {
    if (item.id === "builder") {
      return editorData.abilities.view || editorData.abilities.edit;
    }

    if (item.id === "settings") {
      return editorData.abilities.edit;
    }

    return editorData.abilities.results;
  });

  if (!availableTabs.length) {
    redirect("/app");
  }

  const tab = availableTabs.some((item) => item.id === requestedTab) ? requestedTab : availableTabs[0]!.id;
  const availableFolders = await prisma.folder.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  async function settingsAction(formData: FormData) {
    "use server";

    const currentUser = await requireCurrentUser();
    const aiProviderValue = String(formData.get("aiProvider") ?? "");
    const redirectTo = String(formData.get("redirectTo") ?? "");

    await updateSurveySettings(surveyId, currentUser.id, {
      autoScrollEnabled: formData.get("autoScrollEnabled") === "on",
      showProgressBar: formData.get("showProgressBar") === "on",
      timerEnabled: formData.get("timerEnabled") === "on",
      timerSeconds: Number(formData.get("timerSeconds") ?? 0) || null,
      completionMessage: String(formData.get("completionMessage") ?? ""),
      showRestartButton: formData.get("showRestartButton") === "on",
      additionalInfoItems: parseAdditionalInfoItems(formData.get("additionalInfoItemsJson")),
      typography: {
        eyebrowFontSize: readTypographySize(formData, "typographyEyebrowFontSize", DEFAULT_SURVEY_TYPOGRAPHY.eyebrowFontSize),
        titleFontSize: readTypographySize(formData, "typographyTitleFontSize", DEFAULT_SURVEY_TYPOGRAPHY.titleFontSize),
        descriptionFontSize: readTypographySize(
          formData,
          "typographyDescriptionFontSize",
          DEFAULT_SURVEY_TYPOGRAPHY.descriptionFontSize,
        ),
        answerFontSize: readTypographySize(formData, "typographyAnswerFontSize", DEFAULT_SURVEY_TYPOGRAPHY.answerFontSize),
        additionalInfoDescriptionFontSize: readTypographySize(
          formData,
          "typographyAdditionalInfoDescriptionFontSize",
          DEFAULT_SURVEY_TYPOGRAPHY.additionalInfoDescriptionFontSize,
        ),
      },
      mobileTypography: {
        eyebrowFontSize: readTypographySize(
          formData,
          "mobileTypographyEyebrowFontSize",
          DEFAULT_SURVEY_MOBILE_TYPOGRAPHY.eyebrowFontSize,
        ),
        titleFontSize: readTypographySize(formData, "mobileTypographyTitleFontSize", DEFAULT_SURVEY_MOBILE_TYPOGRAPHY.titleFontSize),
        descriptionFontSize: readTypographySize(
          formData,
          "mobileTypographyDescriptionFontSize",
          DEFAULT_SURVEY_MOBILE_TYPOGRAPHY.descriptionFontSize,
        ),
        answerFontSize: readTypographySize(formData, "mobileTypographyAnswerFontSize", DEFAULT_SURVEY_MOBILE_TYPOGRAPHY.answerFontSize),
        additionalInfoDescriptionFontSize: readTypographySize(
          formData,
          "mobileTypographyAdditionalInfoDescriptionFontSize",
          DEFAULT_SURVEY_MOBILE_TYPOGRAPHY.additionalInfoDescriptionFontSize,
        ),
      },
      telegramEnabled: formData.get("telegramEnabled") === "on",
      telegramChatIdOverride: String(formData.get("telegramChatIdOverride") ?? "") || null,
      telegramChatIdOverrides: parseTelegramChatIdOverrides(formData.get("telegramChatIdOverrides")),
      telegramAiFilterEnabled: formData.get("telegramAiFilterEnabled") === "on",
      telegramAiAllowedColors: formData.getAll("telegramAiAllowedColors").map((value) => String(value)),
      aiEnabled: formData.get("aiEnabled") === "on",
      aiProvider: aiProviderValue === AiProvider.OPENAI ? AiProvider.OPENAI : AiProvider.OPENROUTER,
      aiPrompt: String(formData.get("aiPrompt") ?? ""),
      aiModel: String(formData.get("aiModel") ?? "") || null,
      aiApiKey: String(formData.get("aiApiKey") ?? "") || null,
      aiClearApiKey: formData.get("aiClearApiKey") === "on",
      completionRoutingEnabled: formData.get("completionRoutingEnabled") === "on",
      completionProcessingTitle: String(formData.get("completionProcessingTitle") ?? ""),
      completionProcessingMessage: String(formData.get("completionProcessingMessage") ?? ""),
      completionGreenTitle: String(formData.get("completionGreenTitle") ?? ""),
      completionGreenMessage: String(formData.get("completionGreenMessage") ?? ""),
      completionGreenMaxUrl: String(formData.get("completionGreenMaxUrl") ?? ""),
      completionGreenTelegramUrl: String(formData.get("completionGreenTelegramUrl") ?? ""),
      completionGreenWhatsappUrl: String(formData.get("completionGreenWhatsappUrl") ?? ""),
      completionYellowTitle: String(formData.get("completionYellowTitle") ?? ""),
      completionYellowMessage: String(formData.get("completionYellowMessage") ?? ""),
      completionRedTitle: String(formData.get("completionRedTitle") ?? ""),
      completionRedMessage: String(formData.get("completionRedMessage") ?? ""),
      completionFallbackTitle: String(formData.get("completionFallbackTitle") ?? ""),
      completionFallbackMessage: String(formData.get("completionFallbackMessage") ?? ""),
    });

    await moveSurveyToFolder(surveyId, currentUser.id, String(formData.get("folderId") ?? "") || null);
    revalidatePath(`/app/surveys/${surveyId}`);

    if (redirectTo.startsWith(`/app/surveys/${surveyId}`)) {
      redirect(redirectTo);
    }

    redirect(`/app/surveys/${surveyId}?tab=settings&saved=1`);
  }

  async function rollbackAction(formData: FormData) {
    "use server";

    const currentUser = await requireCurrentUser();
    await rollbackSurveyToVersion(surveyId, String(formData.get("versionId") ?? ""), currentUser.id);
    revalidatePath(`/app/surveys/${surveyId}`);
    redirect(`/app/surveys/${surveyId}?tab=builder&rolledBack=1`);
  }

  async function deleteResultAction(formData: FormData) {
    "use server";

    const currentUser = await requireCurrentUser();
    await deleteSurveyResult(surveyId, String(formData.get("responseId") ?? ""), currentUser.id);
    revalidatePath(`/app/surveys/${surveyId}`);

    const redirectTo = String(formData.get("redirectTo") ?? "");
    if (redirectTo.startsWith(`/app/surveys/${surveyId}`)) {
      redirect(redirectTo);
    }

    redirect(`/app/surveys/${surveyId}?tab=results&deleted=1`);
  }

  async function createRetakeLinkAction(formData: FormData) {
    "use server";

    const currentUser = await requireCurrentUser();
    const retakeLink = await createResponseRetakeLink(surveyId, String(formData.get("responseId") ?? ""), currentUser.id);
    revalidatePath(`/app/surveys/${surveyId}`);

    const redirectTo = String(formData.get("redirectTo") ?? "");
    const safeRedirectTo = redirectTo.startsWith(`/app/surveys/${surveyId}`)
      ? redirectTo
      : `/app/surveys/${surveyId}?tab=results`;
    const separator = safeRedirectTo.includes("?") ? "&" : "?";
    redirect(
      `${safeRedirectTo}${separator}retakeUrl=${encodeURIComponent(retakeLink.retakeUrl)}&retakeExpiresAt=${encodeURIComponent(retakeLink.expiresAt.toISOString())}`,
    );
  }

  async function retryTelegramNotificationAction(formData: FormData) {
    "use server";

    const currentUser = await requireCurrentUser();
    await retryResponseTelegramNotification(surveyId, String(formData.get("responseId") ?? ""), currentUser.id);
    revalidatePath(`/app/surveys/${surveyId}`);

    const redirectTo = String(formData.get("redirectTo") ?? "");
    if (redirectTo.startsWith(`/app/surveys/${surveyId}`)) {
      redirect(redirectTo);
    }

    redirect(`/app/surveys/${surveyId}?tab=results&telegramQueued=1`);
  }

  async function recalculateTimedOutResultAction(formData: FormData) {
    "use server";

    const currentUser = await requireCurrentUser();
    await recalculateTimedOutResponseResult(surveyId, String(formData.get("responseId") ?? ""), currentUser.id);
    revalidatePath(`/app/surveys/${surveyId}`);

    const redirectTo = String(formData.get("redirectTo") ?? "");
    if (redirectTo.startsWith(`/app/surveys/${surveyId}`)) {
      redirect(redirectTo);
    }

    redirect(`/app/surveys/${surveyId}?tab=results&recalculated=1`);
  }

  const resultsQuery: ResultsQueryState | null =
    tab === "results"
      ? {
          status:
            typeof query.status === "string" && ["COMPLETED", "PARTIAL", "TIMED_OUT", "ALL"].includes(query.status)
              ? (query.status as ResultsQueryState["status"])
              : "ALL",
          dateFrom: typeof query.dateFrom === "string" ? query.dateFrom : "",
          dateTo: typeof query.dateTo === "string" ? query.dateTo : "",
          sort:
            typeof query.sort === "string" && ["newest", "oldest", "score_desc", "score_asc"].includes(query.sort)
              ? (query.sort as ResultsQueryState["sort"])
              : "newest",
          search: typeof query.search === "string" ? query.search : "",
        }
      : null;
  const results =
    tab === "results"
      ? await listSurveyResults(surveyId, user.id, {
          status: resultsQuery?.status ?? "ALL",
          dateFrom: resultsQuery?.dateFrom ?? null,
          dateTo: resultsQuery?.dateTo ?? null,
          sort: resultsQuery?.sort ?? "newest",
          search: resultsQuery?.search ?? null,
        })
      : [];

  const currentVersionNumber = editorData.survey.currentVersion?.versionNumber ?? editorData.survey.lastVersionNumber;
  const modelOptions = Array.from(new Set([...AI_MODEL_OPTIONS, editorData.survey.aiAnalysisRule?.model].filter(Boolean) as string[]));
  const publicUrl = `${env.APP_URL}/s/${editorData.survey.publicSlug}`;
  const telegramChatIdOverridesDefault = (
    editorData.survey.notificationConfig?.telegramChatIdOverrides?.length
      ? editorData.survey.notificationConfig.telegramChatIdOverrides
      : editorData.survey.notificationConfig?.telegramChatIdOverride
        ? [editorData.survey.notificationConfig.telegramChatIdOverride]
        : []
  ).join("\n");
  const telegramAiAllowedColors = new Set(
    editorData.survey.notificationConfig?.telegramAiAllowedColors?.length
      ? editorData.survey.notificationConfig.telegramAiAllowedColors
      : ["GREEN"],
  );
  const aiCompletionCopy = {
    processingTitle: editorData.survey.aiAnalysisRule?.completionProcessingTitle ?? DEFAULT_AI_COMPLETION_COPY.processingTitle,
    processingMessage: editorData.survey.aiAnalysisRule?.completionProcessingMessage ?? DEFAULT_AI_COMPLETION_COPY.processingMessage,
    greenTitle: editorData.survey.aiAnalysisRule?.completionGreenTitle ?? DEFAULT_AI_COMPLETION_COPY.greenTitle,
    greenMessage: editorData.survey.aiAnalysisRule?.completionGreenMessage ?? DEFAULT_AI_COMPLETION_COPY.greenMessage,
    greenMaxUrl: editorData.survey.aiAnalysisRule?.completionGreenMaxUrl ?? "",
    greenTelegramUrl: editorData.survey.aiAnalysisRule?.completionGreenTelegramUrl ?? "",
    greenWhatsappUrl: editorData.survey.aiAnalysisRule?.completionGreenWhatsappUrl ?? "",
    yellowTitle: editorData.survey.aiAnalysisRule?.completionYellowTitle ?? DEFAULT_AI_COMPLETION_COPY.yellowTitle,
    yellowMessage: editorData.survey.aiAnalysisRule?.completionYellowMessage ?? DEFAULT_AI_COMPLETION_COPY.yellowMessage,
    redTitle: editorData.survey.aiAnalysisRule?.completionRedTitle ?? DEFAULT_AI_COMPLETION_COPY.redTitle,
    redMessage: editorData.survey.aiAnalysisRule?.completionRedMessage ?? DEFAULT_AI_COMPLETION_COPY.redMessage,
    fallbackTitle: editorData.survey.aiAnalysisRule?.completionFallbackTitle ?? DEFAULT_AI_COMPLETION_COPY.fallbackTitle,
    fallbackMessage: editorData.survey.aiAnalysisRule?.completionFallbackMessage ?? DEFAULT_AI_COMPLETION_COPY.fallbackMessage,
  };
  const resultsRedirectParams = new URLSearchParams();
  resultsRedirectParams.set("tab", "results");
  if (typeof query.status === "string" && query.status) {
    resultsRedirectParams.set("status", query.status);
  }
  if (typeof query.dateFrom === "string" && query.dateFrom) {
    resultsRedirectParams.set("dateFrom", query.dateFrom);
  }
  if (typeof query.dateTo === "string" && query.dateTo) {
    resultsRedirectParams.set("dateTo", query.dateTo);
  }
  if (typeof query.sort === "string" && query.sort) {
    resultsRedirectParams.set("sort", query.sort);
  }
  if (typeof query.search === "string" && query.search.trim()) {
    resultsRedirectParams.set("search", query.search);
  }
  const resultsRedirectTo = `/app/surveys/${surveyId}?${resultsRedirectParams.toString()}`;
  const generatedRetakeUrl = typeof query.retakeUrl === "string" ? query.retakeUrl : "";
  const generatedRetakeExpiresAt = typeof query.retakeExpiresAt === "string" ? query.retakeExpiresAt : "";
  const exportResultsParams = new URLSearchParams();
  exportResultsParams.set("status", resultsQuery?.status ?? "ALL");
  exportResultsParams.set("sort", resultsQuery?.sort ?? "newest");
  if (resultsQuery?.dateFrom) {
    exportResultsParams.set("dateFrom", resultsQuery.dateFrom);
  }
  if (resultsQuery?.dateTo) {
    exportResultsParams.set("dateTo", resultsQuery.dateTo);
  }
  if (resultsQuery?.search.trim()) {
    exportResultsParams.set("search", resultsQuery.search);
  }
  const analysisMaxScore = extractSurveyAnalysisMaxScore(editorData.survey.aiAnalysisRule?.prompt);
  const configuredSurveyMaxScore = editorData.schema.settings.scoringEnabled ? calculateSurveyMaxScore(editorData.schema) : 0;
  const questionSurveyMaxScore = calculateSurveyQuestionMaxScore(editorData.schema);
  const resultSurveyMaxScore = analysisMaxScore ?? (configuredSurveyMaxScore > 0 ? configuredSurveyMaxScore : questionSurveyMaxScore);
  const resultPromptOverrides = buildResultPromptOverrides(editorData.schema);
  const scoredBlockIds = buildScoredBlockIds(editorData.schema);
  const resultFallbackNumbers = buildResultFallbackNumbers(results);
  const useOperatorResultTitles = normalizeResultSearchText(editorData.survey.title).includes("для оператора");
  const hasActiveResultFilters = Boolean(
    (resultsQuery?.search ?? "").trim() ||
      resultsQuery?.dateFrom ||
      resultsQuery?.dateTo ||
      (resultsQuery?.status && resultsQuery.status !== "ALL") ||
      (resultsQuery?.sort && resultsQuery.sort !== "newest"),
  );

  function formatResultAnswerValue(
    answer: (typeof results)[number]["answers"][number],
    rowValue: string | undefined,
  ) {
    if ((answer.blockType === "SCALE" || answer.blockType === "SLIDER") && Number.isFinite(Number(answer.value))) {
      return String(Number(answer.value));
    }

    if (answer.blockType === "TEXT") {
      const textAnswer = normalizeTextAnswerValue(answer.rawValue);
      if (textAnswer.attachments.length) {
        const text = textAnswer.text.trim();
        const voiceTranscripts = textAnswer.attachments
          .filter((attachment) => {
            const transcript = attachment.transcript?.trim() ?? "";
            return attachment.kind === "voice" && transcript && !text.includes(transcript);
          })
          .map((attachment) => `Расшифровка голосового ответа:\n${attachment.transcript!.trim()}`);
        const lines = [text, ...voiceTranscripts].filter(Boolean);

        return lines.join("\n\n") || "Нет текстового ответа";
      }
    }

    return rowValue || "Нет ответа";
  }

  function getResultAnswerAttachments(answer: (typeof results)[number]["answers"][number]): TextAnswerAttachment[] {
    return answer.blockType === "TEXT" ? normalizeTextAnswerValue(answer.rawValue).attachments : [];
  }

  function formatAttachmentSize(byteSize: number) {
    if (byteSize >= 1024 * 1024) {
      return `${(byteSize / 1024 / 1024).toFixed(1)} МБ`;
    }

    return `${Math.max(1, Math.round(byteSize / 1024))} КБ`;
  }

  return (
    <div className="min-w-0 space-y-6">
      <Card className="border-slate-200 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Опрос</p>
            <h1 className="mt-2 text-4xl font-semibold tracking-tight text-slate-950">{editorData.survey.title}</h1>
            <p className="mt-3 max-w-3xl text-base leading-7 text-slate-600">
              {editorData.survey.description || "Настройте структуру опроса, публикацию, доступы и результаты."}
            </p>
            {user.role !== "ADMIN" ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Ваш доступ</span>
                {listDisplayableSurveyAbilities(editorData.abilities).map((ability) => (
                  <Badge key={ability} tone="neutral">
                    {SURVEY_ABILITY_LABELS[ability]}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>
          <div className="shrink-0 space-y-3">
            <Badge tone={editorData.survey.lifecycleStatus === "ARCHIVED" ? "warning" : editorData.survey.lifecycleStatus === "PUBLISHED" ? "success" : "neutral"}>
              {formatSurveyLifecycleStatus(editorData.survey.lifecycleStatus)}
            </Badge>
            <Button asChild variant="secondary">
              <Link href={publicUrl} target="_blank">
                Открыть публичную ссылку
              </Link>
            </Button>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          {availableTabs.map((item) => (
            <Button key={item.id} asChild variant={tab === item.id ? "primary" : "secondary"} size="sm">
              <Link href={`/app/surveys/${surveyId}?tab=${item.id}`}>{item.label}</Link>
            </Button>
          ))}
        </div>
      </Card>

      {tab === "builder" ? (
        editorData.abilities.edit ? (
          <SurveyBuilder
            surveyId={surveyId}
            initialSchema={editorData.schema}
            publicSlug={editorData.survey.publicSlug}
            lifecycleStatus={editorData.survey.lifecycleStatus}
            currentVersionNumber={currentVersionNumber}
          />
        ) : (
          <ReadonlySurveyOutline schema={editorData.schema} />
        )
      ) : null}

      {tab === "settings" ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr),420px]">
          <GuardedSurveySettingsForm action={settingsAction} defaultRedirectTo={`/app/surveys/${surveyId}?tab=settings&saved=1`}>
            <Card className="border-slate-200 p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Интерфейс</p>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-semibold text-slate-700">Язык опроса</span>
                  <Input name="language" defaultValue={editorData.survey.language} disabled />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-semibold text-slate-700">Папка</span>
                  <select
                    name="folderId"
                    defaultValue={editorData.survey.folderId ?? ""}
                    className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                  >
                    <option value="">Мои опросы</option>
                    {availableFolders.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.name}
                      </option>
                    ))}
                  </select>
                  <span className="block text-xs text-slate-500">
                    Можно выбрать несколько строк. Если список пуст и Chat ID ниже не указан, результат отправится владельцу опроса.
                  </span>
                </label>
              </div>
            </Card>

            <SurveyAdditionalInfoSettings initialItems={editorData.schema.settings.additionalInfoItems} />

            <Card className="border-slate-200 p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Типографика прохождения</p>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Размеры текста для публичной ссылки этого опроса. Значения задаются в пикселях: отдельно для ПК и мобильной версии.
              </p>
              <div className="mt-5 grid gap-5 lg:grid-cols-2">
                <div className="rounded-[24px] border border-slate-200 bg-slate-50/60 p-4">
                  <p className="text-sm font-semibold text-slate-900">ПК</p>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <label className="space-y-2">
                      <span className="text-sm font-semibold text-slate-700">Метка блока</span>
                      <Input name="typographyEyebrowFontSize" type="number" min={10} max={48} defaultValue={editorData.schema.settings.typography.eyebrowFontSize} />
                    </label>
                    <label className="space-y-2">
                      <span className="text-sm font-semibold text-slate-700">Главный текст</span>
                      <Input name="typographyTitleFontSize" type="number" min={10} max={48} defaultValue={editorData.schema.settings.typography.titleFontSize} />
                    </label>
                    <label className="space-y-2">
                      <span className="text-sm font-semibold text-slate-700">Описание</span>
                      <Input name="typographyDescriptionFontSize" type="number" min={10} max={48} defaultValue={editorData.schema.settings.typography.descriptionFontSize} />
                    </label>
                    <label className="space-y-2">
                      <span className="text-sm font-semibold text-slate-700">Ответы и поля</span>
                      <Input name="typographyAnswerFontSize" type="number" min={10} max={48} defaultValue={editorData.schema.settings.typography.answerFontSize} />
                    </label>
                    <label className="space-y-2">
                      <span className="text-sm font-semibold text-slate-700">Описание доп. информации</span>
                      <Input
                        name="typographyAdditionalInfoDescriptionFontSize"
                        type="number"
                        min={10}
                        max={48}
                        defaultValue={editorData.schema.settings.typography.additionalInfoDescriptionFontSize}
                      />
                    </label>
                  </div>
                </div>
                <div className="rounded-[24px] border border-sky-100 bg-sky-50/50 p-4">
                  <p className="text-sm font-semibold text-slate-900">Мобильная версия</p>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <label className="space-y-2">
                      <span className="text-sm font-semibold text-slate-700">Метка блока</span>
                      <Input name="mobileTypographyEyebrowFontSize" type="number" min={10} max={48} defaultValue={editorData.schema.settings.mobileTypography.eyebrowFontSize} />
                    </label>
                    <label className="space-y-2">
                      <span className="text-sm font-semibold text-slate-700">Главный текст</span>
                      <Input name="mobileTypographyTitleFontSize" type="number" min={10} max={48} defaultValue={editorData.schema.settings.mobileTypography.titleFontSize} />
                    </label>
                    <label className="space-y-2">
                      <span className="text-sm font-semibold text-slate-700">Описание</span>
                      <Input name="mobileTypographyDescriptionFontSize" type="number" min={10} max={48} defaultValue={editorData.schema.settings.mobileTypography.descriptionFontSize} />
                    </label>
                    <label className="space-y-2">
                      <span className="text-sm font-semibold text-slate-700">Ответы и поля</span>
                      <Input name="mobileTypographyAnswerFontSize" type="number" min={10} max={48} defaultValue={editorData.schema.settings.mobileTypography.answerFontSize} />
                    </label>
                    <label className="space-y-2">
                      <span className="text-sm font-semibold text-slate-700">Описание доп. информации</span>
                      <Input
                        name="mobileTypographyAdditionalInfoDescriptionFontSize"
                        type="number"
                        min={10}
                        max={48}
                        defaultValue={editorData.schema.settings.mobileTypography.additionalInfoDescriptionFontSize}
                      />
                    </label>
                  </div>
                </div>
              </div>
            </Card>

            <Card className="border-slate-200 p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Расширение</p>
              <div className="mt-5 space-y-4">
                <label className="flex items-start gap-3 rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
                  <input
                    type="checkbox"
                    name="autoScrollEnabled"
                    defaultChecked={editorData.survey.autoScrollEnabled}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-slate-900">{"\u0410\u0432\u0442\u043E\u043F\u0440\u043E\u043A\u0440\u0443\u0442\u043A\u0430 \u0432\u043E\u043F\u0440\u043E\u0441\u043E\u0432"}</span>
                    <span className="block text-xs text-slate-500">{"\u0410\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438 \u043E\u0442\u043A\u043B\u044E\u0447\u0430\u0435\u0442\u0441\u044F \u0434\u043B\u044F"} ranking, multi-choice, contact, slider {"\u0438"} text {"\u0431\u043B\u043E\u043A\u043E\u0432."}</span>
                  </span>
                </label>
                <label className="flex items-start gap-3 rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
                  <input
                    type="checkbox"
                    name="showProgressBar"
                    defaultChecked={editorData.schema.settings.showProgressBar}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-slate-900">{"\u041F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u0442\u044C \u043F\u0440\u043E\u0433\u0440\u0435\u0441\u0441"}</span>
                    <span className="block text-xs text-slate-500">{"\u041E\u0442\u043E\u0431\u0440\u0430\u0436\u0430\u0435\u0442 \u043D\u043E\u043C\u0435\u0440 \u0442\u0435\u043A\u0443\u0449\u0435\u0433\u043E \u044D\u043A\u0440\u0430\u043D\u0430 \u0438 \u043F\u043E\u043B\u043E\u0441\u0443 \u043F\u0440\u043E\u0445\u043E\u0436\u0434\u0435\u043D\u0438\u044F \u0432\u043D\u0443\u0442\u0440\u0438 \u043E\u043F\u0443\u0431\u043B\u0438\u043A\u043E\u0432\u0430\u043D\u043D\u043E\u0433\u043E \u043E\u043F\u0440\u043E\u0441\u0430."}</span>
                  </span>
                </label>
                <label className="flex items-start gap-3 rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
                  <input
                    type="checkbox"
                    name="timerEnabled"
                    defaultChecked={editorData.survey.timerEnabled}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-slate-900">Таймер на опрос</span>
                    <span className="block text-xs text-slate-500">Если время закончится, уже введённые ответы сохранятся как timed out.</span>
                  </span>
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-semibold text-slate-700">Длительность, секунд</span>
                  <Input name="timerSeconds" type="number" defaultValue={editorData.survey.timerSeconds ?? 0} />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-semibold text-slate-700">Текст финального окна</span>
                  <Input name="completionMessage" defaultValue={editorData.survey.completionMessage} />
                </label>
                <label className="flex items-start gap-3 rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
                  <input
                    type="checkbox"
                    name="showRestartButton"
                    defaultChecked={editorData.schema.settings.showRestartButton}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-slate-900">{"\u041A\u043D\u043E\u043F\u043A\u0430 \u00AB\u041F\u0440\u043E\u0439\u0442\u0438 \u0441\u043D\u043E\u0432\u0430\u00BB"}</span>
                    <span className="block text-xs text-slate-500">{"\u041F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u0435\u0442 \u043A\u043D\u043E\u043F\u043A\u0443 \u043F\u043E\u0432\u0442\u043E\u0440\u043D\u043E\u0433\u043E \u043F\u0440\u043E\u0445\u043E\u0436\u0434\u0435\u043D\u0438\u044F \u043D\u0430 \u0444\u0438\u043D\u0430\u043B\u044C\u043D\u043E\u043C \u044D\u043A\u0440\u0430\u043D\u0435."}</span>
                  </span>
                </label>
              </div>
            </Card>

            <Card className="border-slate-200 p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Уведомления</p>
              <div className="mt-5 space-y-4">
                {!env.TELEGRAM_BOT_TOKEN ? (
                  <div className="rounded-[24px] border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
                    Telegram-уведомления сейчас не смогут отправляться: на сервере не задан `TELEGRAM_BOT_TOKEN`.
                    После добавления токена в окружение и перезапуска сервисов уведомления начнут уходить в выбранный чат.
                  </div>
                ) : null}
                <label className="flex items-start gap-3 rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
                  <input
                    type="checkbox"
                    name="telegramEnabled"
                    defaultChecked={Boolean(editorData.survey.notificationConfig?.telegramEnabled)}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-slate-900">Отправлять в Telegram</span>
                    <span className="block text-xs text-slate-500">Результаты уходят асинхронно и не блокируют сохранение ответа.</span>
                  </span>
                </label>
                <div className="rounded-[24px] border border-slate-200 bg-white px-4 py-4">
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      name="telegramAiFilterEnabled"
                      defaultChecked={Boolean(editorData.survey.notificationConfig?.telegramAiFilterEnabled)}
                      className="mt-1 h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                    />
                    <span>
                      <span className="block text-sm font-semibold text-slate-900">Фильтровать Telegram по AI-зоне</span>
                      <span className="block text-xs text-slate-500">
                        Если включено, уведомление уйдёт только по выбранным цветам. Ответы всегда сохраняются в результатах.
                      </span>
                    </span>
                  </label>
                  <div className="mt-4 grid gap-2 sm:grid-cols-3">
                    {[
                      { value: "GREEN", label: "Зелёная", className: "border-emerald-100 bg-emerald-50 text-emerald-800" },
                      { value: "YELLOW", label: "Жёлтая", className: "border-amber-100 bg-amber-50 text-amber-800" },
                      { value: "RED", label: "Красная", className: "border-rose-100 bg-rose-50 text-rose-800" },
                    ].map((zone) => (
                      <label key={zone.value} className={`flex items-center gap-2 rounded-2xl border px-3 py-3 text-sm font-semibold ${zone.className}`}>
                        <input
                          type="checkbox"
                          name="telegramAiAllowedColors"
                          value={zone.value}
                          defaultChecked={telegramAiAllowedColors.has(zone.value)}
                          className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                        />
                        {zone.label}
                      </label>
                    ))}
                  </div>
                </div>
                <label className="space-y-2">
                  <span className="text-sm font-semibold text-slate-700">Override chat IDs</span>
                  <Textarea
                    name="telegramChatIdOverrides"
                    defaultValue={telegramChatIdOverridesDefault}
                    rows={4}
                    placeholder="Один Chat ID на строку"
                  />
                  <span className="block text-xs text-slate-500">
                    Укажите один или несколько Chat ID, по одному на строку. Все указанные чаты будут получать результаты. Chat ID можно взять через{" "}
                    <a href="https://t.me/username_to_id_bot" target="_blank" rel="noreferrer" className="font-semibold text-sky-700 hover:text-sky-900">
                      @username_to_id_bot
                    </a>
                    . Даже при ручном Override бот{" "}
                    <a href="https://t.me/Progress_Pro_bot" target="_blank" rel="noreferrer" className="font-semibold text-sky-700 hover:text-sky-900">
                      @Progress_Pro_bot
                    </a>{" "}
                    должен быть заранее запущен в этом чате.
                  </span>
                </label>
              </div>
            </Card>

            <Card className="border-slate-200 p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">AI-анализ</p>
              <div className="mt-5 space-y-4">
                <label className="flex items-start gap-3 rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
                  <input
                    type="checkbox"
                    name="aiEnabled"
                    defaultChecked={Boolean(editorData.survey.aiAnalysisRule?.enabled)}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-slate-900">AI-анализ результата</span>
                    <span className="block text-xs text-slate-500">Примечание формируется после завершения ответа в фоне.</span>
                  </span>
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-semibold text-slate-700">Провайдер</span>
                  <select
                    name="aiProvider"
                    defaultValue={editorData.survey.aiAnalysisRule?.provider ?? AiProvider.OPENROUTER}
                    className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                  >
                    <option value={AiProvider.OPENROUTER}>OpenRouter</option>
                    <option value={AiProvider.OPENAI}>OpenAI</option>
                  </select>
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-semibold text-slate-700">Prompt анализа</span>
                  <Textarea name="aiPrompt" defaultValue={editorData.survey.aiAnalysisRule?.prompt ?? ""} />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-semibold text-slate-700">Модель</span>
                  <select
                    name="aiModel"
                    defaultValue={editorData.survey.aiAnalysisRule?.model ?? ""}
                    className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                  >
                    <option value="">По умолчанию для провайдера</option>
                    {modelOptions.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-semibold text-slate-700">Сохранённый API key</span>
                  <Input
                    value={
                      editorData.survey.aiAnalysisRule?.apiKeyLastFour
                        ? `••••••••${editorData.survey.aiAnalysisRule.apiKeyLastFour}`
                        : "Ключ пока не сохранён"
                    }
                    readOnly
                    disabled
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-semibold text-slate-700">Новый API key OpenRouter / OpenAI</span>
                  <Input
                    name="aiApiKey"
                    type="password"
                    autoComplete="off"
                    placeholder="Вставьте ключ OpenRouter вида sk-or-v1-..."
                  />
                  <span className="block text-xs text-slate-500">
                    {editorData.survey.aiAnalysisRule?.apiKeyLastFour
                      ? `Сейчас сохранён ключ, оканчивающийся на ${editorData.survey.aiAnalysisRule.apiKeyLastFour}.`
                      : "Ключ пока не сохранён. Для OpenRouter вставьте ключ вида sk-or-v1-..."
                    }
                  </span>
                </label>
                <label className="flex items-start gap-3 rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
                  <input
                    type="checkbox"
                    name="aiClearApiKey"
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-slate-900">Удалить сохранённый ключ</span>
                    <span className="block text-xs text-slate-500">Оставьте поле API key пустым, если хотите сохранить текущий ключ без изменений.</span>
                  </span>
                </label>
                <div className="rounded-[24px] border border-slate-200 bg-white px-4 py-4">
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      name="completionRoutingEnabled"
                      defaultChecked={Boolean(editorData.survey.aiAnalysisRule?.completionRoutingEnabled)}
                      className="mt-1 h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                    />
                    <span>
                      <span className="block text-sm font-semibold text-slate-900">Финальный экран по AI-зоне</span>
                      <span className="block text-xs text-slate-500">
                        После прохождения кандидат увидит обработку ответов, а затем текст для зелёной, жёлтой или красной зоны.
                      </span>
                    </span>
                  </label>
                  <div className="mt-4 grid gap-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="space-y-2">
                        <span className="text-sm font-semibold text-slate-700">Заголовок обработки</span>
                        <Input name="completionProcessingTitle" defaultValue={aiCompletionCopy.processingTitle} />
                      </label>
                      <label className="space-y-2">
                        <span className="text-sm font-semibold text-slate-700">Текст обработки</span>
                        <Input name="completionProcessingMessage" defaultValue={aiCompletionCopy.processingMessage} />
                      </label>
                    </div>
                    <div className="grid gap-4 lg:grid-cols-3">
                      <div className="rounded-[22px] border border-emerald-100 bg-emerald-50/70 p-4">
                        <p className="text-sm font-semibold text-emerald-900">Зелёная зона</p>
                        <label className="mt-3 block space-y-2">
                          <span className="text-xs font-semibold text-emerald-800">Заголовок</span>
                          <Input name="completionGreenTitle" defaultValue={aiCompletionCopy.greenTitle} />
                        </label>
                        <label className="mt-3 block space-y-2">
                          <span className="text-xs font-semibold text-emerald-800">Текст</span>
                          <Textarea name="completionGreenMessage" defaultValue={aiCompletionCopy.greenMessage} rows={3} />
                        </label>
                        <div className="mt-4 border-t border-emerald-100 pt-4">
                          <p className="text-xs font-semibold text-emerald-900">Кнопки мессенджеров для кандидата</p>
                          <div className="mt-3 grid gap-3">
                            <label className="space-y-2">
                              <span className="text-xs font-semibold text-emerald-800">MAX</span>
                              <Input
                                name="completionGreenMaxUrl"
                                defaultValue={aiCompletionCopy.greenMaxUrl}
                                placeholder="https://max.ru/..."
                              />
                            </label>
                            <label className="space-y-2">
                              <span className="text-xs font-semibold text-emerald-800">Telegram</span>
                              <Input
                                name="completionGreenTelegramUrl"
                                defaultValue={aiCompletionCopy.greenTelegramUrl}
                                placeholder="https://t.me/..."
                              />
                            </label>
                            <label className="space-y-2">
                              <span className="text-xs font-semibold text-emerald-800">WhatsApp</span>
                              <Input
                                name="completionGreenWhatsappUrl"
                                defaultValue={aiCompletionCopy.greenWhatsappUrl}
                                placeholder="https://wa.me/..."
                              />
                            </label>
                          </div>
                        </div>
                      </div>
                      <div className="rounded-[22px] border border-amber-100 bg-amber-50/70 p-4">
                        <p className="text-sm font-semibold text-amber-900">Жёлтая зона</p>
                        <label className="mt-3 block space-y-2">
                          <span className="text-xs font-semibold text-amber-800">Заголовок</span>
                          <Input name="completionYellowTitle" defaultValue={aiCompletionCopy.yellowTitle} />
                        </label>
                        <label className="mt-3 block space-y-2">
                          <span className="text-xs font-semibold text-amber-800">Текст</span>
                          <Textarea name="completionYellowMessage" defaultValue={aiCompletionCopy.yellowMessage} rows={3} />
                        </label>
                      </div>
                      <div className="rounded-[22px] border border-rose-100 bg-rose-50/70 p-4">
                        <p className="text-sm font-semibold text-rose-900">Красная зона</p>
                        <label className="mt-3 block space-y-2">
                          <span className="text-xs font-semibold text-rose-800">Заголовок</span>
                          <Input name="completionRedTitle" defaultValue={aiCompletionCopy.redTitle} />
                        </label>
                        <label className="mt-3 block space-y-2">
                          <span className="text-xs font-semibold text-rose-800">Текст</span>
                          <Textarea name="completionRedMessage" defaultValue={aiCompletionCopy.redMessage} rows={3} />
                        </label>
                      </div>
                    </div>
                    <div className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                      <p className="text-sm font-semibold text-slate-900">Если AI не вернул цвет или произошла ошибка</p>
                      <div className="mt-3 grid gap-4 sm:grid-cols-2">
                        <label className="space-y-2">
                          <span className="text-xs font-semibold text-slate-700">Заголовок</span>
                          <Input name="completionFallbackTitle" defaultValue={aiCompletionCopy.fallbackTitle} />
                        </label>
                        <label className="space-y-2">
                          <span className="text-xs font-semibold text-slate-700">Текст</span>
                          <Textarea name="completionFallbackMessage" defaultValue={aiCompletionCopy.fallbackMessage} rows={3} />
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-6">
                <Button type="submit">Сохранить настройки</Button>
              </div>
            </Card>
          </GuardedSurveySettingsForm>

          <div className="space-y-6">
            <Card className="border-slate-200 p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">История</p>
                <div className="mt-4 space-y-3">
                {editorData.survey.versions.map((version) => (
                  <div key={version.id} className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">Версия {version.versionNumber}</p>
                        <p className="mt-1 text-xs text-slate-500">{formatDateTime(version.createdAt)}</p>
                        <p className="mt-2 text-sm text-slate-600">{version.changeSummary || "Без описания"}</p>
                      </div>
                      <form action={rollbackAction}>
                        <input type="hidden" name="versionId" value={version.id} />
                        <Button type="submit" variant="secondary" size="sm">
                          Откатить
                        </Button>
                      </form>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="border-slate-200 p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Публикация</p>
              <div className="mt-4 space-y-3 text-sm text-slate-600">
                <p>Публичная ссылка:</p>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-700">
                  {publicUrl}
                </div>
                <CopyButton text={publicUrl} />
                <Button asChild variant="secondary" className="w-full">
                  <Link href={`/s/${editorData.survey.publicSlug}`} target="_blank">
                    Открыть опубликованный опрос
                  </Link>
                </Button>
              </div>
            </Card>
          </div>
        </div>
      ) : null}

      {tab === "results" ? (
        <div className="space-y-6">
          <Card className="border-slate-200 p-6">
            <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-5" method="get">
              <input type="hidden" name="tab" value="results" />
              <label className="space-y-2 md:col-span-2 xl:col-span-2">
                <span className="text-sm font-semibold text-slate-700">Поиск по результатам</span>
                <Input
                  name="search"
                  defaultValue={resultsQuery?.search ?? ""}
                  placeholder="Слово, текст или эмодзи"
                />
                <span className="block text-xs text-slate-500">
                  Ищет по ответам, контактным данным, AI-анализу и цветовым меткам.
                </span>
              </label>
              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-700">Период с</span>
                <Input name="dateFrom" type="date" defaultValue={resultsQuery?.dateFrom ?? ""} />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-700">Период по</span>
                <Input name="dateTo" type="date" defaultValue={resultsQuery?.dateTo ?? ""} />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-700">Статус</span>
                <select
                  name="status"
                  defaultValue={resultsQuery?.status ?? "ALL"}
                  className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                >
                  <option value="ALL">Все</option>
                  <option value="COMPLETED">Завершён</option>
                  <option value="PARTIAL">Частично</option>
                  <option value="TIMED_OUT">Время вышло</option>
                </select>
              </label>
              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-700">Сортировка</span>
                <select
                  name="sort"
                  defaultValue={resultsQuery?.sort ?? "newest"}
                  className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                >
                  <option value="newest">Сначала новые</option>
                  <option value="oldest">Сначала старые</option>
                  <option value="score_desc">Баллы по убыванию</option>
                  <option value="score_asc">Баллы по возрастанию</option>
                </select>
              </label>
              <div className="md:col-span-2 xl:col-span-5 flex flex-wrap gap-3">
                <Button type="submit">Применить фильтр</Button>
                <Button asChild variant="secondary">
                  <Link href={`/app/surveys/${surveyId}?tab=results`}>Сбросить фильтры</Link>
                </Button>
                <Button asChild variant="secondary">
                  <a href={withBasePath(`/api/results/${surveyId}/export.xlsx?${exportResultsParams.toString()}`)}>
                    Скачать XLSX
                  </a>
                </Button>
              </div>
            </form>
          </Card>

          {generatedRetakeUrl ? (
            <Card className="border-emerald-100 bg-emerald-50 p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-emerald-900">Одноразовая ссылка повторного прохождения создана</p>
                  <p className="mt-1 text-sm leading-6 text-emerald-800">
                    Ссылка сработает только один раз. После первого открытия она создаст новую попытку и станет недействительной
                    {generatedRetakeExpiresAt
                      ? ` после ${formatDateTimeInTimeZone(generatedRetakeExpiresAt, { timeZone: "Europe/Moscow" })} (по мск)`
                      : ""}.
                  </p>
                </div>
                <CopyButton text={generatedRetakeUrl} />
              </div>
              <Input className="mt-4 bg-white" readOnly value={generatedRetakeUrl} />
            </Card>
          ) : null}

          <div className="space-y-4">
            <div className="px-1 text-sm text-slate-500">
              Найдено результатов: <span className="font-semibold text-slate-900">{results.length}</span>
            </div>
            {results.map((result) => {
              const aiScoreSummary = inferAiScoreSummary(result.aiNote, resultSurveyMaxScore);
              const hasScoreSummary = configuredSurveyMaxScore > 0;
              const scoreTotal =
                configuredSurveyMaxScore > 0 ? result.totalScore : (aiScoreSummary?.totalScore ?? 0);
              const scoreMax = configuredSurveyMaxScore > 0 ? resultSurveyMaxScore : (aiScoreSummary?.maxScore ?? 0);
              const scorePercent = hasScoreSummary ? calculateScorePercent(scoreTotal, scoreMax) : null;
              const copyText = buildResultCopyText({
                surveyTitle: editorData.survey.title,
                status: result.status,
                totalScore: scoreTotal,
                maxScore: scoreMax,
                startedAt: result.startedAt,
                completedAt: result.completedAt,
                answers: result.answers,
                aiNote: result.aiNote,
                answerPromptOverrides: resultPromptOverrides,
                includeScore: hasScoreSummary,
                includeAnswerScores: configuredSurveyMaxScore > 0,
              });
              const answerRows = buildAnswerRows(result.answers);
              const aiNoteTone = getAiNoteTone(result.aiNote);
              const telegramStatusBadge = getTelegramStatusBadge(result.telegramStatus);
              const telegramStatusMessage = getTelegramStatusMessage(result.telegramStatus);
              const canRetryTelegramNotification = Boolean(
                editorData.survey.notificationConfig?.telegramEnabled &&
                  result.status !== ResponseStatus.IN_PROGRESS &&
                  result.telegramStatus !== JobStatus.SUCCESS &&
                  result.telegramStatus !== JobStatus.PENDING,
              );
              const canRecalculateTimedOutResult = result.status === ResponseStatus.TIMED_OUT;
              const resultTitle = buildResultDisplayTitle(result.answers, resultFallbackNumbers.get(result.id) ?? 1, {
                nameOrCompanyOnly: useOperatorResultTitles,
              });

              return (
                <details key={result.id} className="group rounded-[28px] border border-slate-200 bg-white p-6">
                  <summary className="flex cursor-pointer list-none flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-3">
                        <h3 className="break-words text-xl font-semibold text-slate-950">{resultTitle}</h3>
                        <Badge tone={result.status === "COMPLETED" ? "success" : result.status === "TIMED_OUT" ? "warning" : "neutral"}>
                          {formatResponseStatus(result.status)}
                        </Badge>
                      </div>
                      <p className="mt-2 text-sm text-slate-500">
                        {formatDateTimeInTimeZone(result.startedAt, { timeZone: "Europe/Moscow" })} (по мск)
                        {result.completedAt
                          ? ` • ${formatDateTimeInTimeZone(result.completedAt, { timeZone: "Europe/Moscow" })} (по мск)`
                          : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      {hasScoreSummary ? (
                        <Badge tone="neutral">
                          {scorePercent == null
                            ? `${scoreTotal} баллов`
                            : `${scoreTotal} из ${scoreMax} баллов (${scorePercent}%)`}
                        </Badge>
                      ) : null}
                      <Badge tone={telegramStatusBadge.tone}>{telegramStatusBadge.label}</Badge>
                      {result.aiNote && aiNoteTone.label ? (
                        <span
                          className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${aiNoteTone.badgeClassName}`}
                        >
                          <span aria-hidden="true">{aiNoteTone.marker}</span>
                          {aiNoteTone.label}
                        </span>
                      ) : null}
                      <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 group-open:hidden">
                        <ChevronDown className="h-4 w-4" />
                        Развернуть
                      </span>
                      <span className="hidden items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 group-open:inline-flex">
                        <ChevronUp className="h-4 w-4" />
                        Свернуть
                      </span>
                    </div>
                  </summary>

                  <div className="mt-4 flex flex-wrap justify-end gap-3">
                    <CopyButton text={copyText} />
                    {canRecalculateTimedOutResult ? (
                      <form action={recalculateTimedOutResultAction}>
                        <input type="hidden" name="responseId" value={result.id} />
                        <input type="hidden" name="redirectTo" value={resultsRedirectTo} />
                        <Button type="submit" variant="secondary">
                          Пересчитать тайм-аут
                        </Button>
                      </form>
                    ) : null}
                    {canRetryTelegramNotification ? (
                      <form action={retryTelegramNotificationAction}>
                        <input type="hidden" name="responseId" value={result.id} />
                        <input type="hidden" name="redirectTo" value={resultsRedirectTo} />
                        <Button type="submit" variant="secondary">
                          Повторить Telegram
                        </Button>
                      </form>
                    ) : null}
                    {result.status !== "IN_PROGRESS" ? (
                      <form action={createRetakeLinkAction}>
                        <input type="hidden" name="responseId" value={result.id} />
                        <input type="hidden" name="redirectTo" value={resultsRedirectTo} />
                        <Button type="submit" variant="secondary">
                          Ссылка на повтор
                        </Button>
                      </form>
                    ) : null}
                    {editorData.abilities.delete ? (
                      <form action={deleteResultAction}>
                        <input type="hidden" name="responseId" value={result.id} />
                        <input type="hidden" name="redirectTo" value={resultsRedirectTo} />
                        <DeleteResultButton />
                      </form>
                    ) : null}
                  </div>

                  {hasScoreSummary && scorePercent != null ? (
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                          Итоговая сумма баллов
                        </p>
                        <p className="mt-1 text-lg font-semibold text-slate-950">
                          {scoreTotal} баллов из {scoreMax}
                        </p>
                      </div>
                      <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                          Итоговый результат
                        </p>
                        <p className="mt-1 text-lg font-semibold text-slate-950">{scorePercent}% из 100%</p>
                      </div>
                    </div>
                  ) : null}

                  {telegramStatusMessage ? (
                    <div className="mt-4 rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
                      <p className="font-semibold">{telegramStatusBadge.label}</p>
                      <p className="mt-2">{telegramStatusMessage}</p>
                    </div>
                  ) : null}

                  {result.aiNote ? (
                    <div className={`mt-4 rounded-[24px] border px-4 py-4 text-sm ${aiNoteTone.panelClassName}`}>
                      <div className="flex flex-wrap items-center gap-3">
                        <p className="font-semibold">
                          {aiNoteTone.marker ? `${aiNoteTone.marker} ` : ""}
                          AI-примечание
                        </p>
                        {aiNoteTone.label ? (
                          <span
                            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${aiNoteTone.badgeClassName}`}
                          >
                            {aiNoteTone.label}
                          </span>
                        ) : null}
                      </div>
                      <StructuredAiNote
                        aiNote={result.aiNote}
                        scoreSummary={
                          aiScoreSummary
                            ? aiScoreSummary
                            : scorePercent == null
                              ? null
                              : {
                                  totalScore: scoreTotal,
                                  maxScore: scoreMax,
                                  percent: scorePercent,
                                }
                        }
                        tone={aiNoteTone}
                      />
                    </div>
                  ) : result.aiStatus === "FAILED" ? (
                    <div className="mt-4 rounded-[24px] border border-rose-100 bg-rose-50 px-4 py-4 text-sm text-rose-700">
                      <p className="font-semibold">AI-анализ не выполнен</p>
                      <p className="mt-2">Проверьте провайдера, модель и API-ключ в настройках опроса.</p>
                    </div>
                  ) : result.aiStatus === "PENDING" ? (
                    <div className="mt-4 rounded-[24px] border border-sky-100 bg-sky-50 px-4 py-4 text-sm text-sky-700">
                      <p className="font-semibold">AI-анализ в очереди</p>
                      <p className="mt-2">Результат ещё обрабатывается фоновым worker-процессом.</p>
                    </div>
                  ) : null}

                  <div className="mt-5 grid gap-3">
                    {result.answers.map((answer, index) => {
                      const attachments = getResultAnswerAttachments(answer);
                      const showAnswerScore = configuredSurveyMaxScore > 0 && scoredBlockIds.has(answer.blockId);

                      return (
                        <div key={answer.id} className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
                          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                            <p className="min-w-0 font-semibold text-slate-900">{stripRichTextTokens(answer.prompt)}</p>
                            {showAnswerScore ? (
                              <span className="shrink-0 whitespace-nowrap pt-0.5 text-right text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                                {answer.score} б.
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-2 whitespace-pre-line text-sm leading-7 text-slate-600">
                            {formatResultAnswerValue(answer, answerRows[index]?.value)}
                          </p>
                          {attachments.length ? (
                            <div className="mt-3 grid gap-2">
                              {attachments.map((attachment) => (
                                <div key={attachment.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                                  <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div>
                                      <p className="text-sm font-semibold text-slate-900">
                                        {attachment.kind === "voice" ? "Голосовой ответ" : attachment.originalName}
                                      </p>
                                      <p className="mt-1 text-xs text-slate-500">
                                        {attachment.mimeType} • {formatAttachmentSize(attachment.byteSize)}
                                      </p>
                                    </div>
                                    <a
                                      href={withBasePath(attachment.url)}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-sm font-semibold text-sky-700 transition hover:text-sky-900"
                                    >
                                      Открыть
                                    </a>
                                  </div>
                                  {attachment.kind === "voice" ? (
                                    <>
                                      <audio controls src={withBasePath(attachment.url)} className="mt-3 w-full" />
                                      {attachment.transcript?.trim() ? (
                                        <div className="mt-3 rounded-2xl bg-sky-50 px-4 py-3 text-sm leading-6 text-sky-900">
                                          <p className="font-semibold">Расшифровка</p>
                                          <p className="mt-1 whitespace-pre-line">{attachment.transcript.trim()}</p>
                                        </div>
                                      ) : attachment.transcriptionStatus === "failed" ? (
                                        <p className="mt-3 text-sm text-amber-700">
                                          Запись сохранена, но расшифровка не выполнена. Проверьте API key выбранного AI-провайдера.
                                        </p>
                                      ) : null}
                                    </>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </details>
              );
            })}

            {!results.length ? (
              <Card className="border-slate-200 px-6 py-12 text-center text-sm text-slate-500">
                {hasActiveResultFilters
                  ? "По текущим фильтрам и поисковому запросу ничего не найдено. Измените условия или сбросьте фильтры."
                  : "Результатов пока нет. Опубликуйте опрос и пройдите его по публичной ссылке."}
              </Card>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
