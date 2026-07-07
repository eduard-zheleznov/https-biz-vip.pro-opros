import OpenAI from "openai";
import { jsonrepair } from "jsonrepair";

import { AiProvider } from "@/generated/prisma/client";
import { env } from "@/lib/env";
import { BLOCK_TYPES } from "@/types/surveys";

const SURVEY_DRAFT_MAX_TOKENS = 5000;
const SURVEY_DRAFT_RETRY_MAX_TOKENS = 7000;
const SURVEY_RESULT_ANALYSIS_MAX_TOKENS = 1400;
const SURVEY_RESULT_ANALYSIS_RETRY_MAX_TOKENS = 2400;
const SURVEY_RESULT_ANALYSIS_COMPACT_MAX_TOKENS = 1800;
const SURVEY_RESULT_COLOR_MAX_TOKENS = 32;
const OPENAI_VOICE_TRANSCRIPTION_MODEL = "whisper-1";
const OPENROUTER_DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const OPENROUTER_VOICE_TRANSCRIPTION_MODELS = [
  "openai/gpt-4o-mini-transcribe",
  "openai/whisper-large-v3-turbo",
  "openai/whisper-large-v3",
  "openai/whisper-1",
  "openai/gpt-4o-transcribe",
] as const;

const AI_NOTE_COLOR_RED = "КРАСНЫЙ";
const AI_NOTE_COLOR_YELLOW = "ЖЕЛТЫЙ";
const AI_NOTE_COLOR_GREEN = "ЗЕЛЕНЫЙ";
const AI_NOTE_COLOR_LINE_PREFIX = "ЦВЕТ";
const AI_NOTE_COLORS = [AI_NOTE_COLOR_RED, AI_NOTE_COLOR_YELLOW, AI_NOTE_COLOR_GREEN] as const;

type AiNoteColor = (typeof AI_NOTE_COLORS)[number];

export function resolveOpenRouterBaseUrl() {
  return (env.OPENROUTER_BASE_URL.trim() || OPENROUTER_DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function resolveAiConfig(input: {
  provider?: AiProvider | null;
  apiKey?: string | null;
  model?: string | null;
}) {
  const provider = input.provider ?? AiProvider.OPENAI;

  if (provider === AiProvider.OPENROUTER) {
    const inputApiKey = input.apiKey?.trim() ?? "";
    const envApiKey = env.OPENROUTER_API_KEY.trim();
    const apiKey = inputApiKey.startsWith("sk-or-") ? inputApiKey : envApiKey;

    if (!apiKey) {
      throw new Error("Для OpenRouter не задан API-ключ.");
    }

    return {
      apiKey,
      model: input.model?.trim() || env.OPENROUTER_MODEL || "openai/gpt-4.1-mini",
      baseURL: resolveOpenRouterBaseUrl(),
      defaultHeaders: {
        "HTTP-Referer": env.APP_URL,
        "X-Title": "Survey Builder 2.0",
      },
    };
  }

  const inputApiKey = input.apiKey?.trim() ?? "";
  const envApiKey = env.OPENAI_API_KEY.trim();
  const apiKey = inputApiKey.startsWith("sk-") ? inputApiKey : envApiKey;
  if (!apiKey) {
    throw new Error("Для OpenAI не задан API-ключ.");
  }

  return {
    apiKey,
    model: input.model?.trim() || env.OPENAI_MODEL || "gpt-5.2",
    baseURL: undefined,
    defaultHeaders: undefined,
  };
}

function extractMessageText(content: unknown) {
  if (typeof content === "string") {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return null;
  }

  const parts = content
    .map((part) => {
      if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
        return part.text;
      }

      return "";
    })
    .filter(Boolean);

  return parts.join("\n").trim() || null;
}

function tryParseJsonObject(content: string) {
  return JSON.parse(content) as unknown;
}

function normalizeColorToken(value: string | null | undefined) {
  return value?.toUpperCase().replaceAll("Ё", "Е").trim() ?? "";
}

function resolveAiNoteColorToken(value: string | null | undefined): AiNoteColor | null {
  const normalized = normalizeColorToken(value);

  if (!normalized) {
    return null;
  }

  if (normalized.includes("КРАСН") || normalized.includes("RED")) {
    return AI_NOTE_COLOR_RED;
  }

  if (normalized.includes("ЖЕЛТ") || normalized.includes("YELLOW")) {
    return AI_NOTE_COLOR_YELLOW;
  }

  if (normalized.includes("ЗЕЛЕН") || normalized.includes("GREEN")) {
    return AI_NOTE_COLOR_GREEN;
  }

  return null;
}

export function extractAiNoteColor(note: string | null | undefined): AiNoteColor | null {
  const normalized = normalizeColorToken(note);
  const explicitColor = normalized.match(/ЦВЕТ\s*:\s*([A-ZА-Я]+)/u)?.[1] ?? null;

  return resolveAiNoteColorToken(explicitColor) ?? resolveAiNoteColorToken(normalized);
}

export function appendAiNoteColor(note: string | null | undefined, color: AiNoteColor) {
  const trimmed = note?.trim() ?? "";

  if (!trimmed) {
    return `${AI_NOTE_COLOR_LINE_PREFIX}: ${color}`;
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0 && !/^цвет\s*:/iu.test(line.trim()));

  return [...lines, `${AI_NOTE_COLOR_LINE_PREFIX}: ${color}`].join("\n").trim();
}

export function extractJsonObject(content: string) {
  const trimmed = content.trim();
  const fencedMatch = trimmed.match(/```json\s*([\s\S]+?)```/i) ?? trimmed.match(/```\s*([\s\S]+?)```/i);
  const candidate = fencedMatch?.[1]?.trim() || trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("AI не вернул JSON-описание опроса.");
  }

  const jsonCandidate = candidate.slice(start, end + 1);

  try {
    return tryParseJsonObject(jsonCandidate);
  } catch (parseError) {
    try {
      return tryParseJsonObject(jsonrepair(jsonCandidate));
    } catch {
      throw new Error(
        parseError instanceof Error
          ? `AI вернул некорректный JSON-черновик опроса. ${parseError.message}`
          : "AI вернул некорректный JSON-черновик опроса.",
      );
    }
  }
}

function audioFormatForFile(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const mimeType = file.type.toLowerCase().split(";")[0]?.trim() ?? "";
  const byMime: Record<string, string> = {
    "audio/aac": "aac",
    "audio/flac": "flac",
    "audio/m4a": "m4a",
    "audio/mp4": "m4a",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/mpga": "mp3",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
    "audio/webm": "webm",
    "audio/x-m4a": "m4a",
    "audio/x-wav": "wav",
    "video/mp4": "mp4",
    "video/quicktime": "mp4",
    "video/webm": "webm",
  };

  return byMime[mimeType] ?? extension ?? "webm";
}

async function requestOpenRouterTranscription(input: { file: File; apiKey: string; model: string; audioBase64: string }) {
  const response = await fetch(`${resolveOpenRouterBaseUrl()}/audio/transcriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": env.APP_URL,
      "X-Title": "Survey Builder 2.0",
    },
    body: JSON.stringify({
      model: input.model,
      input_audio: {
        data: input.audioBase64,
        format: audioFormatForFile(input.file),
      },
      language: "ru",
      temperature: 0,
    }),
  });
  const payload = (await response.json().catch(() => null)) as
    | { text?: unknown; error?: { message?: unknown } | string }
    | null;

  if (!response.ok) {
    const message =
      typeof payload?.error === "string"
        ? payload.error
        : typeof payload?.error?.message === "string"
          ? payload.error.message
          : `OpenRouter STT вернул ошибку ${response.status}.`;
    throw new Error(message);
  }

  return typeof payload?.text === "string" ? payload.text.trim() : "";
}

async function transcribeVoiceWithOpenRouter(input: { file: File; apiKey: string }) {
  const audioBase64 = Buffer.from(await input.file.arrayBuffer()).toString("base64");
  const errors: string[] = [];

  for (const model of OPENROUTER_VOICE_TRANSCRIPTION_MODELS) {
    try {
      return await requestOpenRouterTranscription({
        file: input.file,
        apiKey: input.apiKey,
        model,
        audioBase64,
      });
    } catch (error) {
      errors.push(`${model}: ${error instanceof Error ? error.message : "ошибка транскрибации"}`);
    }
  }

  throw new Error(errors.join("; "));
}

async function transcribeVoiceWithOpenAI(input: { file: File; apiKey: string }) {
  const client = new OpenAI({ apiKey: input.apiKey });
  const response = await client.audio.transcriptions.create({
    file: input.file,
    model: OPENAI_VOICE_TRANSCRIPTION_MODEL,
    language: "ru",
    response_format: "json",
  });
  const text = typeof response === "string" ? response : response.text;

  return text?.trim() ?? "";
}

export async function transcribeVoiceAnswer(input: {
  file: File;
  provider?: AiProvider | null;
  apiKey?: string | null;
}) {
  const provider = input.provider ?? AiProvider.OPENAI;
  const inputApiKey = input.apiKey?.trim() ?? "";
  const envApiKey = provider === AiProvider.OPENROUTER ? env.OPENROUTER_API_KEY.trim() : env.OPENAI_API_KEY.trim();
  const apiKey =
    provider === AiProvider.OPENROUTER
      ? inputApiKey.startsWith("sk-or-")
        ? inputApiKey
        : envApiKey
      : inputApiKey.startsWith("sk-")
        ? inputApiKey
        : envApiKey;

  if (!apiKey) {
    return {
      text: "",
      error:
        provider === AiProvider.OPENROUTER
          ? "Для расшифровки голосового ответа не задан OpenRouter API key."
          : "Для расшифровки голосового ответа не задан OpenAI API key.",
    };
  }

  try {
    const text =
      provider === AiProvider.OPENROUTER
        ? await transcribeVoiceWithOpenRouter({ file: input.file, apiKey })
        : await transcribeVoiceWithOpenAI({ file: input.file, apiKey });

    return {
      text,
      error: "",
    };
  } catch (error) {
    return {
      text: "",
      error: error instanceof Error ? error.message : "Не удалось расшифровать голосовой ответ.",
    };
  }
}

type AnalyzeSurveyResultInput = {
  surveyTitle: string;
  totalScore: number;
  maxScore?: number | null;
  answersText: string;
  prompt: string;
  provider?: AiProvider | null;
  apiKey?: string | null;
  model?: string | null;
};

function buildSurveyAnalysisContext(input: AnalyzeSurveyResultInput) {
  return [
    "Если ответ помечен как \"Не отвечено (начислен средний балл)\", это не ноль: система уже начислила за этот вопрос 50% от максимального балла. Не обнуляй общий балл из-за тайм-аута или незавершения анкеты; используй переданный общий балл как источник истины.",
    `Правило анализа, которое нужно выполнить буквально:\n${input.prompt}`,
    `Опрос: ${input.surveyTitle}`,
    `Общий балл: ${input.totalScore}`,
    input.maxScore && input.maxScore > 0
      ? `Максимум для итогового процента: ${input.maxScore} баллов. Считай процент именно от этого максимума по всем вопросам опроса, даже если часть вопросов не отвечена.`
      : null,
    `Ответы:\n${input.answersText}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildSurveyAnalysisMessages(input: AnalyzeSurveyResultInput, compact: boolean) {
  return [
    {
      role: "system" as const,
      content: [
        "Если система передала общий балл, он является источником истины для итогового балла и процента. Не заменяй его на 0 из-за незавершения анкеты или тайм-аута.",
        "Ты анализируешь результаты опросов.",
        "Строго следуй пользовательскому правилу анализа и не подменяй его своими выводами.",
        "Отвечай по-русски, без вводных фраз и без markdown.",
        compact
          ? "Сделай ответ максимально компактным, но полным: сохрани все обязательные секции, а комментарии держи в пределах одного короткого предложения на секцию."
          : "Верни полный итог по правилу и не обрывай ответ на середине мысли.",
        `Последняя строка ответа должна быть в точном формате: ${AI_NOTE_COLOR_LINE_PREFIX}: ${AI_NOTE_COLOR_RED} или ${AI_NOTE_COLOR_YELLOW} или ${AI_NOTE_COLOR_GREEN}.`,
        "Никогда не пропускай последнюю строку с цветом.",
        "Если правило само задаёт цвет, используй именно его.",
        "Если правило не задаёт цвет явно, выбери наиболее подходящий цвет по своему итоговому выводу.",
      ].join(" "),
    },
    {
      role: "user" as const,
      content: `${buildSurveyAnalysisContext(input)}\n\nСформулируй итог строго по правилу выше.`,
    },
  ];
}

async function requestSurveyAnalysisNote(input: {
  client: OpenAI;
  model: string;
  analysisInput: AnalyzeSurveyResultInput;
  maxTokens: number;
  compact: boolean;
}) {
  const response = await input.client.chat.completions.create({
    model: input.model,
    temperature: 0.2,
    max_tokens: input.maxTokens,
    messages: buildSurveyAnalysisMessages(input.analysisInput, input.compact),
  });

  const content = extractMessageText(response.choices[0]?.message?.content);
  if (!content) {
    throw new Error("AI не вернул содержимое анализа результата.");
  }

  return {
    content,
    finishReason: response.choices[0]?.finish_reason ?? null,
  };
}

async function classifySurveyAnalysisColor(input: {
  client: OpenAI;
  model: string;
  analysisInput: AnalyzeSurveyResultInput;
  analysisNote: string;
}) {
  const response = await input.client.chat.completions.create({
    model: input.model,
    temperature: 0,
    max_tokens: SURVEY_RESULT_COLOR_MAX_TOKENS,
    messages: [
      {
        role: "system",
        content: `Верни только одно слово из списка: ${AI_NOTE_COLOR_RED}, ${AI_NOTE_COLOR_YELLOW}, ${AI_NOTE_COLOR_GREEN}. Без пояснений и знаков препинания.`,
      },
      {
        role: "user",
        content: [
          `Правило анализа:\n${input.analysisInput.prompt}`,
          `Опрос: ${input.analysisInput.surveyTitle}`,
          `Общий балл: ${input.analysisInput.totalScore}`,
          `Уже сформированный итог:\n${input.analysisNote}`,
          "Выбери итоговый цвет строго из трёх вариантов выше.",
        ].join("\n\n"),
      },
    ],
  });

  return extractAiNoteColor(extractMessageText(response.choices[0]?.message?.content));
}

export async function analyzeSurveyResult(input: AnalyzeSurveyResultInput) {
  const config = resolveAiConfig({
    provider: input.provider,
    apiKey: input.apiKey,
    model: input.model,
  });

  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    defaultHeaders: config.defaultHeaders,
  });

  const tokenBudgets = [SURVEY_RESULT_ANALYSIS_MAX_TOKENS, SURVEY_RESULT_ANALYSIS_RETRY_MAX_TOKENS];
  let analysisNote = "";
  let wasTruncated = false;

  for (const maxTokens of tokenBudgets) {
    const response = await requestSurveyAnalysisNote({
      client,
      model: config.model,
      analysisInput: input,
      maxTokens,
      compact: false,
    });

    analysisNote = response.content;
    wasTruncated = response.finishReason === "length";

    if (!wasTruncated) {
      break;
    }
  }

  if (wasTruncated) {
    const compactResponse = await requestSurveyAnalysisNote({
      client,
      model: config.model,
      analysisInput: input,
      maxTokens: SURVEY_RESULT_ANALYSIS_COMPACT_MAX_TOKENS,
      compact: true,
    });

    analysisNote = compactResponse.content;
  }

  const trimmedNote = analysisNote.trim();
  if (!trimmedNote) {
    return null;
  }

  const color =
    extractAiNoteColor(trimmedNote) ??
    (await classifySurveyAnalysisColor({
      client,
      model: config.model,
      analysisInput: input,
      analysisNote: trimmedNote,
    })) ??
    AI_NOTE_COLOR_YELLOW;

  return appendAiNoteColor(trimmedNote, color);
}

export async function generateSurveyDraftFromPrompt(input: {
  prompt: string;
  provider?: AiProvider | null;
  apiKey?: string | null;
  model?: string | null;
}) {
  const config = resolveAiConfig({
    provider: input.provider,
    apiKey: input.apiKey,
    model: input.model,
  });

  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    defaultHeaders: config.defaultHeaders,
  });
  const messages = [
    {
      role: "system" as const,
      content: [
        "Ты проектируешь структуру опроса и возвращаешь только JSON без пояснений.",
        "Собери готовый черновик опроса на русском языке.",
        `Допустимые типы блоков: ${BLOCK_TYPES.join(", ")}.`,
        "Первым блоком всегда делай WELCOME.",
        "Если в промте есть баллы, переходы, обязательность, шкалы или контакты, отрази их буквально.",
        "Если в промте описан скрипт разговора, сценарий продаж или дерево реплик, преобразуй его в опрос для респондента с понятными вопросами и вариантами ответа.",
        "Условия вида 'если ответил X, задай следующий вопрос Y' преобразуй в ветвления между блоками.",
        "Длинные пояснения, цель вопроса и контекст менеджера переноси в description блока, а не в заголовок.",
        "Если нужно уточнить имя, сферу деятельности, телефон, email, компанию или бюджет, добавляй отдельные блоки так, чтобы опрос оставался логичным и проходимым.",
        "Возвращай объект с полями: title, description, settings, blocks.",
        "settings: language, autoScrollEnabled, timerEnabled, timerSeconds, completionMessage, showProgressBar.",
        "Каждый блок обязан иметь: type, title, description, required, nextBlockId.",
        "Если переход обычный линейный, оставляй nextBlockId равным null и используй следующий блок по порядку.",
        "Никогда не указывай в nextBlockId title или id текущего блока и не создавай самоссылки.",
        "Для вариантов ответа используй массив options или items с элементами { label, description, score, nextBlockId }.",
        "Для CONTACT используй fields из fullName, email, phone, company.",
        "Не добавляй markdown и не оборачивай ответ в текст.",
      ].join(" "),
    },
    {
      role: "user" as const,
      content: `Создай опрос по этому промту:\n${input.prompt.trim()}`,
    },
  ];

  const tokenBudgets = [SURVEY_DRAFT_MAX_TOKENS, SURVEY_DRAFT_RETRY_MAX_TOKENS];
  let lastContent = "";

  for (const maxTokens of tokenBudgets) {
    const response = await client.chat.completions.create({
      model: config.model,
      temperature: 0.2,
      max_tokens: maxTokens,
      messages,
    });

    const content = extractMessageText(response.choices[0]?.message?.content);
    if (!content) {
      throw new Error("AI не вернул содержимое опроса.");
    }

    lastContent = content;

    if (response.choices[0]?.finish_reason === "length" && maxTokens !== tokenBudgets[tokenBudgets.length - 1]) {
      continue;
    }

    return extractJsonObject(content);
  }

  if (lastContent) {
    return extractJsonObject(lastContent);
  }

  throw new Error("AI не вернул содержимое опроса.");
}
