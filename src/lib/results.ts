import { stripRichTextTokens } from "@/lib/rich-text";
import { mapAnswersToRows } from "@/lib/survey-schema";
import type { SurveyAnswerRow, SurveyBlockType, SurveySchema } from "@/types/surveys";

type ResultAnswer = {
  blockId: string;
  blockType: SurveyBlockType;
  prompt: string;
  value: unknown;
  rawValue?: unknown;
  score: number;
};

export type AiScoreSummary = {
  totalScore: number;
  maxScore: number;
  percent: number;
};

export type AiResultColor = "GREEN" | "YELLOW" | "RED";

export type AiCompletionCopy = {
  processingTitle: string;
  processingMessage: string;
  greenTitle: string;
  greenMessage: string;
  yellowTitle: string;
  yellowMessage: string;
  redTitle: string;
  redMessage: string;
  fallbackTitle: string;
  fallbackMessage: string;
};

export const DEFAULT_AI_COMPLETION_COPY: AiCompletionCopy = {
  processingTitle: "Ваши ответы обрабатываются",
  processingMessage: "Подождите совсем чуть-чуть. Мы анализируем ответы и подбираем следующий шаг.",
  greenTitle: "Поздравляем, вы нам подходите",
  greenMessage: "Напишите руководителю, и он подберёт удобное время для общения.",
  yellowTitle: "Спасибо за ваши ответы",
  yellowMessage: "Ваши ответы зафиксированы. При необходимости мы с вами свяжемся.",
  redTitle: "Спасибо за ваши ответы",
  redMessage: "Ваши ответы зафиксированы. При необходимости мы с вами свяжемся.",
  fallbackTitle: "Спасибо за ваши ответы",
  fallbackMessage: "Ваши ответы зафиксированы. При необходимости мы с вами свяжемся.",
};

export type ResultPromptOverrides = Record<string, string>;

const AI_NOTE_COLOR_MARKERS: Record<string, string> = {
  "ЗЕЛЕНЫЙ": "🟢",
  "ЗЕЛЁНЫЙ": "🟢",
  "ЖЕЛТЫЙ": "🟡",
  "ЖЁЛТЫЙ": "🟡",
  "КРАСНЫЙ": "🔴",
};

export function buildAnswerRows(answers: ResultAnswer[]): SurveyAnswerRow[] {
  return mapAnswersToRows(answers).map((row, index) => {
    const answer = answers[index];

    if (!answer || !isCombinedRawAnswerValue(answer.rawValue)) {
      return row;
    }

    return {
      ...row,
      value: stripLegacyCombinedAnswerLabels(row.value),
    };
  });
}

export function buildResultPromptOverrides(schema: SurveySchema): ResultPromptOverrides {
  return schema.blocks.reduce<ResultPromptOverrides>((overrides, block) => {
    if (block.resultLabelOverride != null) {
      overrides[block.id] = block.resultLabelOverride;
    }

    return overrides;
  }, {});
}

function resolveCopyPrompt(answer: ResultAnswer, fallbackPrompt: string, overrides?: ResultPromptOverrides) {
  if (!overrides || !Object.prototype.hasOwnProperty.call(overrides, answer.blockId)) {
    return fallbackPrompt;
  }

  const override = stripRichTextTokens(overrides[answer.blockId] ?? "").trim();
  return override || null;
}

function normalizeAiToken(value: string) {
  return value.trim().toUpperCase().replaceAll("Ё", "Е");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractAiField(aiNote: string, fieldNames: string[]) {
  const keyPattern = fieldNames.map((fieldName) => escapeRegExp(fieldName)).join("|");
  const fieldMatch = aiNote.match(
    new RegExp(`["']?(?:${keyPattern})["']?\\s*:\\s*(?:"([^"]*)"|'([^']*)'|([^,}\\n]+))`, "iu"),
  );
  const value = fieldMatch?.[1] ?? fieldMatch?.[2] ?? fieldMatch?.[3] ?? null;

  return value?.trim().replace(/^["']|["']$/g, "") || null;
}

function extractAiNoteColorMarker(aiNote: string) {
  const color = extractAiResultColor(aiNote);
  const token =
    color === "GREEN"
      ? "ЗЕЛЕНЫЙ"
      : color === "YELLOW"
        ? "ЖЕЛТЫЙ"
        : color === "RED"
          ? "КРАСНЫЙ"
          : null;

  return token ? AI_NOTE_COLOR_MARKERS[token] ?? null : null;
}

export function extractAiResultColor(aiNote: string | null | undefined): AiResultColor | null {
  const note = aiNote?.trim();
  if (!note) {
    return null;
  }

  const explicitColor =
    extractAiField(note, ["КАТЕГОРИЯ", "ЦВЕТ", "ИТОГОВАЯ МЕТКА", "ИТОГОВЫЙ ЦВЕТ", "ZONE", "COLOR"]) ??
    note.match(/(?:КАТЕГОРИЯ|ЦВЕТ|ИТОГОВАЯ\s+МЕТКА|ИТОГОВЫЙ\s+ЦВЕТ|ZONE|COLOR)\s*:\s*([A-ZА-ЯЁ]+)/iu)?.[1] ??
    null;
  const source = explicitColor ? normalizeAiToken(explicitColor) : normalizeAiToken(note);

  if (source.includes("🟢") || source.includes("GREEN") || source.includes("ЗЕЛЕН")) {
    return "GREEN";
  }

  if (source.includes("🟡") || source.includes("YELLOW") || source.includes("ЖЕЛТ")) {
    return "YELLOW";
  }

  if (source.includes("🔴") || source.includes("RED") || source.includes("КРАСН")) {
    return "RED";
  }

  return null;
}

export function shouldSendTelegramForAiResult(input: {
  filterEnabled: boolean;
  allowedColors: readonly string[];
  color: AiResultColor | null;
}) {
  if (!input.filterEnabled) {
    return true;
  }

  if (!input.color) {
    return false;
  }

  const allowedColors = new Set(input.allowedColors.map((color) => color.trim().toUpperCase()));
  return allowedColors.has(input.color);
}

export function normalizeAiResultColors(
  colors: readonly string[],
  options: { fallbackToGreen?: boolean } = {},
): AiResultColor[] {
  const normalized: AiResultColor[] = [];

  for (const color of colors) {
    const extracted = extractAiResultColor(color);
    if (extracted && !normalized.includes(extracted)) {
      normalized.push(extracted);
    }
  }

  if (!normalized.length && options.fallbackToGreen) {
    return ["GREEN"];
  }

  return normalized;
}

function cleanCompletionText(value: string, fallback: string) {
  const normalized = value.trim();
  return normalized || fallback;
}

export function resolveAiCompletionContent(input: {
  routingEnabled: boolean;
  aiStatus: "PENDING" | "SUCCESS" | "FAILED" | "SKIPPED";
  color: AiResultColor | null;
  defaultTitle: string;
  copy: AiCompletionCopy;
}): {
  phase: "processing" | "final";
  shouldPoll: boolean;
  color: AiResultColor | null;
  title: string;
  message: string;
} {
  if (!input.routingEnabled) {
    return {
      phase: "final",
      shouldPoll: false,
      color: null,
      title: cleanCompletionText(input.defaultTitle, "Спасибо за опрос!"),
      message: "",
    };
  }

  if (input.aiStatus === "PENDING") {
    return {
      phase: "processing",
      shouldPoll: true,
      color: null,
      title: cleanCompletionText(input.copy.processingTitle, DEFAULT_AI_COMPLETION_COPY.processingTitle),
      message: cleanCompletionText(input.copy.processingMessage, DEFAULT_AI_COMPLETION_COPY.processingMessage),
    };
  }

  if (input.aiStatus === "SUCCESS" && input.color === "GREEN") {
    return {
      phase: "final",
      shouldPoll: false,
      color: "GREEN",
      title: cleanCompletionText(input.copy.greenTitle, DEFAULT_AI_COMPLETION_COPY.greenTitle),
      message: cleanCompletionText(input.copy.greenMessage, DEFAULT_AI_COMPLETION_COPY.greenMessage),
    };
  }

  if (input.aiStatus === "SUCCESS" && input.color === "YELLOW") {
    return {
      phase: "final",
      shouldPoll: false,
      color: "YELLOW",
      title: cleanCompletionText(input.copy.yellowTitle, DEFAULT_AI_COMPLETION_COPY.yellowTitle),
      message: cleanCompletionText(input.copy.yellowMessage, DEFAULT_AI_COMPLETION_COPY.yellowMessage),
    };
  }

  if (input.aiStatus === "SUCCESS" && input.color === "RED") {
    return {
      phase: "final",
      shouldPoll: false,
      color: "RED",
      title: cleanCompletionText(input.copy.redTitle, DEFAULT_AI_COMPLETION_COPY.redTitle),
      message: cleanCompletionText(input.copy.redMessage, DEFAULT_AI_COMPLETION_COPY.redMessage),
    };
  }

  return {
    phase: "final",
    shouldPoll: false,
    color: null,
    title: cleanCompletionText(input.copy.fallbackTitle, DEFAULT_AI_COMPLETION_COPY.fallbackTitle),
    message: cleanCompletionText(input.copy.fallbackMessage, DEFAULT_AI_COMPLETION_COPY.fallbackMessage),
  };
}

function normalizeDecimal(value: string) {
  const number = Number(value.replace(",", "."));
  if (!Number.isFinite(number)) {
    return value;
  }

  return Number.isInteger(number) ? String(number) : String(Number(number.toFixed(1)));
}

function extractAiNoteScore(aiNote: string, maxScoreOverride?: number | null) {
  const scoreField = extractAiField(aiNote, ["ОЦЕНКА ИИ", "ОЦЕНКА", "БАЛЛ"]);
  const scoreSource = scoreField ?? aiNote;
  const scoreMatch = scoreSource.match(/(?:^|\n|\s|["'])(?:БАЛЛ|ОЦЕНКА\s*ИИ|ОЦЕНКА)?\s*:?\s*(\d{1,3}(?:[.,]\d{1,2})?)(?:\s*(?:\/|из)\s*(\d{1,3}(?:[.,]\d{1,2})?))?/iu);
  if (!scoreMatch) {
    return null;
  }

  const score = Number(scoreMatch[1].replace(",", "."));
  const parsedMaxScore = Number((scoreMatch[2] ?? "10").replace(",", "."));
  const maxScore = maxScoreOverride && maxScoreOverride > 0 ? maxScoreOverride : parsedMaxScore;
  if (!Number.isFinite(score) || score < 0) {
    return null;
  }

  return `${normalizeDecimal(scoreMatch[1])}/${Number.isFinite(maxScore) && maxScore > 0 ? normalizeDecimal(String(maxScore)) : "10"}`;
}

function extractAiNotePercent(aiNote: string, scoreLabel: string | null, maxScoreOverride?: number | null) {
  let computedPercent: number | null = null;
  const scoreMatch = scoreLabel?.match(/(\d{1,3}(?:[.,]\d{1,2})?)\s*\/\s*(\d{1,3}(?:[.,]\d{1,2})?)/u);
  if (scoreMatch) {
    const score = Number(scoreMatch[1].replace(",", "."));
    const maxScore = maxScoreOverride && maxScoreOverride > 0 ? maxScoreOverride : Number(scoreMatch[2].replace(",", "."));
    if (Number.isFinite(score) && Number.isFinite(maxScore) && maxScore > 0) {
      computedPercent = Math.max(0, Math.min(100, Math.round((score / maxScore) * 100)));
    }
  }

  const percentField = extractAiField(aiNote, ["ПРОЦЕНТ", "ИТОГОВЫЙ РЕЗУЛЬТАТ"]);
  const explicitPercent = percentField?.match(/(\d{1,3}(?:[.,]\d{1,2})?)/u)?.[1] ?? null;

  if (explicitPercent) {
    const explicitValue = Number(explicitPercent.replace(",", "."));
    if (!Number.isFinite(explicitValue) || computedPercent == null || Math.abs(explicitValue - computedPercent) <= 1) {
      return `${normalizeDecimal(explicitPercent)}%`;
    }
  }

  return computedPercent != null ? `${computedPercent}%` : explicitPercent ? `${normalizeDecimal(explicitPercent)}%` : null;
}

function cleanAiNoteExplanation(aiNote: string) {
  const explicitExplanation = extractAiField(aiNote, ["ПОЯСНЕНИЕ", "КОММЕНТАРИЙ", "КРАТКИЙ КОММЕНТАРИЙ"]);
  if (explicitExplanation) {
    return explicitExplanation.length > 420 ? `${explicitExplanation.slice(0, 417).trimEnd()}...` : explicitExplanation;
  }

  const withoutTechnicalLines = aiNote
    .replace(/(?:^|\n)\s*(?:БАЛЛ|ОЦЕНКА\s*ИИ|ОЦЕНКА)\s*:\s*\d{1,3}(?:\s*(?:\/|из)\s*\d{1,3})?\s*/giu, "\n")
    .replace(/(?:^|\n)\s*ПРОЦЕНТ\s*:\s*\d{1,3}(?:[.,]\d{1,2})?%?\s*/giu, "\n")
    .replace(/(?:^|\n)\s*КАТЕГОРИЯ\s*:\s*["']?[A-ZА-ЯЁ]+["']?\s*/giu, "\n")
    .replace(/ЦВЕТ\s*:\s*[A-ZА-ЯЁ]+/giu, " ")
    .replace(/(?:ИТОГОВАЯ\s+МЕТКА|ИТОГОВЫЙ\s+ЦВЕТ)\s*:\s*[A-ZА-ЯЁ]+/giu, " ")
    .replace(/(?:СУММАРНЫЙ\s+БАЛЛ|ИТОГОВЫЙ\s+РЕЗУЛЬТАТ)\s*:\s*[^.\n]+/giu, " ")
    .replace(/Краткий\s+комментарий\s*:/giu, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!withoutTechnicalLines) {
    return null;
  }

  return withoutTechnicalLines.length > 420 ? `${withoutTechnicalLines.slice(0, 417).trimEnd()}...` : withoutTechnicalLines;
}

function formatCompactAiNote(aiNote: string | null | undefined, emptyAiNoteLabel?: string | null, maxScoreOverride?: number | null) {
  const note = aiNote?.trim();
  if (!note) {
    return emptyAiNoteLabel?.trim() ? { score: emptyAiNoteLabel.trim(), marker: null, explanation: null } : null;
  }

  const score = extractAiNoteScore(note, maxScoreOverride) ?? "—";
  const percent = extractAiNotePercent(note, score === "—" ? null : score, maxScoreOverride);
  const marker = extractAiNoteColorMarker(note);
  const scoreWithPercent = percent ? `${score} (${percent})` : score;
  const scoreLabel = marker ? `${scoreWithPercent} ${marker}` : scoreWithPercent;

  return {
    score: scoreLabel,
    marker,
    explanation: cleanAiNoteExplanation(note),
  };
}

function formatCompactAnswerValue(value: string) {
  const normalized = value.trim();
  return normalized || "-";
}

function isCombinedRawAnswerValue(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return "selectedValue" in value || "text" in value;
}

function stripLegacyCombinedAnswerLabels(value: string) {
  const lines = value.split(/\r?\n/);
  const contentLines = lines.map((line) => line.trim()).filter(Boolean);
  if (!contentLines.length) {
    return value;
  }

  const legacyLabelPattern = /^(?:Выбранный вариант|Свой ответ):\s*/i;
  if (!contentLines.every((line) => legacyLabelPattern.test(line))) {
    return value;
  }

  return lines.map((line) => line.replace(legacyLabelPattern, "")).join("\n").trim();
}

export function calculateScorePercent(totalScore: number, maxScore?: number | null) {
  const normalizedMaxScore = Number(maxScore);
  if (!Number.isFinite(normalizedMaxScore) || normalizedMaxScore <= 0) {
    return null;
  }

  const normalizedTotalScore = Number(totalScore);
  if (!Number.isFinite(normalizedTotalScore) || normalizedTotalScore <= 0) {
    return 0;
  }

  const rawPercent = (normalizedTotalScore / normalizedMaxScore) * 100;
  const roundedPercent = Math.round(rawPercent);

  return Math.max(1, Math.min(100, roundedPercent));
}

export function extractSurveyAnalysisMaxScore(prompt: string | null | undefined) {
  const normalizedPrompt = prompt?.replace(/\s+/g, " ").trim();
  if (!normalizedPrompt) {
    return null;
  }

  const patterns = [
    /(?:максимум(?:\s+для\s+итогового\s+процента)?|макс\.?|макс|итогового\s+процента|итоговый\s+процент|итогового\s+результата|итоговый\s+результат|итоговый\s+максимум|максимальная\s+оценка|максимальный\s+балл|максимальное\s+количество\s+баллов|общий\s+максимум|не\s+более|не\s+выше|в\s+пределах|суммарно|max(?:imum)?(?:\s+(?:score|points?))?)[^0-9]{0,80}(\d{1,3}(?:[.,]\d{1,2})?)/iu,
    /(?:не\s+более|не\s+выше|до)\s*(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:балл(?:ов|а)?|score|points?)/iu,
    /(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:балл(?:ов|а)?|score|points?)[^.\n]{0,80}(?:максимум|макс\.?|макс|итогового\s+процента|итоговый\s+процент|итогового\s+результата|итоговый\s+результат|итоговый\s+максимум|максимум|max(?:imum)?|не\s+более|не\s+выше|в\s+пределах|общий|суммарно)/iu,
  ];

  for (const pattern of patterns) {
    const match = normalizedPrompt.match(pattern);
    if (!match) {
      continue;
    }

    const value = Number(match[1].replace(",", "."));
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }

  return null;
}

export function inferAiScoreSummary(aiNote: string | null | undefined, maxScoreOverride?: number | null): AiScoreSummary | null {
  if (!aiNote?.trim()) {
    return null;
  }

  const normalizedMaxScore = maxScoreOverride && maxScoreOverride > 0 ? maxScoreOverride : null;
  const questionScores = Array.from(aiNote.matchAll(/(?:Вопрос\s+\d+|[^:\n]{2,80})\s*:\s*(\d{1,3})\s*\/\s*10\b/giu))
    .map((match) => match[1])
    .filter((score): score is string => Boolean(score))
    .map((score) => Math.max(0, Math.min(10, Number(score))));

  if (questionScores.length > 0) {
    const totalScore = questionScores.reduce((sum, score) => sum + score, 0);
    const maxScore = normalizedMaxScore ?? questionScores.length * 10;

    return {
      totalScore,
      maxScore,
      percent: calculateScorePercent(totalScore, maxScore) ?? 0,
    };
  }

  const explicitMatch = aiNote.match(
    /(?:СУММАРНЫЙ БАЛЛ|ИТОГОВАЯ СУММА БАЛЛОВ|ИТОГОВАЯ СУММА|ОЦЕНКА ИИ|ОЦЕНКА|БАЛЛ)\s*:\s*(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:баллов\s*)?(?:из|\/)\s*(\d{1,3}(?:[.,]\d{1,2})?)/iu,
  );

  if (explicitMatch) {
    const totalScore = Number(explicitMatch[1].replace(",", "."));
    const parsedMaxScore = Number(explicitMatch[2].replace(",", "."));
    const maxScore = normalizedMaxScore ?? parsedMaxScore;

    if (Number.isFinite(totalScore) && Number.isFinite(maxScore) && maxScore > 0) {
      return {
        totalScore,
        maxScore,
        percent: calculateScorePercent(totalScore, maxScore) ?? 0,
      };
    }
  }

  return null;
}

export function buildResultCopyText(input: {
  surveyTitle: string;
  status: string;
  totalScore: number;
  maxScore?: number | null;
  startedAt: Date | string;
  completedAt?: Date | string | null;
  answers: ResultAnswer[];
  aiNote?: string | null;
  emptyAiNoteLabel?: string | null;
  answerPromptOverrides?: ResultPromptOverrides;
  includeScore?: boolean;
  includeAnswerScores?: boolean;
}) {
  const answerRows = buildAnswerRows(input.answers);
  const maxScore = input.maxScore && input.maxScore > 0 ? input.maxScore : null;
  const scorePercent = calculateScorePercent(input.totalScore, maxScore);
  const includeScore = input.includeScore !== false;
  const includeAnswerScores = input.includeAnswerScores ?? includeScore;
  const lines = [`Опрос: ${input.surveyTitle}`];

  if (includeScore) {
    lines.push(maxScore ? `Итоговая сумма баллов: ${input.totalScore} баллов из ${maxScore}` : `Результат: ${input.totalScore} баллов`);
  }

  if (includeScore && scorePercent != null) {
    lines.push(`Итоговый результат: ${scorePercent}% из 100%`);
  }

  const compactAiNote = formatCompactAiNote(input.aiNote, input.emptyAiNoteLabel, maxScore);
  if (compactAiNote) {
    lines.push("");
    lines.push(`Оценка ИИ: ${compactAiNote.score}`);

    if (compactAiNote.explanation) {
      lines.push("");
      lines.push(`Пояснение: ${compactAiNote.marker ? `${compactAiNote.marker} ` : ""}${compactAiNote.explanation}`);
    }
  }

  lines.push("");

  let visibleAnswerIndex = 1;
  answerRows.forEach((answer, index) => {
    const sourceAnswer = input.answers[index];
    if (!sourceAnswer) {
      return;
    }

    const prompt = resolveCopyPrompt(sourceAnswer, answer.prompt, input.answerPromptOverrides);
    if (prompt == null) {
      return;
    }

    const value = formatCompactAnswerValue(answer.value);
    const oneLineValue = !value.includes("\n");
    lines.push(oneLineValue ? `${visibleAnswerIndex}. ${prompt}: ${value}` : `${visibleAnswerIndex}. ${prompt}:\n${value}`);
    if (includeAnswerScores) {
      lines.push(`Баллы: ${answer.score}`);
    }
    lines.push("");
    visibleAnswerIndex += 1;
  });

  while (lines.at(-1) === "") {
    lines.pop();
  }

  return lines.join("\n");
}
