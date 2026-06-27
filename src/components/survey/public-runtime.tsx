"use client";

import type { CSSProperties, RefObject } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { ArrowRight, ChevronDown, ChevronUp, Clock3, Info, LoaderCircle, Mic, Paperclip, Square, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { renderRichText } from "@/components/survey/rich-text-renderer";
import { withBasePath } from "@/lib/base-path";
import { stripRichTextTokens } from "@/lib/rich-text";
import {
  canAutoScrollBlock,
  DROPDOWN_OTHER_OPTION_ID,
  getBlockAdditionalInfoItems,
  isBlockAnswered,
  isCombinedTextBelowMinimum,
  isDropdownOtherAnswerValue,
  isFinishSurveyTarget,
  normalizeCombinedAnswerValue,
  normalizeDropdownAnswerValue,
  normalizeTextAnswerValue,
} from "@/lib/survey-schema";
import { cn } from "@/lib/utils";
import type {
  AdditionalInfoItem,
  CombinedBlock,
  ContactBlock,
  DropdownBlock,
  MobileTextOverrideKey,
  RankingBlock,
  SurveyBlock,
  SurveySchema,
  TextAnswerAttachment,
  TextBlock,
} from "@/types/surveys";

type PublicRuntimeProps = {
  surveyId: string;
  publicSlug: string;
  schema: SurveySchema;
  restartRequested?: boolean;
  retakeToken?: string | null;
};

type ResponseSessionPayload = {
  error?: string;
  status?: "IN_PROGRESS" | "COMPLETED" | "PARTIAL" | "TIMED_OUT";
  lastBlockId?: string | null;
  timerDeadlineAt?: string | null;
  secondsLeft?: number | null;
  answers?: { blockId: string; rawValue: unknown; value: unknown }[];
  answer?: { nextBlockId: string | null };
  nextBlockId?: string | null;
  session?: { id: string } | null;
};

type RuntimeNavigationState = {
  currentBlockId: string | null;
  history: string[];
};

type PhoneCountry = {
  id: string;
  label: string;
  dialCode: string;
  digits: number;
  flag: string;
};

type ConfirmationAction = "finish" | "restart";
type FinishStatus = "COMPLETED" | "PARTIAL" | "TIMED_OUT";
type AnswerChangeOptions = {
  autoSubmit?: boolean;
};
type AnswerChangeHandler = (value: unknown, options?: AnswerChangeOptions) => void;

const SURVEY_RUNTIME_TYPOGRAPHY_CSS = `
.survey-runtime .survey-eyebrow-text {
  font-size: var(--survey-eyebrow-font-size-mobile);
  line-height: var(--survey-eyebrow-line-height-mobile);
}
.survey-runtime .survey-title-text {
  font-size: var(--survey-title-font-size-mobile);
  line-height: var(--survey-title-line-height-mobile);
}
.survey-runtime .survey-description-text {
  font-size: var(--survey-description-font-size-mobile);
  line-height: var(--survey-description-line-height-mobile);
}
.survey-runtime .survey-answer-text {
  font-size: var(--survey-answer-font-size-mobile);
  line-height: var(--survey-answer-line-height-mobile);
}
.survey-runtime .survey-additional-info-description-text {
  font-size: var(--survey-additional-info-description-font-size-mobile);
  line-height: var(--survey-additional-info-description-line-height-mobile);
}
@media (min-width: 640px) {
  .survey-runtime .survey-eyebrow-text {
    font-size: var(--survey-eyebrow-font-size);
    line-height: var(--survey-eyebrow-line-height);
  }
  .survey-runtime .survey-title-text {
    font-size: var(--survey-title-font-size);
    line-height: var(--survey-title-line-height);
  }
  .survey-runtime .survey-description-text {
    font-size: var(--survey-description-font-size);
    line-height: var(--survey-description-line-height);
  }
  .survey-runtime .survey-answer-text {
    font-size: var(--survey-answer-font-size);
    line-height: var(--survey-answer-line-height);
  }
  .survey-runtime .survey-additional-info-description-text {
    font-size: var(--survey-additional-info-description-font-size);
    line-height: var(--survey-additional-info-description-line-height);
  }
}
`;

function wrapTextStyle(): CSSProperties {
  return {
    overflowWrap: "anywhere",
    wordBreak: "normal",
    hyphens: "auto",
  };
}

function getMobileTextOverride(
  source: { mobileTextOverrides?: Partial<Record<MobileTextOverrideKey, string>> } | null | undefined,
  key: MobileTextOverrideKey,
) {
  const value = source?.mobileTextOverrides?.[key];

  return typeof value === "string" && value.trim() ? value : null;
}

function renderResponsiveRichText(value: string, mobileValue: string | null | undefined) {
  if (!mobileValue) {
    return renderRichText(value);
  }

  return [
    <span key="mobile" className="sm:hidden">
      {renderRichText(mobileValue)}
    </span>,
    <span key="desktop" className="hidden sm:inline">
      {renderRichText(value)}
    </span>,
  ];
}

function lineHeight(fontSize: number, ratio = 1.35) {
  return `${Math.round(fontSize * ratio)}px`;
}

function buildTypographyVariables(
  desktop: SurveySchema["settings"]["typography"],
  mobile: SurveySchema["settings"]["mobileTypography"],
): CSSProperties & Record<string, string> {
  return {
    "--survey-eyebrow-font-size": `${desktop.eyebrowFontSize}px`,
    "--survey-eyebrow-line-height": lineHeight(desktop.eyebrowFontSize, 1.25),
    "--survey-title-font-size": `${desktop.titleFontSize}px`,
    "--survey-title-line-height": lineHeight(desktop.titleFontSize, 1.22),
    "--survey-description-font-size": `${desktop.descriptionFontSize}px`,
    "--survey-description-line-height": lineHeight(desktop.descriptionFontSize, 1.45),
    "--survey-answer-font-size": `${desktop.answerFontSize}px`,
    "--survey-answer-line-height": lineHeight(desktop.answerFontSize, 1.45),
    "--survey-additional-info-description-font-size": `${desktop.additionalInfoDescriptionFontSize}px`,
    "--survey-additional-info-description-line-height": lineHeight(desktop.additionalInfoDescriptionFontSize, 1.6),
    "--survey-eyebrow-font-size-mobile": `${mobile.eyebrowFontSize}px`,
    "--survey-eyebrow-line-height-mobile": lineHeight(mobile.eyebrowFontSize, 1.25),
    "--survey-title-font-size-mobile": `${mobile.titleFontSize}px`,
    "--survey-title-line-height-mobile": lineHeight(mobile.titleFontSize, 1.18),
    "--survey-description-font-size-mobile": `${mobile.descriptionFontSize}px`,
    "--survey-description-line-height-mobile": lineHeight(mobile.descriptionFontSize, 1.35),
    "--survey-answer-font-size-mobile": `${mobile.answerFontSize}px`,
    "--survey-answer-line-height-mobile": lineHeight(mobile.answerFontSize, 1.35),
    "--survey-additional-info-description-font-size-mobile": `${mobile.additionalInfoDescriptionFontSize}px`,
    "--survey-additional-info-description-line-height-mobile": lineHeight(mobile.additionalInfoDescriptionFontSize, 1.5),
  };
}

const PHONE_COUNTRIES: PhoneCountry[] = [
  { id: "ru", label: "Россия", dialCode: "+7", digits: 10, flag: "🇷🇺" },
  { id: "kz", label: "Казахстан", dialCode: "+7", digits: 10, flag: "🇰🇿" },
  { id: "by", label: "Беларусь", dialCode: "+375", digits: 9, flag: "🇧🇾" },
  { id: "am", label: "Армения", dialCode: "+374", digits: 8, flag: "🇦🇲" },
  { id: "kg", label: "Кыргызстан", dialCode: "+996", digits: 9, flag: "🇰🇬" },
  { id: "uz", label: "Узбекистан", dialCode: "+998", digits: 9, flag: "🇺🇿" },
  { id: "ge", label: "Грузия", dialCode: "+995", digits: 9, flag: "🇬🇪" },
  { id: "ua", label: "Украина", dialCode: "+380", digits: 9, flag: "🇺🇦" },
  { id: "az", label: "Азербайджан", dialCode: "+994", digits: 9, flag: "🇦🇿" },
  { id: "md", label: "Молдова", dialCode: "+373", digits: 8, flag: "🇲🇩" },
  { id: "tj", label: "Таджикистан", dialCode: "+992", digits: 9, flag: "🇹🇯" },
  { id: "tm", label: "Туркменистан", dialCode: "+993", digits: 8, flag: "🇹🇲" },
  { id: "us", label: "США", dialCode: "+1", digits: 10, flag: "🇺🇸" },
  { id: "ca", label: "Канада", dialCode: "+1", digits: 10, flag: "🇨🇦" },
  { id: "gb", label: "Великобритания", dialCode: "+44", digits: 10, flag: "🇬🇧" },
  { id: "de", label: "Германия", dialCode: "+49", digits: 11, flag: "🇩🇪" },
  { id: "fr", label: "Франция", dialCode: "+33", digits: 9, flag: "🇫🇷" },
  { id: "it", label: "Италия", dialCode: "+39", digits: 10, flag: "🇮🇹" },
  { id: "es", label: "Испания", dialCode: "+34", digits: 9, flag: "🇪🇸" },
  { id: "pl", label: "Польша", dialCode: "+48", digits: 9, flag: "🇵🇱" },
  { id: "tr", label: "Турция", dialCode: "+90", digits: 10, flag: "🇹🇷" },
  { id: "ae", label: "ОАЭ", dialCode: "+971", digits: 9, flag: "🇦🇪" },
  { id: "il", label: "Израиль", dialCode: "+972", digits: 9, flag: "🇮🇱" },
  { id: "in", label: "Индия", dialCode: "+91", digits: 10, flag: "🇮🇳" },
  { id: "cn", label: "Китай", dialCode: "+86", digits: 11, flag: "🇨🇳" },
  { id: "jp", label: "Япония", dialCode: "+81", digits: 10, flag: "🇯🇵" },
  { id: "kr", label: "Южная Корея", dialCode: "+82", digits: 10, flag: "🇰🇷" },
  { id: "th", label: "Таиланд", dialCode: "+66", digits: 9, flag: "🇹🇭" },
  { id: "vn", label: "Вьетнам", dialCode: "+84", digits: 9, flag: "🇻🇳" },
  { id: "id", label: "Индонезия", dialCode: "+62", digits: 10, flag: "🇮🇩" },
  { id: "lv", label: "Латвия", dialCode: "+371", digits: 8, flag: "🇱🇻" },
  { id: "lt", label: "Литва", dialCode: "+370", digits: 8, flag: "🇱🇹" },
  { id: "ee", label: "Эстония", dialCode: "+372", digits: 8, flag: "🇪🇪" },
  { id: "rs", label: "Сербия", dialCode: "+381", digits: 8, flag: "🇷🇸" },
  { id: "me", label: "Черногория", dialCode: "+382", digits: 8, flag: "🇲🇪" },
];

const MOBILE_RUNTIME_TOP_OFFSET = 32;
const MOBILE_SCROLL_RETRY_DELAYS = [80, 180, 360, 700, 1100, 1800] as const;

const RECORDER_MIME_TYPES = [
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/webm;codecs=opus",
  "audio/webm",
  "video/mp4",
  "video/webm",
];

const STRUCTURED_MOBILE_TITLE_SURVEY_TITLES = [
  "фильтрация окц и мпп",
  "фильтрация окц и мвп",
  "фильтрация кандидата: ассистент руководителя / pm",
];

const STRUCTURED_MOBILE_TITLE_LINE_OVERRIDES = [
  {
    match: "Расскажите о вашем опыте в роли ассистента руководителя",
    lines: [
      "Расскажите о вашем опыте",
      "в роли ассистента",
      "руководителя,",
      "офис-менеджера,",
      "администратора,",
      "координатора,",
      "менеджера проектов или",
      "аккаунт-менеджера.",
    ],
  },
  {
    match: "Насколько вам комфортно работать по фиксированному",
    lines: [
      "Насколько вам комфортно",
      "работать по",
      "фиксированному",
      "графику и с планом",
      "по звонкам и результатам?",
      "Как это было на прошлых",
      "местах работы?",
    ],
  },
  {
    match: "Какой доход в месяц вы хотите получать у нас через 3-6 месяцев",
    lines: [
      "Какой доход в месяц вы",
      "хотите получать у нас",
      "через 3-6 месяцев при",
      "нормальной работе?",
      "Напишите примерно",
      "сумму или вилку.",
    ],
  },
  {
    match: "Расскажите о ситуации, когда по вашей вине или при вашем участии что-то пошло не так",
    lines: [
      "Расскажите о ситуации,",
      "когда по вашей вине",
      "или при вашем участии",
      "что-то пошло не так.",
    ],
  },
] as const;

const STRUCTURED_MOBILE_DESCRIPTION_LINE_OVERRIDES = [
  {
    match: "Опишите, что вы сделаете первым делом, как выстроите приоритеты",
    lines: [
      "Опишите, что вы сделаете",
      "первым делом,",
      "как выстроите приоритеты",
      "между задачами и проектами,",
      "как донесёте это до руководителя",
      "и при необходимости до клиента.",
    ],
  },
  {
    match: "Нужны конкретные цифры или хотя бы",
    lines: [
      "Нужны конкретные цифры или",
      "хотя бы реальные диапазоны:",
      "звонки в день, встречи, конверсия;",
      "выручка, выполнение плана.",
    ],
  },
  {
    match: "Назовите 2-4 сильных качества и приведите короткие примеры",
    lines: [
      "Назовите 2-4 сильных качества",
      "и приведите короткие примеры.",
      "Затем назовите 1-2 зоны роста и",
      "что вы уже делаете или планируете",
      "делать для улучшения.",
    ],
  },
] as const;

function normalizeStructuredTitleTarget(value: string) {
  return stripRichTextTokens(value)
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replaceAll("ё", "е")
    .replace(/\s+/g, " ")
    .trim();
}

function getStructuredMobileLineOverride(
  value: string,
  overrides: readonly { match: string; lines: readonly string[] }[],
) {
  const normalizedValue = normalizeStructuredTitleTarget(value);
  const override = overrides.find((item) => normalizedValue.includes(normalizeStructuredTitleTarget(item.match)));

  return override ? [...override.lines] : null;
}

function shouldUseStructuredMobileQuestionTitle(schemaTitle: string) {
  const normalizedTitle = normalizeStructuredTitleTarget(schemaTitle);

  return STRUCTURED_MOBILE_TITLE_SURVEY_TITLES.some((targetTitle) => normalizedTitle.includes(targetTitle));
}

function compactStructuredText(value: string) {
  return stripRichTextTokens(value).replace(/\s+/g, " ").trim();
}

function structuredTextParagraphs(value: string) {
  return stripRichTextTokens(value)
    .replace(/\r\n?/g, "\n")
    .split(/\n+/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function getStructuredMobileTextLineCount(textLength: number, variant: "title" | "description") {
  const maxLineLength = getStructuredMobileTextMaxLineLength(variant);
  const minimumByLength = Math.ceil(textLength / (maxLineLength * 0.82));

  if (textLength <= maxLineLength) {
    return 1;
  }

  const baseCount =
    variant === "title"
      ? textLength <= 54
        ? 2
        : textLength <= 82
          ? 3
          : textLength <= 112
            ? 4
            : textLength <= 146
              ? 5
              : 6
      : textLength <= 88
        ? 2
        : textLength <= 130
          ? 3
          : textLength <= 176
            ? 4
            : 5;

  return Math.max(baseCount, minimumByLength);
}

function getStructuredMobileTextMaxLineLength(variant: "title" | "description") {
  return variant === "title" ? 24 : 34;
}

function rebalanceDescendingMobileTextLines(lines: string[]) {
  const nextLines = lines
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = nextLines.length - 1; index > 0; index -= 1) {
    let currentWords = nextLines[index]!.split(" ");

    while (currentWords.length > 1 && nextLines[index]!.length >= nextLines[index - 1]!.length) {
      const movedWord = currentWords.shift();
      if (!movedWord) {
        break;
      }

      nextLines[index - 1] = `${nextLines[index - 1]} ${movedWord}`.trim();
      nextLines[index] = currentWords.join(" ").trim();
      currentWords = nextLines[index]!.split(" ");
    }
  }

  return nextLines.filter(Boolean);
}

function avoidTinySingleWordMobileLines(lines: string[]) {
  const nextLines = lines
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = nextLines.length - 1; index > 0; index -= 1) {
    const currentWords = nextLines[index]!.split(" ").filter(Boolean);
    if (currentWords.length !== 1 || currentWords[0]!.length > 5) {
      continue;
    }

    const previousWords = nextLines[index - 1]!.split(" ").filter(Boolean);
    if (previousWords.length <= 1) {
      nextLines[index - 1] = `${nextLines[index - 1]} ${nextLines[index]}`.trim();
      nextLines.splice(index, 1);
      continue;
    }

    const movedWord = previousWords.pop();
    if (!movedWord) {
      continue;
    }

    nextLines[index - 1] = previousWords.join(" ");
    nextLines[index] = `${movedWord} ${nextLines[index]}`.trim();
  }

  return nextLines.filter(Boolean);
}

function buildDescendingMobileTextLines(value: string, variant: "title" | "description" = "title") {
  if (variant === "description") {
    return buildDescendingMobileDescriptionLines(value);
  }

  if (variant === "title") {
    return buildSemanticMobileTitleLines(value);
  }

  const text = compactStructuredText(value);
  if (!text) {
    return [];
  }

  const words = text.split(" ");
  const lineCount = Math.min(words.length, getStructuredMobileTextLineCount(text.length, variant));
  if (lineCount <= 1) {
    return [text];
  }

  const maxLineLength = getStructuredMobileTextMaxLineLength(variant);
  const weightStep = variant === "title" ? 0.12 : 0.1;
  const weights = Array.from({ length: lineCount }, (_, index) => Math.max(0.34, 1 - index * weightStep));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const targetLengths = weights.map((weight) =>
    Math.min(maxLineLength, Math.max(variant === "title" ? 12 : 16, Math.round((text.length * weight) / totalWeight))),
  );
  const lines: string[] = [];
  let wordIndex = 0;

  for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
    const remainingLines = lineCount - lineIndex;
    const targetLength = targetLengths[lineIndex] ?? targetLengths.at(-1) ?? text.length;
    const lineWords: string[] = [];

    while (wordIndex < words.length && words.length - wordIndex > remainingLines - 1) {
      const nextWord = words[wordIndex]!;
      const candidate = [...lineWords, nextWord].join(" ");

      if (lineWords.length > 0 && (candidate.length > targetLength || candidate.length > maxLineLength)) {
        break;
      }

      lineWords.push(nextWord);
      wordIndex += 1;
    }

    lines.push(lineWords.join(" "));
  }

  if (wordIndex < words.length) {
    lines[lines.length - 1] = `${lines.at(-1) ?? ""} ${words.slice(wordIndex).join(" ")}`.trim();
  }

  return avoidTinySingleWordMobileLines(rebalanceDescendingMobileTextLines(lines))
    .flatMap((line) => splitMobileLineByMaxLength(line, maxLineLength));
}

function buildSemanticMobileTitleLines(value: string) {
  const text = compactStructuredText(value);
  if (!text) {
    return [];
  }

  const overrideLines = getStructuredMobileLineOverride(text, STRUCTURED_MOBILE_TITLE_LINE_OVERRIDES);
  if (overrideLines) {
    return overrideLines;
  }

  const maxLineLength = getStructuredMobileTextMaxLineLength("title");
  const preferredLineLength = 24;
  const colonIndex = text.indexOf(":");

  if (colonIndex > 0) {
    const beforeColon = text.slice(0, colonIndex + 1).trim();
    const afterColon = text.slice(colonIndex + 1).trim();

    return normalizeMobileTitleLines([
      ...splitMobileLineByMaxLength(beforeColon, maxLineLength, preferredLineLength),
      ...splitMobileTitleDetails(afterColon, maxLineLength, preferredLineLength),
    ]);
  }

  return normalizeMobileTitleLines(splitMobileTitleDetails(text, maxLineLength, preferredLineLength));
}

function splitMobileTitleDetails(text: string, maxLineLength: number, preferredLineLength: number) {
  const prepared = text
    .replace(/,\s*что\s+/giu, "? что ")
    .replace(/,\s*какой\s+/giu, "? какой ")
    .replace(/,\s*какие\s+/giu, "? какие ")
    .replace(/,\s*кому,\s*были\s+ли\s+/giu, " кому? были ли ")
    .replace(/,\s*были\s+ли\s+/giu, "? были ли ")
    .replace(/,\s*где\s+/giu, "? где ")
    .replace(/,\s*когда\s+/giu, "? когда ")
    .replace(/,\s*почему\s+/giu, "? почему ")
    .replace(/,\s*как\s+/giu, "? как ")
    .replace(/\s+/g, " ")
    .trim();

  return splitMobileLineByMaxLength(prepared, maxLineLength, preferredLineLength);
}

function normalizeMobileTitleLines(lines: string[]) {
  return avoidDanglingMobileLineEndWords(
    avoidTinySingleWordMobileLines(lines)
      .map((line) => line.trim())
      .filter(Boolean),
  );
}

function avoidDanglingMobileLineEndWords(lines: string[]) {
  const danglingWords = new Set(["в", "во", "на", "с", "со", "к", "ко", "о", "об", "от", "до", "по", "и", "или", "а"]);
  const nextLines = [...lines];

  for (let index = 0; index < nextLines.length - 1; index += 1) {
    const words = nextLines[index]!.split(" ").filter(Boolean);
    const lastWord = words.at(-1)?.toLocaleLowerCase("ru-RU").replace(/[.,:;!?]+$/g, "");

    if (!lastWord || !danglingWords.has(lastWord) || words.length <= 1) {
      continue;
    }

    const movedWord = words.pop();
    if (!movedWord) {
      continue;
    }

    nextLines[index] = words.join(" ");
    nextLines[index + 1] = `${movedWord} ${nextLines[index + 1]}`.trim();
  }

  return nextLines.filter(Boolean);
}

function buildDescendingMobileDescriptionLines(value: string) {
  const text = compactStructuredText(value);
  const overrideLines = getStructuredMobileLineOverride(text, STRUCTURED_MOBILE_DESCRIPTION_LINE_OVERRIDES);
  if (overrideLines) {
    return overrideLines;
  }

  const maxLineLength = getStructuredMobileTextMaxLineLength("description");
  const preferredLineLength = 31;
  const lines = structuredTextParagraphs(value).flatMap((paragraph) =>
    splitDescriptionParagraphIntoClauses(paragraph).flatMap((clause) =>
      splitMobileLineByMaxLength(clause, maxLineLength, preferredLineLength),
    ),
  );

  return avoidTinySingleWordMobileLines(lines)
    .flatMap((line) => splitMobileLineByMaxLength(line, maxLineLength, preferredLineLength));
}

function splitDescriptionParagraphIntoClauses(paragraph: string) {
  const clauses: string[] = [];
  const sentenceBoundary = /[^.!?:]+[.!?:]+|[^.!?:]+$/g;
  const matches = paragraph.match(sentenceBoundary) ?? [paragraph];

  for (const match of matches) {
    const clause = match.trim();
    if (clause) {
      clauses.push(clause);
    }
  }

  return clauses;
}

function splitMobileLineByMaxLength(line: string, maxLineLength: number, preferredLineLength = maxLineLength) {
  const words = line.split(" ").filter(Boolean);
  if (line.length <= maxLineLength || words.length <= 1) {
    return [line];
  }

  const lines: string[] = [];
  let current = "";

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    const candidate = current ? `${current} ${word}` : word;
    const hasMoreWords = index < words.length - 1;

    if (current && (candidate.length > maxLineLength || (candidate.length > preferredLineLength && hasMoreWords))) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }

  if (current) {
    lines.push(current);
  }

  return avoidTinySingleWordMobileLines(lines);
}

function formatTextAnswerPlaceholder(value: string) {
  const text = compactStructuredText(value);
  if (!text) {
    return "";
  }

  const colonIndex = text.indexOf(":");
  if (colonIndex > 0 && colonIndex <= 28) {
    const head = text.slice(0, colonIndex + 1).trim();
    const tail = text.slice(colonIndex + 1).trim();
    if (tail) {
      const ifPhraseIndex = tail.toLocaleLowerCase("ru-RU").indexOf(" если ");
      if (ifPhraseIndex > 0) {
        const beforeIf = tail.slice(0, ifPhraseIndex).trim();
        const ifPhrase = tail.slice(ifPhraseIndex + 1).trim();

        return [
          head,
          ...splitMobileLineByMaxLength(beforeIf, 32, 29),
          ...splitMobileLineByMaxLength(ifPhrase, 32, 29),
        ].join("\n");
      }

      return [head, ...splitMobileLineByMaxLength(tail, 32, 29)].join("\n");
    }

    return head;
  }

  return splitMobileLineByMaxLength(text, 34, 31).join("\n");
}

function formatCountdown(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function hasDraftValue(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (typeof value === "boolean") {
    return true;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((entry) => hasDraftValue(entry));
  }

  return false;
}

function textAnswerLength(value: unknown) {
  return normalizeTextAnswerValue(value).text.trim().length;
}

function textAnswerHasFileAttachment(value: unknown) {
  return normalizeTextAnswerValue(value).attachments.some((attachment) => attachment.kind === "file");
}

function textAnswerHasVoiceAttachment(value: unknown) {
  return normalizeTextAnswerValue(value).attachments.some((attachment) => attachment.kind === "voice");
}

function textAnswerBelowMinimum(block: TextBlock, value: unknown) {
  if (textAnswerHasFileAttachment(value)) {
    return false;
  }

  const length = textAnswerLength(value);

  return block.minLength > 0 && (length > 0 || textAnswerHasVoiceAttachment(value)) && length < block.minLength;
}

function attachmentUrl(url: string) {
  return url.startsWith("/api/") ? withBasePath(url) : url;
}

function canSubmitBlock(block: SurveyBlock, value: unknown) {
  if (block.type === "WELCOME") {
    return true;
  }

  if (block.type === "TEXT") {
    if (textAnswerBelowMinimum(block, value)) {
      return false;
    }
  }

  if (block.type === "COMBINED" && isCombinedTextBelowMinimum(block, value)) {
    return false;
  }

  if (!block.required) {
    return true;
  }

  return isBlockAnswered(block, value);
}

function shouldHideInlineError(message: string) {
  return message.startsWith("Минимальная длина ответа:");
}

function phoneCountryDisplayName(country: PhoneCountry) {
  return `${country.label} ${country.dialCode}`;
}

function findPhoneCountry(value: unknown) {
  if (typeof value !== "string") {
    return PHONE_COUNTRIES[0]!;
  }

  return (
    PHONE_COUNTRIES.find((country) => value === country.id || value === phoneCountryDisplayName(country)) ??
    PHONE_COUNTRIES[0]!
  );
}

function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

function trimDialCodePrefix(digits: string, country: PhoneCountry) {
  const dialDigits = digitsOnly(country.dialCode);

  if (country.id === "ru" || country.id === "kz") {
    return digits.replace(/^[78]/, "").slice(0, country.digits);
  }

  return digits.startsWith(dialDigits)
    ? digits.slice(dialDigits.length, dialDigits.length + country.digits)
    : digits.slice(0, country.digits);
}

function formatNationalPhone(digits: string, country: PhoneCountry) {
  const chunks =
    country.digits === 11
      ? [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 8), digits.slice(8, 11)]
      : country.digits === 10
        ? [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 8), digits.slice(8, 10)]
        : country.digits === 9
          ? [digits.slice(0, 2), digits.slice(2, 5), digits.slice(5, 7), digits.slice(7, 9)]
          : country.digits === 8
            ? [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 6), digits.slice(6, 8)]
            : [digits.slice(0, 3), digits.slice(3, 5), digits.slice(5, 7)];

  return chunks.filter(Boolean).join(" ");
}

function formatPhoneInput(value: string, country: PhoneCountry) {
  const nationalDigits = trimDialCodePrefix(digitsOnly(value), country);

  return formatNationalPhone(nationalDigits, country);
}

function phoneMask(country: PhoneCountry) {
  return formatNationalPhone("0".repeat(country.digits), country);
}

function normalizedRecorderMimeType(value: string | undefined) {
  return value?.toLowerCase().split(";")[0]?.trim() || "audio/webm";
}

function recorderExtensionForMimeType(mimeType: string) {
  const extensionByMimeType: Record<string, string> = {
    "audio/mp4": ".m4a",
    "audio/m4a": ".m4a",
    "audio/x-m4a": ".m4a",
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/ogg": ".ogg",
    "audio/wav": ".wav",
    "audio/webm": ".webm",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
  };

  return extensionByMimeType[mimeType] ?? ".webm";
}

function appendTranscript(currentText: string, transcript: string) {
  const normalizedTranscript = transcript.trim();

  if (!normalizedTranscript) {
    return currentText;
  }

  const normalizedCurrentText = currentText.trimEnd();

  return normalizedCurrentText ? `${normalizedCurrentText}\n${normalizedTranscript}` : normalizedTranscript;
}

function CountryFlag({ country }: { country: PhoneCountry }) {
  const commonProps = {
    width: 28,
    height: 20,
    viewBox: "0 0 28 20",
    role: "img",
    "aria-label": country.label,
    className: "block overflow-hidden rounded-[5px] shadow-[inset_0_0_0_1px_rgba(15,23,42,0.12)]",
  } as const;

  switch (country.id) {
    case "ru":
      return (
        <svg {...commonProps}>
          <rect width="28" height="20" fill="#fff" />
          <rect y="6.67" width="28" height="6.66" fill="#1d4ed8" />
          <rect y="13.33" width="28" height="6.67" fill="#dc2626" />
        </svg>
      );
    case "kz":
      return (
        <svg {...commonProps}>
          <rect width="28" height="20" fill="#38bdf8" />
          <circle cx="14" cy="10" r="4" fill="#facc15" />
        </svg>
      );
    case "by":
      return (
        <svg {...commonProps}>
          <rect width="28" height="20" fill="#dc2626" />
          <rect y="13" width="28" height="7" fill="#16a34a" />
          <rect width="5" height="20" fill="#fff" />
        </svg>
      );
    case "am":
      return (
        <svg {...commonProps}>
          <rect width="28" height="20" fill="#dc2626" />
          <rect y="6.67" width="28" height="6.66" fill="#2563eb" />
          <rect y="13.33" width="28" height="6.67" fill="#f97316" />
        </svg>
      );
    case "kg":
      return (
        <svg {...commonProps}>
          <rect width="28" height="20" fill="#dc2626" />
          <circle cx="14" cy="10" r="4.2" fill="#facc15" />
        </svg>
      );
    case "uz":
      return (
        <svg {...commonProps}>
          <rect width="28" height="20" fill="#38bdf8" />
          <rect y="7" width="28" height="6" fill="#fff" />
          <rect y="13" width="28" height="7" fill="#16a34a" />
          <rect y="6.4" width="28" height="0.8" fill="#dc2626" />
          <rect y="12.8" width="28" height="0.8" fill="#dc2626" />
        </svg>
      );
    case "ge":
      return (
        <svg {...commonProps}>
          <rect width="28" height="20" fill="#fff" />
          <rect x="12" width="4" height="20" fill="#dc2626" />
          <rect y="8" width="28" height="4" fill="#dc2626" />
        </svg>
      );
    case "ua":
      return (
        <svg {...commonProps}>
          <rect width="28" height="10" fill="#2563eb" />
          <rect y="10" width="28" height="10" fill="#facc15" />
        </svg>
      );
    case "az":
      return (
        <svg {...commonProps}>
          <rect width="28" height="6.67" fill="#00a3dd" />
          <rect y="6.67" width="28" height="6.66" fill="#ef3340" />
          <rect y="13.33" width="28" height="6.67" fill="#509e2f" />
          <circle cx="13" cy="10" r="2.6" fill="#fff" />
          <circle cx="14.1" cy="10" r="2.2" fill="#ef3340" />
          <polygon points="18,8.1 18.4,9.3 19.7,9.3 18.7,10.1 19.1,11.4 18,10.6 16.9,11.4 17.3,10.1 16.3,9.3 17.6,9.3" fill="#fff" />
        </svg>
      );
    case "md":
      return (
        <svg {...commonProps}>
          <rect width="9.33" height="20" fill="#0046ae" />
          <rect x="9.33" width="9.34" height="20" fill="#ffd200" />
          <rect x="18.67" width="9.33" height="20" fill="#cc092f" />
          <circle cx="14" cy="10" r="2.1" fill="#9a5b16" />
        </svg>
      );
    case "tj":
      return (
        <svg {...commonProps}>
          <rect width="28" height="6" fill="#c8102e" />
          <rect y="6" width="28" height="8" fill="#fff" />
          <rect y="14" width="28" height="6" fill="#006747" />
          <circle cx="14" cy="10" r="1.6" fill="#f4c430" />
        </svg>
      );
    case "tm":
      return (
        <svg {...commonProps}>
          <rect width="28" height="20" fill="#00843d" />
          <rect x="4" width="4" height="20" fill="#a51e36" />
          <circle cx="16" cy="8" r="3.1" fill="#fff" />
          <circle cx="17.1" cy="8" r="2.6" fill="#00843d" />
          <polygon points="20.5,6.6 20.8,7.5 21.8,7.5 21,8.1 21.3,9 20.5,8.5 19.7,9 20,8.1 19.2,7.5 20.2,7.5" fill="#fff" />
        </svg>
      );
    case "us":
      return (
        <svg {...commonProps}>
          {Array.from({ length: 7 }).map((_, index) => (
            <rect key={index} y={index * 2.86} width="28" height="1.43" fill="#b22234" />
          ))}
          <rect width="12.2" height="10.8" fill="#3c3b6e" />
          <circle cx="3" cy="3" r="0.6" fill="#fff" />
          <circle cx="6" cy="5" r="0.6" fill="#fff" />
          <circle cx="9" cy="3" r="0.6" fill="#fff" />
          <circle cx="3" cy="8" r="0.6" fill="#fff" />
          <circle cx="9" cy="8" r="0.6" fill="#fff" />
        </svg>
      );
    case "ca":
      return (
        <svg {...commonProps}>
          <rect width="7" height="20" fill="#d80621" />
          <rect x="7" width="14" height="20" fill="#fff" />
          <rect x="21" width="7" height="20" fill="#d80621" />
          <polygon points="14,4 15.2,8 18,7 16,10 18.5,12 15.2,12 14,16 12.8,12 9.5,12 12,10 10,7 12.8,8" fill="#d80621" />
        </svg>
      );
    case "gb":
      return (
        <svg {...commonProps}>
          <rect width="28" height="20" fill="#012169" />
          <path d="M0 0 28 20M28 0 0 20" stroke="#fff" strokeWidth="4" />
          <path d="M0 0 28 20M28 0 0 20" stroke="#c8102e" strokeWidth="2" />
          <rect x="11" width="6" height="20" fill="#fff" />
          <rect y="7" width="28" height="6" fill="#fff" />
          <rect x="12.2" width="3.6" height="20" fill="#c8102e" />
          <rect y="8.2" width="28" height="3.6" fill="#c8102e" />
        </svg>
      );
    case "de":
      return (
        <svg {...commonProps}>
          <rect width="28" height="6.67" fill="#000" />
          <rect y="6.67" width="28" height="6.66" fill="#dd0000" />
          <rect y="13.33" width="28" height="6.67" fill="#ffce00" />
        </svg>
      );
    case "fr":
      return (
        <svg {...commonProps}>
          <rect width="9.33" height="20" fill="#0055a4" />
          <rect x="9.33" width="9.34" height="20" fill="#fff" />
          <rect x="18.67" width="9.33" height="20" fill="#ef4135" />
        </svg>
      );
    case "it":
      return (
        <svg {...commonProps}>
          <rect width="9.33" height="20" fill="#009246" />
          <rect x="9.33" width="9.34" height="20" fill="#fff" />
          <rect x="18.67" width="9.33" height="20" fill="#ce2b37" />
        </svg>
      );
    case "es":
      return (
        <svg {...commonProps}>
          <rect width="28" height="5" fill="#aa151b" />
          <rect y="5" width="28" height="10" fill="#f1bf00" />
          <rect y="15" width="28" height="5" fill="#aa151b" />
        </svg>
      );
    case "pl":
      return (
        <svg {...commonProps}>
          <rect width="28" height="10" fill="#fff" />
          <rect y="10" width="28" height="10" fill="#dc143c" />
        </svg>
      );
    case "tr":
      return (
        <svg {...commonProps}>
          <rect width="28" height="20" fill="#e30a17" />
          <circle cx="12" cy="10" r="4" fill="#fff" />
          <circle cx="13.3" cy="10" r="3.2" fill="#e30a17" />
          <polygon points="18,7.7 18.5,9.2 20.1,9.2 18.8,10.1 19.3,11.6 18,10.7 16.7,11.6 17.2,10.1 15.9,9.2 17.5,9.2" fill="#fff" />
        </svg>
      );
    case "ae":
      return (
        <svg {...commonProps}>
          <rect width="7" height="20" fill="#ff0000" />
          <rect x="7" width="21" height="6.67" fill="#009a44" />
          <rect x="7" y="6.67" width="21" height="6.66" fill="#fff" />
          <rect x="7" y="13.33" width="21" height="6.67" fill="#000" />
        </svg>
      );
    case "il":
      return (
        <svg {...commonProps}>
          <rect width="28" height="20" fill="#fff" />
          <rect y="3" width="28" height="2.2" fill="#0038b8" />
          <rect y="14.8" width="28" height="2.2" fill="#0038b8" />
          <polygon points="14,6.5 17,12 11,12" fill="none" stroke="#0038b8" strokeWidth="1" />
          <polygon points="14,13.5 17,8 11,8" fill="none" stroke="#0038b8" strokeWidth="1" />
        </svg>
      );
    case "in":
      return (
        <svg {...commonProps}>
          <rect width="28" height="6.67" fill="#ff9933" />
          <rect y="6.67" width="28" height="6.66" fill="#fff" />
          <rect y="13.33" width="28" height="6.67" fill="#138808" />
          <circle cx="14" cy="10" r="2" fill="none" stroke="#000080" strokeWidth="1" />
        </svg>
      );
    case "cn":
      return (
        <svg {...commonProps}>
          <rect width="28" height="20" fill="#de2910" />
          <polygon points="6,3 6.7,5.1 8.9,5.1 7.1,6.4 7.8,8.5 6,7.2 4.2,8.5 4.9,6.4 3.1,5.1 5.3,5.1" fill="#ffde00" />
          <circle cx="12" cy="4" r="0.9" fill="#ffde00" />
          <circle cx="15" cy="7" r="0.9" fill="#ffde00" />
          <circle cx="15" cy="11" r="0.9" fill="#ffde00" />
        </svg>
      );
    case "jp":
      return (
        <svg {...commonProps}>
          <rect width="28" height="20" fill="#fff" />
          <circle cx="14" cy="10" r="5" fill="#bc002d" />
        </svg>
      );
    case "kr":
      return (
        <svg {...commonProps}>
          <rect width="28" height="20" fill="#fff" />
          <path d="M14 6a4 4 0 0 1 0 8 2 2 0 0 1 0-4 2 2 0 0 0 0-4Z" fill="#cd2e3a" />
          <path d="M14 14a4 4 0 0 1 0-8 2 2 0 0 1 0 4 2 2 0 0 0 0 4Z" fill="#0047a0" />
          <rect x="5" y="4" width="5" height="1" fill="#000" transform="rotate(-32 5 4)" />
          <rect x="18" y="15" width="5" height="1" fill="#000" transform="rotate(-32 18 15)" />
        </svg>
      );
    case "th":
      return (
        <svg {...commonProps}>
          <rect width="28" height="20" fill="#a51931" />
          <rect y="3" width="28" height="3" fill="#fff" />
          <rect y="6" width="28" height="8" fill="#2d2a4a" />
          <rect y="14" width="28" height="3" fill="#fff" />
        </svg>
      );
    case "vn":
      return (
        <svg {...commonProps}>
          <rect width="28" height="20" fill="#da251d" />
          <polygon points="14,4.5 15.4,8.4 19.5,8.4 16.2,10.8 17.4,14.8 14,12.4 10.6,14.8 11.8,10.8 8.5,8.4 12.6,8.4" fill="#ff0" />
        </svg>
      );
    case "id":
      return (
        <svg {...commonProps}>
          <rect width="28" height="10" fill="#ce1126" />
          <rect y="10" width="28" height="10" fill="#fff" />
        </svg>
      );
    case "lv":
      return (
        <svg {...commonProps}>
          <rect width="28" height="20" fill="#9e3039" />
          <rect y="8" width="28" height="4" fill="#fff" />
        </svg>
      );
    case "lt":
      return (
        <svg {...commonProps}>
          <rect width="28" height="6.67" fill="#fdb913" />
          <rect y="6.67" width="28" height="6.66" fill="#006a44" />
          <rect y="13.33" width="28" height="6.67" fill="#c1272d" />
        </svg>
      );
    case "ee":
      return (
        <svg {...commonProps}>
          <rect width="28" height="6.67" fill="#4891d9" />
          <rect y="6.67" width="28" height="6.66" fill="#000" />
          <rect y="13.33" width="28" height="6.67" fill="#fff" />
        </svg>
      );
    case "rs":
      return (
        <svg {...commonProps}>
          <rect width="28" height="6.67" fill="#c6363c" />
          <rect y="6.67" width="28" height="6.66" fill="#0c4076" />
          <rect y="13.33" width="28" height="6.67" fill="#fff" />
          <circle cx="9" cy="10" r="2.2" fill="#f4c430" />
        </svg>
      );
    case "me":
      return (
        <svg {...commonProps}>
          <rect width="28" height="20" fill="#d01c1f" />
          <rect x="1.5" y="1.5" width="25" height="17" fill="none" stroke="#f9d616" strokeWidth="2" />
          <circle cx="14" cy="10" r="2.2" fill="#f9d616" />
        </svg>
      );
    default:
      return (
        <span
          role="img"
          aria-label={country.label}
          className="flex h-5 w-7 items-center justify-center rounded-[5px] bg-slate-100 text-[10px] font-bold uppercase text-slate-600 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.12)]"
        >
          {country.id}
        </span>
      );
  }
}

export function PublicRuntime({ surveyId, publicSlug, schema, restartRequested = false, retakeToken = null }: PublicRuntimeProps) {
  const router = useRouter();
  const navigationStorageKey = `survey-runtime:${surveyId}:${publicSlug}:navigation`;
  const [booting, setBooting] = useState(true);
  const [sessionReady, setSessionReady] = useState(false);
  const [currentBlockId, setCurrentBlockId] = useState(schema.blocks[0]?.id ?? null);
  const [blockHistory, setBlockHistory] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [error, setError] = useState("");
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [timerDeadlineAtMs, setTimerDeadlineAtMs] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();
  const answersRef = useRef<Record<string, unknown>>({});
  const blockHistoryRef = useRef<string[]>([]);
  const restartConsumedRef = useRef(false);
  const retakeConsumedRef = useRef(false);
  const timeoutSubmittedRef = useRef(false);
  const runtimeRef = useRef<HTMLDivElement | null>(null);
  const currentBlockSectionRef = useRef<HTMLDivElement | null>(null);
  const additionalInfoRef = useRef<HTMLDivElement | null>(null);
  const shouldScrollAfterBlockChangeRef = useRef(false);
  const pendingMobileScrollTimeoutsRef = useRef<number[]>([]);
  const finishRef = useRef<(status: FinishStatus, options?: { allowPartialAnswers?: boolean }) => Promise<void>>(
    async () => undefined,
  );
  const [openAdditionalInfoId, setOpenAdditionalInfoId] = useState<string | null>(null);
  const [confirmationAction, setConfirmationAction] = useState<ConfirmationAction | null>(null);

  const currentIndex = schema.blocks.findIndex((block) => block.id === currentBlockId);
  const currentBlock = schema.blocks[currentIndex] ?? null;
  const canGoBack = blockHistory.length > 0;
  const currentAdditionalInfoItems =
    currentBlock
      ? getBlockAdditionalInfoItems(schema, currentBlock)
      : [];
  const typography = schema.settings.typography;
  const mobileTypography = schema.settings.mobileTypography;
  const typographyVariables = buildTypographyVariables(typography, mobileTypography);
  const runtimeStyle = {
    ...typographyVariables,
    "--survey-mobile-browser-top-inset": "0px",
    overflowAnchor: "none",
    paddingTop: "var(--survey-mobile-browser-top-inset)",
  } as CSSProperties & Record<string, string>;
  const textWrapStyle = wrapTextStyle();
  const answerTextStyle = textWrapStyle;
  const useStructuredMobileQuestionText = shouldUseStructuredMobileQuestionTitle(schema.title);

  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  useEffect(() => {
    blockHistoryRef.current = blockHistory;
  }, [blockHistory]);

  useEffect(() => {
    setOpenAdditionalInfoId(null);
  }, [currentBlockId]);

  useLayoutEffect(() => {
    if (!shouldScrollAfterBlockChangeRef.current) {
      return;
    }

    shouldScrollAfterBlockChangeRef.current = false;
    scrollToRuntimeTop();
    // scrollToRuntimeTop reads live refs and viewport state only when the block id changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBlockId]);

  useEffect(() => {
    if (!openAdditionalInfoId) {
      return;
    }

    const handleDocumentClick = (event: MouseEvent) => {
      if (additionalInfoRef.current?.contains(event.target as Node)) {
        return;
      }

      setOpenAdditionalInfoId(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenAdditionalInfoId(null);
      }
    };

    document.addEventListener("click", handleDocumentClick);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("click", handleDocumentClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openAdditionalInfoId]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const cancelOnTextInputInteraction = (event: Event) => {
      if (typeof window === "undefined" || window.innerWidth >= 640 || !(event.target instanceof HTMLElement)) {
        return;
      }

      const editableTarget = event.target.closest(
        'textarea,input,[role="textbox"],[contenteditable="true"],[contenteditable="plaintext-only"]',
      );

      if (editableTarget) {
        cancelPendingMobileScrollAdjustments();
      }
    };

    document.addEventListener("focusin", cancelOnTextInputInteraction, true);
    document.addEventListener("pointerdown", cancelOnTextInputInteraction, true);

    return () => {
      document.removeEventListener("focusin", cancelOnTextInputInteraction, true);
      document.removeEventListener("pointerdown", cancelOnTextInputInteraction, true);
      cancelPendingMobileScrollAdjustments();
    };
  }, []);

  function doneUrl(status: NonNullable<ResponseSessionPayload["status"]>) {
    return withBasePath(`/s/${publicSlug}/done?status=${status.toLowerCase()}`);
  }

  function isKnownBlockId(blockId: string | null | undefined) {
    return Boolean(blockId && schema.blocks.some((block) => block.id === blockId));
  }

  function normalizeNavigationHistory(history: unknown) {
    if (!Array.isArray(history)) {
      return [];
    }

    return history.filter((blockId): blockId is string => typeof blockId === "string" && isKnownBlockId(blockId));
  }

  function readStoredNavigationState(expectedCurrentBlockId: string | null): RuntimeNavigationState | null {
    if (typeof window === "undefined" || !expectedCurrentBlockId) {
      return null;
    }

    try {
      const raw = window.sessionStorage.getItem(navigationStorageKey);
      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(raw) as Partial<RuntimeNavigationState>;
      if (parsed.currentBlockId !== expectedCurrentBlockId || !isKnownBlockId(parsed.currentBlockId)) {
        return null;
      }

      return {
        currentBlockId: parsed.currentBlockId,
        history: normalizeNavigationHistory(parsed.history),
      };
    } catch {
      return null;
    }
  }

  function persistNavigationState(nextCurrentBlockId: string | null, nextHistory: string[]) {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.sessionStorage.setItem(
        navigationStorageKey,
        JSON.stringify({
          currentBlockId: nextCurrentBlockId,
          history: nextHistory,
        } satisfies RuntimeNavigationState),
      );
    } catch {
      // Ignore sessionStorage errors in restricted browser modes.
    }
  }

  function clearNavigationState() {
    blockHistoryRef.current = [];
    setBlockHistory([]);

    if (typeof window === "undefined") {
      return;
    }

    try {
      window.sessionStorage.removeItem(navigationStorageKey);
    } catch {
      // Ignore sessionStorage errors in restricted browser modes.
    }
  }

  function blurActiveElementOnMobile() {
    if (typeof window === "undefined") {
      return false;
    }

    if (window.innerWidth >= 640 || !(document.activeElement instanceof HTMLElement)) {
      return false;
    }

    if (document.activeElement === document.body) {
      return false;
    }

    document.activeElement.blur();
    return true;
  }

  async function settleMobileInputBeforeTransition() {
    if (typeof window === "undefined" || window.innerWidth >= 640) {
      return;
    }

    const blurred = blurActiveElementOnMobile();
    if (!blurred) {
      return;
    }

    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => resolve());
      });
    });

    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 180);
    });
  }

  function cancelPendingMobileScrollAdjustments() {
    if (typeof window === "undefined") {
      return;
    }

    pendingMobileScrollTimeoutsRef.current.forEach((timeoutId) => {
      window.clearTimeout(timeoutId);
    });
    pendingMobileScrollTimeoutsRef.current = [];
  }

  function isEditableElementFocused() {
    if (typeof document === "undefined" || !(document.activeElement instanceof HTMLElement)) {
      return false;
    }

    return Boolean(
      document.activeElement.closest('textarea,input,[role="textbox"],[contenteditable="true"],[contenteditable="plaintext-only"]'),
    );
  }

  function resetMobileBrowserTopInset() {
    runtimeRef.current?.style.setProperty("--survey-mobile-browser-top-inset", "0px");
  }

  function scrollToRuntimeTop(behavior: ScrollBehavior = "smooth") {
    if (typeof window === "undefined") {
      return;
    }

    if (window.innerWidth < 640) {
      cancelPendingMobileScrollAdjustments();
    }

    const scroll = () => {
      const isMobile = window.innerWidth < 640;
      if (isMobile && isEditableElementFocused()) {
        cancelPendingMobileScrollAdjustments();
        return;
      }

      if (isMobile) {
        resetMobileBrowserTopInset();
      }

      const target = isMobile
        ? runtimeRef.current ?? currentBlockSectionRef.current
        : currentBlockSectionRef.current ?? runtimeRef.current;
      const targetTop = target ? target.getBoundingClientRect().top + window.scrollY : 0;
      const top = isMobile ? targetTop - MOBILE_RUNTIME_TOP_OFFSET : targetTop;
      const nextBehavior = isMobile ? "auto" : behavior;

      window.scrollTo({
        top: Math.max(0, top),
        behavior: nextBehavior,
      });

      if (isMobile && document.scrollingElement) {
        document.scrollingElement.scrollTop = Math.max(0, top);
      }

      if (isMobile) {
        document.documentElement.scrollTop = Math.max(0, top);
        document.body.scrollTop = Math.max(0, top);
      }
    };

    blurActiveElementOnMobile();

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        scroll();

        if (window.innerWidth >= 640) {
          return;
        }

        MOBILE_SCROLL_RETRY_DELAYS.forEach((delay) => {
          const timeoutId = window.setTimeout(scroll, delay);
          pendingMobileScrollTimeoutsRef.current.push(timeoutId);
        });
      });
    });
  }

  function navigateToBlock(nextBlockId: string, options?: { pushFromBlockId?: string | null; scroll?: boolean }) {
    if (!isKnownBlockId(nextBlockId)) {
      return;
    }

    const fromBlockId = options?.pushFromBlockId;
    const nextHistory =
      fromBlockId && isKnownBlockId(fromBlockId)
        ? [...blockHistoryRef.current, fromBlockId]
        : blockHistoryRef.current;

    resetMobileBrowserTopInset();

    blockHistoryRef.current = nextHistory;
    setBlockHistory(nextHistory);
    setCurrentBlockId(nextBlockId);
    persistNavigationState(nextBlockId, nextHistory);

    if (options?.scroll ?? true) {
      shouldScrollAfterBlockChangeRef.current = true;
    }
  }

  function goBackToPreviousBlock() {
    const previousBlockId = blockHistoryRef.current.at(-1);
    if (!previousBlockId || !isKnownBlockId(previousBlockId)) {
      return;
    }

    const nextHistory = blockHistoryRef.current.slice(0, -1);
    blockHistoryRef.current = nextHistory;
    setBlockHistory(nextHistory);
    setCurrentBlockId(previousBlockId);
    persistNavigationState(previousBlockId, nextHistory);
    resetMobileBrowserTopInset();
    shouldScrollAfterBlockChangeRef.current = true;
  }

  function applySessionPayload(payload: ResponseSessionPayload) {
    if (payload.status && payload.status !== "IN_PROGRESS") {
      router.replace(doneUrl(payload.status));
      return true;
    }

    if ("timerDeadlineAt" in payload || "secondsLeft" in payload) {
      const deadlineMs = payload.timerDeadlineAt ? new Date(payload.timerDeadlineAt).getTime() : null;

      if (deadlineMs && Number.isFinite(deadlineMs)) {
        const nextSecondsLeft =
          typeof payload.secondsLeft === "number"
            ? Math.max(0, payload.secondsLeft)
            : Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000));

        setTimerDeadlineAtMs(deadlineMs);
        setSecondsLeft(nextSecondsLeft);
        timeoutSubmittedRef.current = false;
      } else {
        setTimerDeadlineAtMs(null);
        setSecondsLeft(null);
      }
    }

    return false;
  }

  async function ensureResponseSession(restoreState: boolean) {
    const shouldUseRetake = Boolean(retakeToken?.trim()) && !retakeConsumedRef.current;
    const shouldRestart = !shouldUseRetake && restartRequested && !restartConsumedRef.current;
    const sessionQuery = new URLSearchParams();

    if (shouldUseRetake && retakeToken) {
      sessionQuery.set("retake", retakeToken);
    } else if (shouldRestart) {
      sessionQuery.set("restart", "1");
    }

    const response = await fetch(withBasePath(`/api/responses/${surveyId}${sessionQuery.size ? `?${sessionQuery}` : ""}`), {
      credentials: "same-origin",
    });
    const payload = (await response.json()) as ResponseSessionPayload;

    if (!response.ok) {
      throw new Error(payload.error || "Не удалось подготовить сессию прохождения.");
    }

    if (shouldRestart) {
      restartConsumedRef.current = true;
      clearNavigationState();
    }
    if (shouldUseRetake) {
      retakeConsumedRef.current = true;
      clearNavigationState();
      router.replace(withBasePath(`/s/${publicSlug}`), { scroll: false });
    }

    if (applySessionPayload(payload)) {
      return;
    }

    setSessionReady(true);

    if (restoreState) {
      const restoredBlockId = payload.lastBlockId ?? schema.blocks[0]?.id ?? null;
      const storedNavigationState = readStoredNavigationState(restoredBlockId);
      const nextHistory = storedNavigationState?.history ?? [];

      blockHistoryRef.current = nextHistory;
      setBlockHistory(nextHistory);
      setCurrentBlockId(restoredBlockId);
      persistNavigationState(restoredBlockId, nextHistory);
      setAnswers(
        Object.fromEntries(
          (payload.answers ?? []).map((answer) => [answer.blockId, answer.rawValue ?? answer.value]),
        ),
      );
    }
  }

  async function postWithSessionRetry(body: Record<string, unknown>, options?: { retryOnMissingSession?: boolean }) {
    const submit = async () => {
      const response = await fetch(withBasePath(`/api/responses/${surveyId}`), {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const payload = (await response.json()) as ResponseSessionPayload;

      return { response, payload };
    };

    let result = await submit();

    if (options?.retryOnMissingSession && !result.response.ok && result.payload.error === "Сессия прохождения не найдена.") {
      await ensureResponseSession(false);
      result = await submit();
    }

    applySessionPayload(result.payload);

    return result;
  }

  async function persistAnswerForBlock(
    blockId: string,
    value: unknown,
    options?: {
      skipWhenEmpty?: boolean;
      allowPartial?: boolean;
    },
  ) {
    const blockIndex = schema.blocks.findIndex((entry) => entry.id === blockId);
    const block = schema.blocks[blockIndex];
    if (!block) {
      throw new Error("Вопрос не найден.");
    }

    if (block.type === "WELCOME") {
      const nextBlockId = block.nextBlockId ?? schema.blocks[blockIndex + 1]?.id ?? null;

      if (schema.settings.timerEnabled && nextBlockId && !isFinishSurveyTarget(nextBlockId)) {
        const { response, payload } = await postWithSessionRetry(
          {
            action: "startTimer",
            nextBlockId,
          },
          { retryOnMissingSession: true },
        );

        if (applySessionPayload(payload)) {
          return {
            nextBlockId: null,
            terminal: true,
          };
        }

        if (!response.ok) {
          throw new Error(payload.error || "Не удалось запустить таймер прохождения.");
        }

        return {
          nextBlockId: payload.nextBlockId ?? nextBlockId,
        };
      }

      return {
        nextBlockId,
      };
    }

    const answered = isBlockAnswered(block, value);

    if (block.required && !answered && !options?.skipWhenEmpty) {
      throw new Error("Этот вопрос обязателен. Ответьте, чтобы продолжить.");
    }

    if (block.type === "TEXT" && textAnswerBelowMinimum(block, value)) {
      throw new Error(`Минимальная длина ответа: ${block.minLength} символов.`);
    }

    if (block.type === "COMBINED" && isCombinedTextBelowMinimum(block, value)) {
      throw new Error(`Минимальная длина ответа: ${block.textMinLength} символов.`);
    }

    if (!answered && options?.skipWhenEmpty && !hasDraftValue(value)) {
      return null;
    }

    const { response, payload } = await postWithSessionRetry(
      {
        action: "answer",
        blockId: block.id,
        value,
        allowPartial: options?.allowPartial,
      },
      { retryOnMissingSession: true },
    );

    if (applySessionPayload(payload)) {
      return {
        nextBlockId: null,
        terminal: true,
      };
    }

    if (!response.ok) {
      throw new Error(payload.error || "Не удалось сохранить ответ.");
    }

    return payload.answer ?? { nextBlockId: null };
  }

  async function flushAnsweredDrafts(options?: { allowPartial?: boolean }) {
    const snapshot = answersRef.current;

    for (const block of schema.blocks) {
      if (block.type === "WELCOME" || !(block.id in snapshot)) {
        continue;
      }

      const value = snapshot[block.id];
      if (!hasDraftValue(value)) {
        continue;
      }
      if (block.type === "TEXT" && textAnswerBelowMinimum(block, value)) {
        continue;
      }
      if (block.type === "COMBINED" && isCombinedTextBelowMinimum(block, value)) {
        continue;
      }

      const saved = await persistAnswerForBlock(block.id, value, {
        skipWhenEmpty: true,
        allowPartial: options?.allowPartial,
      });

      if (saved && "terminal" in saved) {
        return;
      }
    }
  }

  async function persistCurrentAnswer(options?: {
    skipWhenEmpty?: boolean;
    allowPartial?: boolean;
    valueOverride?: unknown;
  }) {
    if (!currentBlock) {
      return null;
    }

    if (currentBlock.type === "WELCOME") {
      return persistAnswerForBlock(currentBlock.id, null, options);
    }

    const currentValue = options?.valueOverride ?? answersRef.current[currentBlock.id] ?? null;
    return persistAnswerForBlock(currentBlock.id, currentValue, options);
  }

  finishRef.current = async (status: FinishStatus, options?: { allowPartialAnswers?: boolean }) => {
    try {
      setError("");

      try {
        await flushAnsweredDrafts({ allowPartial: options?.allowPartialAnswers ?? status !== "COMPLETED" });
      } catch (flushError) {
        const message = flushError instanceof Error ? flushError.message : "";
        if (status !== "TIMED_OUT" || message !== "Время прохождения истекло.") {
          throw flushError;
        }
      }

      const { response, payload } = await postWithSessionRetry({
        action: "complete",
        status,
      });

      if (!response.ok) {
        throw new Error(payload.error || "Не удалось завершить прохождение.");
      }

      clearNavigationState();
      router.push(doneUrl(status));
    } catch (finishError) {
      setError(finishError instanceof Error ? finishError.message : "Не удалось завершить прохождение.");
    }
  };

  function finish(status: FinishStatus, options?: { allowPartialAnswers?: boolean }) {
    return finishRef.current(status, options);
  }

  function requestFinishByButton() {
    if (isPending || !sessionReady) {
      return;
    }

    setConfirmationAction("finish");
  }

  function runFinishByButton() {
    startTransition(() => void finish("COMPLETED", { allowPartialAnswers: true }));
  }

  function requestRestartFromBlock() {
    if (isPending || !sessionReady) {
      return;
    }

    setConfirmationAction("restart");
  }

  function confirmPendingAction() {
    const action = confirmationAction;
    setConfirmationAction(null);

    if (action === "finish") {
      runFinishByButton();
      return;
    }

    if (action === "restart") {
      startTransition(() => void restartFromBlock());
    }
  }

  async function restartFromBlock() {
    try {
      setError("");
      setSessionReady(false);

      const { response, payload } = await postWithSessionRetry({
        action: "reset",
      });

      if (!response.ok) {
        throw new Error(payload.error || "Не удалось перезапустить опрос.");
      }

      answersRef.current = {};
      timeoutSubmittedRef.current = false;
      setAnswers({});
      clearNavigationState();
      setCurrentBlockId(schema.blocks[0]?.id ?? null);
      setOpenAdditionalInfoId(null);
      setSecondsLeft(null);
      setTimerDeadlineAtMs(null);
      shouldScrollAfterBlockChangeRef.current = true;
      await ensureResponseSession(false);
    } catch (restartError) {
      setError(restartError instanceof Error ? restartError.message : "Не удалось перезапустить опрос.");
      setSessionReady(true);
    }
  }

  useEffect(() => {
    let cancelled = false;

    void ensureResponseSession(true)
      .catch((bootstrapError) => {
        if (!cancelled) {
          setError(bootstrapError instanceof Error ? bootstrapError.message : "Не удалось подготовить прохождение.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBooting(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [schema, surveyId, restartRequested, retakeToken]);

  useEffect(() => {
    if (!schema.settings.timerEnabled || timerDeadlineAtMs == null) {
      return;
    }

    const tick = () => {
      const nextSecondsLeft = Math.max(0, Math.ceil((timerDeadlineAtMs - Date.now()) / 1000));
      setSecondsLeft(nextSecondsLeft);

      if (nextSecondsLeft <= 0 && !timeoutSubmittedRef.current) {
        timeoutSubmittedRef.current = true;
        void finishRef.current("TIMED_OUT");
      }
    };

    tick();
    const timer = window.setInterval(tick, 1000);

    return () => window.clearInterval(timer);
  }, [schema.settings.timerEnabled, timerDeadlineAtMs]);

  const progress = useMemo(() => {
    if (!schema.blocks.length || currentIndex < 0) {
      return 0;
    }

    return Math.round(((currentIndex + 1) / schema.blocks.length) * 100);
  }, [currentIndex, schema.blocks.length]);
  const showProgress = schema.settings.showProgressBar;
  const showRuntimeMeta = showProgress || secondsLeft != null;
  const currentValue = currentBlock ? answers[currentBlock.id] : undefined;
  const canSubmitCurrentBlock = currentBlock ? canSubmitBlock(currentBlock, currentValue) : false;
  const primaryButtonDisabled = isPending || !sessionReady || !canSubmitCurrentBlock;
  const showTopRuntimeMeta = currentBlock?.type === "WELCOME" && showRuntimeMeta;

  if (booting || !currentBlock) {
    return (
      <Card className="border-slate-200 p-8 text-center">
        <LoaderCircle className="mx-auto h-6 w-6 animate-spin text-sky-600" />
        <p className="mt-3 text-sm text-slate-500">Готовим опрос к прохождению...</p>
      </Card>
    );
  }

  async function submitCurrentAnswer() {
    try {
      setError("");
      await settleMobileInputBeforeTransition();

      const saved = await persistCurrentAnswer();
      if (saved && "terminal" in saved) {
        return;
      }

      const nextBlockId = saved?.nextBlockId ?? null;

      if (!nextBlockId || isFinishSurveyTarget(nextBlockId)) {
        await finish("COMPLETED");
        return;
      }

      navigateToBlock(nextBlockId, {
        pushFromBlockId: currentBlock.id,
        scroll: true,
      });

    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Не удалось сохранить ответ.";
      setError(shouldHideInlineError(message) ? "" : message);
    }
  }

  async function submitCurrentAnswerWithValue(nextValue: unknown) {
    try {
      setError("");
      await settleMobileInputBeforeTransition();

      const saved = await persistCurrentAnswer({
        valueOverride: nextValue,
      });
      if (saved && "terminal" in saved) {
        return;
      }

      const nextBlockId = saved?.nextBlockId ?? null;

      if (!nextBlockId || isFinishSurveyTarget(nextBlockId)) {
        await finish("COMPLETED");
        return;
      }

      navigateToBlock(nextBlockId, {
        pushFromBlockId: currentBlock.id,
        scroll: true,
      });

    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Не удалось сохранить ответ.";
      setError(shouldHideInlineError(message) ? "" : message);
    }
  }

  function handleAnswerChange(value: unknown, options?: AnswerChangeOptions) {
    if (!currentBlock) {
      return;
    }

    if (error) {
      setError("");
    }

    setAnswers((current) => {
      const next = {
        ...current,
        [currentBlock.id]: value,
      };
      answersRef.current = next;
      return next;
    });

    const shouldAutoSubmit = options?.autoSubmit ?? canAutoScrollBlock(currentBlock);

    if (
      sessionReady &&
      schema.settings.autoScrollEnabled &&
      currentBlock.type !== "WELCOME" &&
      shouldAutoSubmit
    ) {
      startTransition(() => void submitCurrentAnswerWithValue(value));
    }
  }

  const confirmationCopy =
    confirmationAction === "finish"
      ? {
          title: "Завершить опрос?",
          description: "Ответы, которые уже заполнены, будут отправлены в результаты.",
          confirmLabel: "Да, завершить",
        }
      : confirmationAction === "restart"
        ? {
            title: "Перезапуск опроса?",
            description: "Текущие ответы будут сброшены и не попадут в результаты.",
            confirmLabel: "Перезапуск",
          }
        : null;

  return (
    <div ref={runtimeRef} className="survey-runtime space-y-4 sm:space-y-6" style={runtimeStyle}>
      <style>{SURVEY_RUNTIME_TYPOGRAPHY_CSS}</style>
      {false ? <Card className="border-slate-200 p-8">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-6 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Прогресс</p>
            <p className="mt-1 text-sm font-medium text-slate-600">
              Экран {currentIndex + 1} из {schema.blocks.length}
            </p>
          </div>
          {secondsLeft != null ? (
            <div className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700">
              <Clock3 className="h-4 w-4" />
              {formatCountdown(secondsLeft ?? 0)}
            </div>
          ) : null}
        </div>
        {schema.settings.showProgressBar ? (
          <div className="h-2 bg-slate-100">
            <div className="h-full bg-[linear-gradient(90deg,#1d5fd0,#55b9ff)] transition-all" style={{ width: `${progress}%` }} />
          </div>
        ) : null}
      </Card> : null}

      <Card className="border-slate-200 p-4 sm:p-8">
        {showTopRuntimeMeta ? (
          <div
            className={cn(
              "mb-6 flex flex-wrap gap-4 border-b border-slate-100 pb-6",
              showProgress ? "items-end justify-between" : "justify-end",
            )}
          >
            {showProgress ? (
              <div className="min-w-[220px] flex-1">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{"\u041F\u0440\u043E\u0433\u0440\u0435\u0441\u0441"}</p>
                  <p className="text-sm font-medium text-slate-600">
                    {"\u042D\u043A\u0440\u0430\u043D"} {currentIndex + 1} {"\u0438\u0437"} {schema.blocks.length}
                  </p>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full bg-[linear-gradient(90deg,#1d5fd0,#55b9ff)] transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            ) : null}
            {secondsLeft != null ? (
              <div className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700">
                <Clock3 className="h-4 w-4" />
                {formatCountdown(secondsLeft ?? 0)}
              </div>
            ) : null}
          </div>
        ) : null}
        {currentBlock.type === "WELCOME" ? (
          <div ref={currentBlockSectionRef} className="space-y-4 sm:space-y-6">
            <div className="space-y-2.5 sm:space-y-3">
              <QuestionTitleInteractive
                key={currentBlock.id}
                title={currentBlock.title}
                mobileTitle={getMobileTextOverride(currentBlock, "title")}
                hint={currentBlock.questionHint}
                mobileHint={getMobileTextOverride(currentBlock, "questionHint")}
                structuredMobileTitle={useStructuredMobileQuestionText}
                textWrapStyle={textWrapStyle}
              />
              {currentBlock.description ? (
                <QuestionDescription
                  description={currentBlock.description}
                  mobileDescription={getMobileTextOverride(currentBlock, "description")}
                  structuredMobileDescription={useStructuredMobileQuestionText}
                  textWrapStyle={textWrapStyle}
                  className="max-w-full"
                />
              ) : null}
            </div>
            <div className="flex flex-nowrap gap-2 overflow-x-auto border-t border-slate-100 pt-4 sm:flex-wrap sm:gap-3 sm:overflow-visible sm:pt-6">
              {canGoBack ? (
                <Button
                  variant="secondary"
                  disabled={!sessionReady}
                  onClick={goBackToPreviousBlock}
                  className="min-w-0 shrink !px-3 !py-2 !text-xs sm:min-w-[120px] sm:!px-5 sm:!py-3 sm:!text-base"
                >
                  Назад
                </Button>
              ) : null}
              {currentBlock.showFinishButton ? (
                <Button variant="secondary" className="min-w-0 shrink !px-3 !py-2 !text-xs sm:min-w-[160px] sm:!px-5 sm:!py-3 sm:!text-base" onClick={requestFinishByButton} disabled={isPending || !sessionReady}>
                  Завершить
                </Button>
              ) : null}
              {currentBlock.showRestartBlockButton ? (
                <Button variant="secondary" className="min-w-0 shrink !px-3 !py-2 !text-xs sm:min-w-[160px] sm:!px-5 sm:!py-3 sm:!text-base" onClick={requestRestartFromBlock} disabled={isPending || !sessionReady}>
                  Перезапуск
                </Button>
              ) : null}
              <Button className="min-w-0 shrink !px-3 !py-2 !text-xs sm:min-w-[180px] sm:!px-5 sm:!py-3 sm:!text-base" onClick={() => startTransition(() => void submitCurrentAnswer())} disabled={primaryButtonDisabled}>
                {renderResponsiveRichText(currentBlock.ctaLabel, getMobileTextOverride(currentBlock, "ctaLabel"))}
              </Button>
            </div>
            <AdditionalInfoTrayUpwardPopup
              items={currentAdditionalInfoItems}
              openItemId={openAdditionalInfoId}
              onToggle={(itemId) => setOpenAdditionalInfoId((current) => (current === itemId ? null : itemId))}
              containerRef={additionalInfoRef}
              onClose={() => setOpenAdditionalInfoId(null)}
            />
          </div>
        ) : (
          <div ref={currentBlockSectionRef} className="space-y-4 sm:space-y-5">
            <div className="space-y-2 sm:space-y-2.5">
              {showProgress ? (
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full bg-[linear-gradient(90deg,#1d5fd0,#55b9ff)] transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              ) : null}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <div className="order-2 min-w-0 flex-1 sm:order-1">
                  <QuestionTitleInteractive
                    key={currentBlock.id}
                    title={currentBlock.title}
                    mobileTitle={getMobileTextOverride(currentBlock, "title")}
                    hint={currentBlock.questionHint}
                    mobileHint={getMobileTextOverride(currentBlock, "questionHint")}
                    structuredMobileTitle={useStructuredMobileQuestionText}
                    textWrapStyle={textWrapStyle}
                  />
                </div>
                {secondsLeft != null ? (
                  <div className="order-1 inline-flex shrink-0 items-center gap-1.5 self-start rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 sm:order-2 sm:mt-1 sm:text-sm">
                    <Clock3 className="h-3.5 w-3.5" />
                    {formatCountdown(secondsLeft ?? 0)}
                  </div>
                ) : null}
              </div>
              {currentBlock.description ? (
                <QuestionDescription
                  description={currentBlock.description}
                  mobileDescription={getMobileTextOverride(currentBlock, "description")}
                  structuredMobileDescription={useStructuredMobileQuestionText}
                  textWrapStyle={textWrapStyle}
                />
              ) : null}
            </div>

            <QuestionRenderer
              block={currentBlock}
              value={answers[currentBlock.id]}
              onChange={handleAnswerChange}
              surveyId={surveyId}
              answerTextStyle={answerTextStyle}
            />
            {error ? <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

            <div className="flex flex-nowrap gap-2 overflow-x-auto border-t border-slate-100 pt-4 sm:flex-wrap sm:gap-3 sm:overflow-visible sm:pt-6">
              <Button
                variant="secondary"
                disabled={!sessionReady || !canGoBack}
                onClick={goBackToPreviousBlock}
                className="min-w-0 shrink !px-3 !py-2 !text-xs sm:!px-5 sm:!py-3 sm:!text-base"
              >
                Назад
              </Button>
              {currentBlock.showFinishButton ? (
                <Button variant="secondary" onClick={requestFinishByButton} disabled={isPending || !sessionReady} className="min-w-0 shrink !px-3 !py-2 !text-xs sm:!px-5 sm:!py-3 sm:!text-base">
                  Завершить
                </Button>
              ) : null}
              {currentBlock.showRestartBlockButton ? (
                <Button variant="secondary" onClick={requestRestartFromBlock} disabled={isPending || !sessionReady} className="min-w-0 shrink !px-3 !py-2 !text-xs sm:!px-5 sm:!py-3 sm:!text-base">
                  Перезапуск
                </Button>
              ) : null}
              <Button
                onClick={() => startTransition(() => void submitCurrentAnswer())}
                disabled={primaryButtonDisabled}
                className={cn(
                  "min-w-0 shrink !px-3 !py-2 !text-xs sm:!px-5 sm:!py-3 sm:!text-base",
                  primaryButtonDisabled &&
                    "border-sky-100 bg-sky-200 text-white opacity-100 shadow-none hover:bg-sky-200 hover:text-white",
                )}
              >
                {isPending ? <LoaderCircle className="mr-1 h-3.5 w-3.5 animate-spin sm:mr-2 sm:h-4 sm:w-4" /> : <ArrowRight className="mr-1 h-3.5 w-3.5 sm:mr-2 sm:h-4 sm:w-4" />}
                Продолжить
              </Button>
            </div>
            <AdditionalInfoTrayUpwardPopup
              items={currentAdditionalInfoItems}
              openItemId={openAdditionalInfoId}
              onToggle={(itemId) => setOpenAdditionalInfoId((current) => (current === itemId ? null : itemId))}
              containerRef={additionalInfoRef}
              onClose={() => setOpenAdditionalInfoId(null)}
            />
          </div>
        )}
      </Card>
      {confirmationCopy ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="survey-confirmation-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4 py-6 backdrop-blur-sm"
          onClick={() => setConfirmationAction(null)}
        >
          <div
            className="w-full max-w-sm rounded-[28px] border border-white/80 bg-white p-5 text-left shadow-[0_30px_90px_-45px_rgba(15,23,42,0.8)] sm:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="survey-confirmation-title" className="text-xl font-semibold tracking-tight text-slate-950">
              {confirmationCopy.title}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{confirmationCopy.description}</p>
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setConfirmationAction(null)}>
                Нет
              </Button>
              <Button type="button" onClick={confirmPendingAction}>
                {confirmationCopy.confirmLabel}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function QuestionTitle({
  title,
  mobileTitle,
  hint,
  mobileHint,
  structuredMobileTitle = false,
  textWrapStyle,
}: {
  title: string;
  mobileTitle?: string | null;
  hint?: string;
  mobileHint?: string | null;
  structuredMobileTitle?: boolean;
  textWrapStyle: CSSProperties;
}) {
  const trimmedHint = hint?.trim() ?? "";
  const trimmedMobileHint = mobileHint?.trim() ?? "";
  const hasMobileTitle = Boolean(mobileTitle?.trim());

  return (
    <div className="flex max-w-full items-start gap-2">
      {hasMobileTitle ? (
        <h1
          className="survey-title-text min-w-0 flex-1 whitespace-pre-line break-words font-semibold tracking-tight text-slate-950 sm:hidden"
          style={textWrapStyle}
        >
          {renderRichText(mobileTitle ?? "")}
        </h1>
      ) : structuredMobileTitle ? (
        <StructuredMobileQuestionTitle title={title} textWrapStyle={textWrapStyle} />
      ) : null}
      <h1
        className={cn(
          "survey-title-text min-w-0 flex-1 whitespace-pre-line break-words font-semibold tracking-tight text-slate-950",
          (structuredMobileTitle || hasMobileTitle) && "hidden sm:block",
        )}
        style={textWrapStyle}
      >
        {renderRichText(title)}
      </h1>
      {trimmedHint ? (
        <span className="group relative mt-1 inline-flex shrink-0">
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-sky-100 bg-sky-50 text-sky-700 transition hover:border-sky-200 hover:bg-sky-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
            aria-label="Пояснение к вопросу"
          >
            <Info className="h-4 w-4" aria-hidden="true" />
          </button>
          <span
            role="tooltip"
            className="pointer-events-none absolute right-0 top-full z-40 mt-2 hidden w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-slate-200 bg-white p-4 text-sm font-normal leading-6 text-slate-600 shadow-[0_24px_70px_-36px_rgba(15,23,42,0.65)] group-hover:block group-focus-within:block"
            style={textWrapStyle}
          >
            {renderResponsiveRichText(trimmedHint, trimmedMobileHint)}
          </span>
        </span>
      ) : null}
    </div>
  );
}

function QuestionDescription({
  description,
  mobileDescription,
  structuredMobileDescription,
  textWrapStyle,
  className,
}: {
  description: string;
  mobileDescription?: string | null;
  structuredMobileDescription: boolean;
  textWrapStyle: CSSProperties;
  className?: string;
}) {
  if (mobileDescription?.trim()) {
    return (
      <>
        <p
          className={cn("survey-description-text whitespace-pre-line text-slate-600 sm:hidden", className)}
          style={textWrapStyle}
        >
          {renderRichText(mobileDescription)}
        </p>
        <p
          className={cn("survey-description-text hidden whitespace-pre-line text-slate-600 sm:block", className)}
          style={textWrapStyle}
        >
          {renderRichText(description)}
        </p>
      </>
    );
  }

  return (
    <>
      {structuredMobileDescription ? <StructuredMobileQuestionDescription description={description} /> : null}
      <p
        className={cn(
          "survey-description-text whitespace-pre-line text-slate-600",
          structuredMobileDescription && "hidden sm:block",
          className,
        )}
        style={textWrapStyle}
      >
        {renderRichText(description)}
      </p>
    </>
  );
}

function StructuredMobileQuestionTitle({
  title,
  textWrapStyle,
}: {
  title: string;
  textWrapStyle: CSSProperties;
}) {
  const lines = buildDescendingMobileTextLines(title, "title");

  if (!lines.length) {
    return null;
  }

  return (
    <h1
      className="survey-title-text min-w-0 flex-1 text-left font-semibold tracking-tight text-slate-950 sm:hidden"
      style={{
        ...textWrapStyle,
        maxWidth: "100%",
        overflowWrap: "break-word",
        wordBreak: "normal",
        hyphens: "none",
        fontSize: "min(var(--survey-title-font-size-mobile), 24px)",
        lineHeight: 1.18,
      }}
    >
      {lines.map((line, index) => (
        <span
          key={`${index}-${line}`}
          className="block max-w-full whitespace-normal"
          style={{ overflowWrap: "break-word", wordBreak: "normal", hyphens: "none" }}
        >
          {line}
        </span>
      ))}
    </h1>
  );
}

function StructuredMobileQuestionDescription({
  description,
}: {
  description: string;
}) {
  const lines = buildDescendingMobileTextLines(description, "description");

  if (!lines.length) {
    return null;
  }

  return (
    <p className="survey-description-text min-w-0 text-left text-slate-600 sm:hidden" style={{ hyphens: "none" }}>
      {lines.map((line, index) => (
        <span
          key={`${index}-${line}`}
          className="block max-w-full whitespace-nowrap"
          style={{ overflowWrap: "normal", wordBreak: "normal", hyphens: "none" }}
        >
          {line}
        </span>
      ))}
    </p>
  );
}

function QuestionTitleInteractive({
  title,
  mobileTitle,
  hint,
  mobileHint,
  structuredMobileTitle = false,
  textWrapStyle,
}: {
  title: string;
  mobileTitle?: string | null;
  hint?: string;
  mobileHint?: string | null;
  structuredMobileTitle?: boolean;
  textWrapStyle: CSSProperties;
}) {
  const trimmedHint = hint?.trim() ?? "";
  const trimmedMobileHint = mobileHint?.trim() ?? "";
  const hasMobileTitle = Boolean(mobileTitle?.trim());
  const [isPinned, setIsPinned] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement | null>(null);
  const isOpen = isPinned || isHovered;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || wrapperRef.current?.contains(target)) {
        return;
      }

      setIsPinned(false);
      setIsHovered(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen]);

  return (
    <div className="flex max-w-full items-start gap-2">
      {hasMobileTitle ? (
        <h1
          className="survey-title-text min-w-0 flex-1 whitespace-pre-line break-words font-semibold tracking-tight text-slate-950 sm:hidden"
          style={textWrapStyle}
        >
          {renderRichText(mobileTitle ?? "")}
        </h1>
      ) : structuredMobileTitle ? (
        <StructuredMobileQuestionTitle title={title} textWrapStyle={textWrapStyle} />
      ) : null}
      <h1
        className={cn(
          "survey-title-text min-w-0 flex-1 whitespace-pre-line break-words font-semibold tracking-tight text-slate-950",
          (structuredMobileTitle || hasMobileTitle) && "hidden sm:block",
        )}
        style={textWrapStyle}
      >
        {renderRichText(title)}
      </h1>
      {trimmedHint ? (
        <span
          ref={wrapperRef}
          className="relative mt-1 inline-flex shrink-0"
          onPointerEnter={(event) => {
            if (event.pointerType === "mouse") {
              setIsHovered(true);
            }
          }}
          onPointerLeave={(event) => {
            if (event.pointerType === "mouse") {
              setIsHovered(false);
            }
          }}
        >
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-sky-100 bg-sky-50 text-sky-700 transition hover:border-sky-200 hover:bg-sky-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
            aria-label="Пояснение к вопросу"
            aria-expanded={isOpen}
            aria-pressed={isPinned}
            onClick={() => {
              if (isPinned) {
                setIsPinned(false);
                setIsHovered(false);
                return;
              }

              setIsPinned(true);
            }}
          >
            <Info className="h-4 w-4" aria-hidden="true" />
          </button>
          <span
            role="tooltip"
            className={cn(
              "absolute right-0 top-full z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-slate-200 bg-white p-4 text-sm font-normal leading-6 text-slate-600 shadow-[0_24px_70px_-36px_rgba(15,23,42,0.65)]",
              isOpen ? "block" : "hidden",
            )}
            style={textWrapStyle}
          >
            {renderResponsiveRichText(trimmedHint, trimmedMobileHint)}
          </span>
        </span>
      ) : null}
    </div>
  );
}

function AdditionalInfoTrayUpwardPopup({
  items,
  openItemId,
  onToggle,
  onClose,
  containerRef,
}: {
  items: AdditionalInfoItem[];
  openItemId: string | null;
  onToggle: (itemId: string) => void;
  onClose: () => void;
  containerRef: RefObject<HTMLDivElement | null>;
}) {
  if (!items.length) {
    return null;
  }

  const activeItem = items.find((item) => item.id === openItemId) ?? null;

  return (
    <div ref={containerRef} className="space-y-2 rounded-[24px] border border-slate-200 bg-slate-50/70 p-3 text-left sm:space-y-3 sm:rounded-[28px] sm:p-4">
      {activeItem ? (
        <>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Дополнительная информация"
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4 py-6 backdrop-blur-sm sm:hidden"
            onClick={onClose}
          >
            <div
              className="relative w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-[28px] border border-white/80 bg-white p-5 text-left shadow-[0_30px_90px_-45px_rgba(15,23,42,0.8)]"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                onClick={onClose}
                aria-label="Закрыть дополнительную информацию"
                title="Закрыть"
                className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
              <div className="space-y-1 pr-10">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Дополнительная информация</p>
                <h2 className="text-lg font-semibold text-slate-950">
                  {renderResponsiveRichText(activeItem.label, getMobileTextOverride(activeItem, "label"))}
                </h2>
              </div>
              <p className="survey-additional-info-description-text mt-3 whitespace-pre-wrap text-slate-600">
                {renderResponsiveRichText(
                  activeItem.description.trim() || "Текст не заполнен.",
                  getMobileTextOverride(activeItem, "description"),
                )}
              </p>
            </div>
          </div>
          <div className="relative hidden rounded-[22px] border border-sky-100 bg-white p-4 pr-12 text-left shadow-[0_24px_60px_-40px_rgba(15,23,42,0.45)] sm:block sm:rounded-[24px] sm:p-5 sm:pr-14">
            <button
              type="button"
              onClick={onClose}
              aria-label="Закрыть дополнительную информацию"
              title="Закрыть"
              className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 sm:right-4 sm:top-4"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-slate-950">
                {renderResponsiveRichText(activeItem.label, getMobileTextOverride(activeItem, "label"))}
              </h2>
            </div>
            <p className="survey-additional-info-description-text mt-3 whitespace-pre-wrap text-slate-600">
              {renderResponsiveRichText(
                activeItem.description.trim() || "Текст не заполнен.",
                getMobileTextOverride(activeItem, "description"),
              )}
            </p>
          </div>
        </>
      ) : null}
      <div className="space-y-2 text-left">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Дополнительная информация</p>
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onToggle(item.id)}
              className={cn(
                "max-w-full rounded-full border px-3 py-1.5 text-left text-sm font-medium leading-5 transition sm:px-4 sm:py-2",
                activeItem?.id === item.id
                  ? "border-sky-400 bg-sky-50 text-sky-800 shadow-[0_10px_30px_-20px_rgba(14,116,144,0.5)]"
                  : "border-slate-200 bg-white text-slate-700 hover:border-sky-200 hover:bg-sky-50/60",
              )}
            >
              {renderResponsiveRichText(item.label, getMobileTextOverride(item, "label"))}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function AdditionalInfoTrayUpward({
  items,
  openItemId,
  onToggle,
  onClose,
  containerRef,
}: {
  items: AdditionalInfoItem[];
  openItemId: string | null;
  onToggle: (itemId: string) => void;
  onClose: () => void;
  containerRef: RefObject<HTMLDivElement | null>;
}) {
  if (!items.length) {
    return null;
  }

  const activeItem = items.find((item) => item.id === openItemId) ?? null;

  return (
    <div ref={containerRef} className="space-y-2 rounded-[24px] border border-slate-200 bg-slate-50/70 p-3 text-left sm:space-y-3 sm:rounded-[28px] sm:p-4">
      {activeItem ? (
        <div className="relative rounded-[22px] border border-sky-100 bg-white p-4 pr-12 text-left shadow-[0_24px_60px_-40px_rgba(15,23,42,0.45)] sm:rounded-[24px] sm:p-5 sm:pr-14">
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть дополнительную информацию"
            title="Закрыть"
            className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 sm:right-4 sm:top-4"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-slate-950">
              {renderResponsiveRichText(activeItem.label, getMobileTextOverride(activeItem, "label"))}
            </h2>
          </div>
          <p className="survey-additional-info-description-text mt-3 whitespace-pre-wrap text-slate-600">
            {renderResponsiveRichText(
              activeItem.description.trim() || "Текст не заполнен.",
              getMobileTextOverride(activeItem, "description"),
            )}
          </p>
        </div>
      ) : null}
      <div className="space-y-2 text-left">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Дополнительная информация</p>
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onToggle(item.id)}
              className={cn(
                "max-w-full rounded-full border px-3 py-1.5 text-left text-sm font-medium leading-5 transition sm:px-4 sm:py-2",
                activeItem?.id === item.id
                  ? "border-sky-400 bg-sky-50 text-sky-800 shadow-[0_10px_30px_-20px_rgba(14,116,144,0.5)]"
                  : "border-slate-200 bg-white text-slate-700 hover:border-sky-200 hover:bg-sky-50/60",
              )}
            >
              {renderResponsiveRichText(item.label, getMobileTextOverride(item, "label"))}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function AdditionalInfoTray({
  items,
  openItemId,
  onToggle,
  onClose,
  containerRef,
}: {
  items: AdditionalInfoItem[];
  openItemId: string | null;
  onToggle: (itemId: string) => void;
  onClose: () => void;
  containerRef: RefObject<HTMLDivElement | null>;
}) {
  if (!items.length) {
    return null;
  }

  const activeItem = items.find((item) => item.id === openItemId) ?? null;

  return (
    <div ref={containerRef} className="space-y-2 rounded-[24px] border border-slate-200 bg-slate-50/70 p-3 text-left sm:space-y-3 sm:rounded-[28px] sm:p-4">
      <div className="space-y-2 text-left">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Дополнительная информация</p>
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <div key={item.id} className="contents">
              <button
                type="button"
                onClick={() => onToggle(item.id)}
                className={cn(
                  "max-w-full rounded-full border px-3 py-1.5 text-left text-sm font-medium leading-5 transition sm:px-4 sm:py-2",
                  activeItem?.id === item.id
                    ? "border-sky-400 bg-sky-50 text-sky-800 shadow-[0_10px_30px_-20px_rgba(14,116,144,0.5)]"
                    : "border-slate-200 bg-white text-slate-700 hover:border-sky-200 hover:bg-sky-50/60",
                )}
              >
                {renderResponsiveRichText(item.label, getMobileTextOverride(item, "label"))}
              </button>
              {activeItem?.id === item.id ? (
                <div className="relative basis-full rounded-[22px] border border-sky-100 bg-white p-4 pr-12 text-left shadow-[0_24px_60px_-40px_rgba(15,23,42,0.45)] sm:hidden">
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close additional information"
                    title="Close"
                    className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <div className="space-y-1">
                    <h2 className="text-lg font-semibold text-slate-950">
                      {renderResponsiveRichText(item.label, getMobileTextOverride(item, "label"))}
                    </h2>
                  </div>
                  <p className="survey-additional-info-description-text mt-3 whitespace-pre-wrap text-slate-600">
                    {renderResponsiveRichText(item.description.trim(), getMobileTextOverride(item, "description"))}
                  </p>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      {activeItem ? (
        <div className="relative hidden rounded-[22px] border border-sky-100 bg-white p-4 pr-12 text-left shadow-[0_24px_60px_-40px_rgba(15,23,42,0.45)] sm:block sm:rounded-[24px] sm:p-5 sm:pr-14">
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть дополнительную информацию"
            title="Закрыть"
            className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 sm:right-4 sm:top-4"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-slate-950">
              {renderResponsiveRichText(activeItem.label, getMobileTextOverride(activeItem, "label"))}
            </h2>
          </div>
          <p className="survey-additional-info-description-text mt-3 whitespace-pre-wrap text-slate-600">
            {renderResponsiveRichText(
              activeItem.description.trim() || "Текст не заполнен.",
              getMobileTextOverride(activeItem, "description"),
            )}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function QuestionRenderer({
  block,
  value,
  onChange,
  surveyId,
  answerTextStyle,
}: {
  block: SurveyBlock;
  value: unknown;
  onChange: AnswerChangeHandler;
  surveyId: string;
  answerTextStyle: CSSProperties;
}) {
  switch (block.type) {
    case "CONTACT":
      return <ContactQuestion block={block} value={value} onChange={onChange} answerTextStyle={answerTextStyle} />;
    case "SINGLE_CHOICE":
    case "MEDIA_CHOICE": {
      const hasRichChoiceCards =
        block.type === "MEDIA_CHOICE" || block.options.some((option) => option.description || option.mediaUrl);
      return (
        <div className="flex flex-wrap gap-2 sm:gap-3">
          {block.options.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => onChange(option.id)}
              className={cn(
                hasRichChoiceCards
                  ? "min-w-[220px] flex-1 basis-[280px] overflow-hidden rounded-[24px] border px-3 py-3 text-left transition sm:rounded-[28px] sm:px-4 sm:py-4"
                  : "inline-flex max-w-full flex-none items-center justify-start rounded-full border px-4 py-2.5 text-left font-semibold transition sm:px-5 sm:py-3",
                value === option.id
                  ? "border-sky-500 bg-sky-50 shadow-[0_20px_50px_-35px_rgba(29,95,208,0.7)]"
                  : "border-slate-200 bg-white hover:border-sky-200 hover:bg-sky-50/40",
              )}
            >
              {block.type === "MEDIA_CHOICE" && option.mediaUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={attachmentUrl(option.mediaUrl)} alt={stripRichTextTokens(option.label)} className="mb-4 h-36 w-full rounded-[22px] object-cover" />
              ) : null}
              <p className={cn("survey-answer-text whitespace-pre-line text-slate-900", hasRichChoiceCards ? "font-semibold" : "whitespace-normal")} style={answerTextStyle}>
                {renderResponsiveRichText(option.label, getMobileTextOverride(option, "label"))}
              </p>
              {option.description ? (
                <p className="survey-answer-text mt-2 whitespace-pre-line text-slate-500" style={answerTextStyle}>
                  {renderResponsiveRichText(option.description, getMobileTextOverride(option, "description"))}
                </p>
              ) : null}
            </button>
          ))}
        </div>
      );
    }
    case "MULTI_CHOICE": {
      const selected = Array.isArray(value) ? value : [];
      return (
        <div className="space-y-2 sm:space-y-3">
          {block.options.map((option) => {
            const isActive = selected.includes(option.id);
            return (
              <label
                key={option.id}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-[22px] border px-3 py-3 text-left transition sm:rounded-[24px] sm:px-4 sm:py-4",
                  isActive ? "border-sky-500 bg-sky-50" : "border-slate-200 bg-white hover:border-sky-200 hover:bg-sky-50/40",
                )}
              >
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(event) => {
                    if (event.target.checked) {
                      onChange([...selected, option.id]);
                    } else {
                      onChange(selected.filter((entry: string) => entry !== option.id));
                    }
                  }}
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                />
                <span>
                  <span className="survey-answer-text block whitespace-pre-line font-semibold text-slate-900" style={answerTextStyle}>
                    {renderResponsiveRichText(option.label, getMobileTextOverride(option, "label"))}
                  </span>
                  {option.description ? (
                    <span className="survey-answer-text mt-1 block whitespace-pre-line text-slate-500" style={answerTextStyle}>
                      {renderResponsiveRichText(option.description, getMobileTextOverride(option, "description"))}
                    </span>
                  ) : null}
                </span>
              </label>
            );
          })}
        </div>
      );
    }
    case "YES_NO":
      return (
        <div className="flex flex-wrap gap-2 sm:gap-3">
          {[
            { key: "yes", label: block.yesLabel },
            { key: "no", label: block.noLabel },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => onChange(item.key)}
              className={cn(
                "inline-flex max-w-full flex-none items-center justify-start rounded-full border px-4 py-2.5 text-left font-semibold transition sm:px-5 sm:py-3",
                value === item.key
                  ? "border-sky-500 bg-sky-50 text-sky-900"
                  : "border-slate-200 bg-white text-slate-700 hover:border-sky-200 hover:bg-sky-50/40",
              )}
            >
              <span className="survey-answer-text whitespace-pre-line" style={answerTextStyle}>
                {renderResponsiveRichText(
                  item.label,
                  getMobileTextOverride(block, item.key === "yes" ? "yesLabel" : "noLabel"),
                )}
              </span>
            </button>
          ))}
        </div>
      );
    case "DROPDOWN":
      return <DropdownQuestion block={block} value={value} onChange={onChange} answerTextStyle={answerTextStyle} />;
    case "RATING":
      return (
        <div className="space-y-3 sm:space-y-4">
          <div className="flex flex-wrap gap-2 sm:gap-3">
            {Array.from({ length: block.scale }).map((_, index) => {
              const valueNumber = index + 1;
              const active = Number(value) === valueNumber;
              return (
                <button
                  key={valueNumber}
                  type="button"
                  onClick={() => onChange(valueNumber)}
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-xl border text-sm font-semibold transition sm:h-14 sm:w-14 sm:rounded-2xl sm:text-lg",
                    active
                      ? "border-sky-500 bg-sky-50 text-sky-700"
                      : "border-slate-200 bg-white text-slate-700 hover:border-sky-200 hover:bg-sky-50/40",
                  )}
                >
                  {valueNumber}
                </button>
              );
            })}
          </div>
          <div className="survey-answer-text flex items-center justify-between text-slate-500" style={answerTextStyle}>
            <span>{renderResponsiveRichText(block.minLabel, getMobileTextOverride(block, "minLabel"))}</span>
            <span>{renderResponsiveRichText(block.maxLabel, getMobileTextOverride(block, "maxLabel"))}</span>
          </div>
        </div>
      );
    case "RANKING":
      return <RankingQuestion block={block} value={value} onChange={onChange} answerTextStyle={answerTextStyle} />;
    case "SCALE": {
      const scaleValueCount = Math.max(block.max - block.min + 1, 0);

      return (
        <div className="space-y-3 sm:space-y-4">
          <div className="flex flex-wrap gap-2 sm:gap-3">
            {Array.from({ length: scaleValueCount }).map((_, index) => {
              const nextValue = block.min + index;
              const active = Number(value ?? block.min) === nextValue;

              return (
                <button
                  key={nextValue}
                  type="button"
                  onClick={() => onChange(nextValue)}
                  className={cn(
                    "flex h-10 min-w-10 items-center justify-center rounded-xl border px-3 text-sm font-semibold transition sm:h-14 sm:min-w-14 sm:rounded-2xl sm:px-4 sm:text-base",
                    active
                      ? "border-sky-500 bg-sky-50 text-sky-700"
                      : "border-slate-200 bg-white text-slate-700 hover:border-sky-200 hover:bg-sky-50/40",
                  )}
                >
                  {nextValue}
                </button>
              );
            })}
          </div>
          <div className="survey-answer-text flex items-center justify-between text-slate-500" style={answerTextStyle}>
            <span>
              {renderResponsiveRichText(block.minLabel, getMobileTextOverride(block, "minLabel"))} ({block.min})
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-900">
              {Number(value ?? block.min)}
            </span>
            <span>
              {renderResponsiveRichText(block.maxLabel, getMobileTextOverride(block, "maxLabel"))} ({block.max})
            </span>
          </div>
        </div>
      );
    }
    case "SLIDER":
      return (
        <div className="space-y-3 sm:space-y-4">
          <input
            type="range"
            min={block.min}
            max={block.max}
            step={block.step}
            value={Number(value ?? block.defaultValue)}
            onChange={(event) => onChange(Number(event.target.value))}
            className="h-3 w-full accent-sky-600"
          />
          <div className="survey-answer-text flex items-center justify-between text-slate-500" style={answerTextStyle}>
            <span>{renderResponsiveRichText(block.minLabel, getMobileTextOverride(block, "minLabel"))}</span>
            <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-900">
              {Number(value ?? block.defaultValue)}
            </span>
            <span>{renderResponsiveRichText(block.maxLabel, getMobileTextOverride(block, "maxLabel"))}</span>
          </div>
        </div>
      );
    case "COMBINED":
      return (
        <CombinedQuestion
          block={block}
          value={value}
          onChange={onChange}
          surveyId={surveyId}
          answerTextStyle={answerTextStyle}
        />
      );
    case "TEXT": {
      return <TextQuestion block={block} value={value} onChange={onChange} surveyId={surveyId} answerTextStyle={answerTextStyle} />;
    }
  }
}

function CombinedQuestion({
  block,
  value,
  onChange,
  surveyId,
  answerTextStyle,
}: {
  block: CombinedBlock;
  value: unknown;
  onChange: AnswerChangeHandler;
  surveyId: string;
  answerTextStyle: CSSProperties;
}) {
  const answer = normalizeCombinedAnswerValue(value);
  const textLength = answer.text.trim().length;
  const minLength = Math.max(0, block.textMinLength);
  const isBelowMinimum = minLength > 0 && textLength > 0 && textLength < minLength;

  return (
    <div className="space-y-4">
      <QuestionRenderer
        block={block.inputBlock as SurveyBlock}
        value={answer.selectedValue}
        onChange={(nextSelectedValue, options) =>
          onChange(
            {
              selectedValue: nextSelectedValue,
              text: "",
            },
            { autoSubmit: options?.autoSubmit ?? canAutoScrollBlock(block.inputBlock) },
          )
        }
        surveyId={surveyId}
        answerTextStyle={answerTextStyle}
      />

      <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
        <span className="h-px flex-1 bg-slate-200" />
        <span>или свой ответ</span>
        <span className="h-px flex-1 bg-slate-200" />
      </div>

      <div className="space-y-2">
        {block.textMultiline ? (
          <Textarea
            value={answer.text}
            onChange={(event) =>
              onChange({
                selectedValue: undefined,
                text: event.target.value,
              })
            }
            maxLength={block.textMaxLength}
            placeholder={stripRichTextTokens(block.textPlaceholder)}
            style={answerTextStyle}
            className="survey-answer-text min-h-[104px] sm:min-h-[140px]"
          />
        ) : (
          <Input
            value={answer.text}
            onChange={(event) =>
              onChange({
                selectedValue: undefined,
                text: event.target.value,
              })
            }
            maxLength={block.textMaxLength}
            placeholder={stripRichTextTokens(block.textPlaceholder)}
            style={answerTextStyle}
            className="survey-answer-text"
          />
        )}
        <div className={cn("flex flex-wrap items-center justify-between gap-2 text-xs", isBelowMinimum ? "text-rose-600" : "text-slate-500")}>
          {minLength > 0 ? <span>Минимум: {minLength} символов</span> : <span />}
          <span>
            Введено: {textLength}
            {block.textMaxLength ? ` / ${block.textMaxLength}` : ""}
          </span>
        </div>
      </div>
    </div>
  );
}

function VoiceStopButton({
  onStopRecording,
  className,
  ariaLabel = "Остановить запись голосового ответа",
}: {
  onStopRecording: () => void;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onStopRecording();
      }}
      title={ariaLabel}
      aria-label={ariaLabel}
      className={cn(
        "relative z-20 inline-flex h-10 w-10 shrink-0 touch-manipulation items-center justify-center rounded-full border border-rose-200 bg-white text-rose-600 shadow-sm transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 focus:outline-none focus:ring-2 focus:ring-rose-100 active:scale-95",
        className,
      )}
    >
      <Square className="pointer-events-none h-4 w-4" aria-hidden="true" />
    </button>
  );
}

function TextQuestion({
  block,
  value,
  onChange,
  surveyId,
  answerTextStyle,
}: {
  block: TextBlock;
  value: unknown;
  onChange: (value: unknown) => void;
  surveyId: string;
  answerTextStyle: CSSProperties;
}) {
  const answer = normalizeTextAnswerValue(value);
  const supportsRichAnswer = block.allowVoiceAnswer || block.allowFileAnswer;
  const richAnswerControlCount = Number(block.allowVoiceAnswer) + Number(block.allowFileAnswer);
  const enteredLength = answer.text.trim().length;
  const minLength = Math.max(0, block.minLength);
  const isBelowMinimum = minLength > 0 && enteredLength > 0 && enteredLength < minLength;
  const [uploadError, setUploadError] = useState("");
  const [isFileUploading, startFileUploadTransition] = useTransition();
  const [isVoiceUploading, startVoiceUploadTransition] = useTransition();
  const [isRecording, setIsRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const answerRef = useRef(answer);

  useEffect(() => {
    answerRef.current = answer;
  }, [answer]);

  useEffect(() => {
    return () => {
      recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const emitAnswer = (next: { text: string; attachments: TextAnswerAttachment[] }) => {
    onChange(supportsRichAnswer ? next : next.text);
  };

  const uploadAttachment = async (file: File, kind: TextAnswerAttachment["kind"]) => {
    setUploadError("");
    const formData = new FormData();
    formData.set("blockId", block.id);
    formData.set("kind", kind);
    formData.set("file", file);
    if (kind === "voice") {
      formData.set("attachToResult", block.attachVoiceAnswerToResult ? "true" : "false");
    }

    const response = await fetch(withBasePath(`/api/responses/${surveyId}/attachments`), {
      method: "POST",
      body: formData,
    });
    const payload = (await response.json()) as { error?: string; attachment?: TextAnswerAttachment };

    if (!response.ok || !payload.attachment) {
      throw new Error(payload.error || "Не удалось загрузить файл.");
    }

    const currentAnswer = answerRef.current;
    const uploadedAttachment = payload.attachment;
    const transcribedText =
      kind === "voice" && uploadedAttachment.transcript?.trim() ? uploadedAttachment.transcript.trim() : "";
    const nextAttachments =
      kind === "voice" && !block.attachVoiceAnswerToResult
        ? currentAnswer.attachments
        : [...currentAnswer.attachments, uploadedAttachment];

    emitAnswer({
      ...currentAnswer,
      text: kind === "voice" ? appendTranscript(currentAnswer.text, transcribedText) : currentAnswer.text,
      attachments: nextAttachments,
    });
  };

  const handleFileUpload = (file: File | undefined) => {
    if (!file) {
      return;
    }

    startFileUploadTransition(async () => {
      try {
        await uploadAttachment(file, "file");
      } catch (error) {
        setUploadError(error instanceof Error ? error.message : "Не удалось загрузить файл.");
      }
    });
  };

  const startRecording = async () => {
    setUploadError("");

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setUploadError("В этом браузере запись голоса недоступна. Можно прикрепить готовый аудиофайл.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredMimeType = RECORDER_MIME_TYPES.find((mimeType) =>
        MediaRecorder.isTypeSupported(mimeType),
      );
      const recorder = new MediaRecorder(stream, preferredMimeType ? { mimeType: preferredMimeType } : undefined);
      recordedChunksRef.current = [];
      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        stream.getTracks().forEach((track) => track.stop());
        recorderRef.current = null;
        setIsRecording(false);
        setUploadError("Не удалось записать голос. Попробуйте ещё раз или прикрепите аудиофайл.");
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const recordedMimeType = normalizedRecorderMimeType(
          recorder.mimeType || recordedChunksRef.current.find((chunk) => chunk.type)?.type || preferredMimeType,
        );
        const blob = new Blob(recordedChunksRef.current, { type: recordedMimeType });
        if (!blob.size) {
          setUploadError("Не удалось сохранить пустую запись. Попробуйте записать ещё раз.");
          return;
        }

        const voiceFile = new File([blob], `voice-answer-${Date.now()}${recorderExtensionForMimeType(recordedMimeType)}`, {
          type: recordedMimeType,
        });

        startVoiceUploadTransition(async () => {
          try {
            await uploadAttachment(voiceFile, "voice");
          } catch (error) {
            setUploadError(error instanceof Error ? error.message : "Не удалось загрузить голосовой ответ.");
          }
        });
      };

      recorder.start();
      setIsRecording(true);
    } catch {
      setUploadError("Браузер не дал доступ к микрофону. Проверьте разрешение и попробуйте снова.");
    }
  };

  const stopRecording = () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    recorderRef.current = null;
    setIsRecording(false);
  };

  const removeAttachment = (id: string) => {
    emitAnswer({
      ...answer,
      attachments: answer.attachments.filter((attachment) => attachment.id !== id),
    });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="relative">
          {block.multiline ? (
            <Textarea
              value={answer.text}
              onChange={(event) => emitAnswer({ ...answer, text: event.target.value })}
              maxLength={block.maxLength}
              placeholder={formatTextAnswerPlaceholder(block.placeholder)}
              style={{ ...answerTextStyle, overflowWrap: "break-word", hyphens: "none" }}
              className={cn(
                "survey-answer-text min-h-[132px] overflow-y-auto pr-4 sm:min-h-[160px]",
                richAnswerControlCount === 1 && "pr-20 sm:pr-24",
                richAnswerControlCount > 1 && "pr-32 sm:pr-36",
              )}
            />
          ) : (
            <Input
              value={answer.text}
              onChange={(event) => emitAnswer({ ...answer, text: event.target.value })}
              maxLength={block.maxLength}
              placeholder={stripRichTextTokens(block.placeholder)}
              style={answerTextStyle}
              className={cn("survey-answer-text pr-24", supportsRichAnswer && "pr-28")}
            />
          )}

          {supportsRichAnswer ? (
            <div className={cn("absolute top-3 flex items-center gap-2", block.multiline ? "right-4 sm:right-8" : "right-3")}>
              {block.allowVoiceAnswer ? (
                isRecording ? (
                  <VoiceStopButton onStopRecording={stopRecording} ariaLabel="Остановить запись справа от ответа" />
                ) : (
                  <button
                    type="button"
                    disabled={isVoiceUploading}
                    onClick={startRecording}
                    title="Записать голосом"
                    aria-label="Записать голосом"
                    className={cn(
                      "relative z-20 inline-flex h-10 w-10 touch-manipulation items-center justify-center rounded-full border bg-white text-slate-600 shadow-sm transition hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-100 active:scale-95",
                      isVoiceUploading && "cursor-wait opacity-70",
                    )}
                  >
                    {isVoiceUploading ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <Mic className="h-4 w-4" />
                    )}
                  </button>
                )
              ) : null}

              {block.allowFileAnswer ? (
                <label
                  title="Прикрепить файл"
                  aria-label="Прикрепить файл"
                  className={cn(
                    "inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border bg-white text-slate-600 shadow-sm transition hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700",
                    isFileUploading && "pointer-events-none cursor-wait opacity-70",
                  )}
                >
                  {isFileUploading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                  <input
                    type="file"
                    className="sr-only"
                    onChange={(event) => {
                      handleFileUpload(event.target.files?.[0]);
                      event.target.value = "";
                    }}
                  />
                </label>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className={cn("flex flex-wrap items-center justify-between gap-2 text-xs", isBelowMinimum ? "text-rose-600" : "text-slate-500")}>
          {minLength > 0 ? <span>Минимум: {minLength} символов</span> : <span />}
          <span>
            Введено: {enteredLength}
            {block.maxLength ? ` / ${block.maxLength}` : ""}
          </span>
        </div>
        {isRecording ? (
          <div className="flex items-center gap-2 rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
            <VoiceStopButton onStopRecording={stopRecording} ariaLabel="Остановить запись в пояснении" />
            <span>Говорите, когда закончите свой ответ, нажмите красный квадрат.</span>
          </div>
        ) : null}
        {answer.attachments.length ? (
          <div className="grid gap-2">
            {answer.attachments.map((attachment) => (
              <div
                key={attachment.id}
                className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700"
              >
                <div className="flex min-w-0 items-center gap-2">
                  {attachment.kind === "voice" ? (
                    <Mic className="h-4 w-4 shrink-0 text-sky-600" />
                  ) : (
                    <Paperclip className="h-4 w-4 shrink-0 text-sky-600" />
                  )}
                  <span className="truncate font-semibold text-slate-900">
                    {attachment.kind === "voice" ? "Голосовой ответ" : "Прикрепленный файл"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => removeAttachment(attachment.id)}
                  className="rounded-xl p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                  aria-label="Удалить вложение"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {uploadError ? <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{uploadError}</div> : null}
      </div>
    </div>
  );
}

function DropdownQuestion({
  block,
  value,
  onChange,
  answerTextStyle,
}: {
  block: DropdownBlock;
  value: unknown;
  onChange: AnswerChangeHandler;
  answerTextStyle: CSSProperties;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownValue = normalizeDropdownAnswerValue(value);
  const otherAnswer = isDropdownOtherAnswerValue(dropdownValue) ? dropdownValue : null;
  const isOtherSelected = block.allowOtherOption && Boolean(otherAnswer);
  const selectedOption =
    typeof dropdownValue === "string" ? block.options.find((option) => option.id === dropdownValue) ?? null : null;
  const otherLabel = block.otherOptionLabel || "Другое";

  return (
    <div className="relative space-y-3">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="survey-answer-text flex min-h-12 w-full items-center justify-between gap-3 rounded-[20px] border border-slate-200 bg-white px-3 py-2.5 text-left text-slate-900 outline-none transition hover:border-sky-200 hover:bg-sky-50/40 focus:border-sky-400 focus:ring-2 focus:ring-sky-100 sm:min-h-14 sm:rounded-[24px] sm:px-4 sm:py-3"
        style={answerTextStyle}
      >
        <span className={cn("whitespace-pre-line", !selectedOption && !isOtherSelected && "text-slate-400")}>
          {selectedOption
            ? renderResponsiveRichText(selectedOption.label, getMobileTextOverride(selectedOption, "label"))
            : isOtherSelected
              ? renderResponsiveRichText(otherLabel, getMobileTextOverride(block, "otherOptionLabel"))
              : stripRichTextTokens(block.placeholder)}
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-slate-400 transition", isOpen && "rotate-180")} />
      </button>

      {isOpen ? (
        <div
          className="absolute z-20 mt-2 w-full overflow-auto rounded-[24px] border border-slate-200 bg-white p-2 shadow-[0_24px_70px_-34px_rgba(15,23,42,0.45)]"
          style={{ maxHeight: "min(70vh, 460px)" }}
        >
          <button
            type="button"
            onClick={() => {
              onChange("");
              setIsOpen(false);
            }}
            className={cn(
              "survey-answer-text block w-full rounded-2xl px-3 py-2.5 text-left transition sm:px-4 sm:py-3",
              !selectedOption ? "bg-sky-50 text-sky-900" : "text-slate-500 hover:bg-slate-50",
            )}
            style={answerTextStyle}
          >
            {stripRichTextTokens(block.placeholder)}
          </button>
          {block.options.map((option) => {
            const active = selectedOption?.id === option.id;

            return (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  onChange(option.id);
                  setIsOpen(false);
                }}
                className={cn(
                  "survey-answer-text block w-full rounded-2xl px-3 py-2.5 text-left transition sm:px-4 sm:py-3",
                  active ? "bg-sky-50 text-sky-900" : "text-slate-700 hover:bg-slate-50",
                )}
                style={answerTextStyle}
              >
                <span className="block whitespace-pre-line font-semibold">
                  {renderResponsiveRichText(option.label, getMobileTextOverride(option, "label"))}
                </span>
                {option.description ? (
                  <span className="mt-1 block whitespace-pre-line text-slate-500">
                    {renderResponsiveRichText(option.description, getMobileTextOverride(option, "description"))}
                  </span>
                ) : null}
              </button>
            );
          })}
          {block.allowOtherOption ? (
            <button
              type="button"
              onClick={() => {
                onChange({
                  optionId: DROPDOWN_OTHER_OPTION_ID,
                  otherText: otherAnswer?.otherText ?? "",
                }, { autoSubmit: false });
                setIsOpen(false);
              }}
              className={cn(
                "survey-answer-text block w-full rounded-2xl px-3 py-2.5 text-left transition sm:px-4 sm:py-3",
                isOtherSelected ? "bg-sky-50 text-sky-900" : "text-slate-700 hover:bg-slate-50",
              )}
              style={answerTextStyle}
            >
              <span className="block whitespace-pre-line font-semibold">
                {renderResponsiveRichText(otherLabel, getMobileTextOverride(block, "otherOptionLabel"))}
              </span>
            </button>
          ) : null}
        </div>
      ) : null}

      {isOtherSelected ? (
        <Input
          value={otherAnswer?.otherText ?? ""}
          onChange={(event) =>
            onChange({
              optionId: DROPDOWN_OTHER_OPTION_ID,
              otherText: event.target.value,
            }, { autoSubmit: false })
          }
          placeholder={stripRichTextTokens(block.otherPlaceholder || "Введите свой вариант")}
          className="survey-answer-text"
          style={answerTextStyle}
        />
      ) : null}
    </div>
  );
}

function PhoneCountrySelect({
  country,
  onChange,
}: {
  country: PhoneCountry;
  onChange: (country: PhoneCountry) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div
      className="relative col-span-2 grid grid-cols-[48px_76px] gap-2"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsOpen(false);
        }
      }}
    >
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="flex h-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-900 outline-none transition hover:border-sky-200 hover:bg-sky-50/40 focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
        aria-expanded={isOpen}
        aria-label={`Выбрать страну: ${country.label}`}
      >
        <CountryFlag country={country} />
      </button>

      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="flex h-11 items-center justify-center gap-1 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition hover:border-sky-200 hover:bg-sky-50/40 focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
        aria-expanded={isOpen}
      >
        <span>{country.dialCode}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-slate-400 transition", isOpen && "rotate-180")} />
      </button>

      {isOpen ? (
        <div className="absolute left-0 top-12 z-30 max-h-72 w-[min(320px,calc(100vw-32px))] overflow-auto rounded-[24px] border border-slate-200 bg-white p-2 shadow-[0_24px_70px_-34px_rgba(15,23,42,0.45)]">
          {PHONE_COUNTRIES.map((item) => {
            const active = item.id === country.id;

            return (
              <button
                key={item.id}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(item);
                  setIsOpen(false);
                }}
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left text-sm transition",
                  active ? "bg-sky-50 text-sky-900" : "text-slate-700 hover:bg-slate-50",
                )}
              >
                <span className="flex items-center gap-3 font-semibold">
                  <CountryFlag country={item} />
                  {item.label}
                </span>
                <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                  {item.dialCode}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ContactQuestion({
  block,
  value,
  onChange,
  answerTextStyle,
}: {
  block: ContactBlock;
  value: unknown;
  onChange: (value: unknown) => void;
  answerTextStyle: CSSProperties;
}) {
  const data = (value && typeof value === "object" ? value : {}) as Record<string, string | string[]>;
  const selectedMessengers = Array.isArray(data.phoneMessengers) ? data.phoneMessengers : [];
  const messengerOptions = ["MAX", "Telegram", "WhatsApp"];
  const enabledFields = block.fields.filter((field) => field.enabled ?? true);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {enabledFields.map((field) => (
        <div key={field.id} className="space-y-2">
          <label className="survey-answer-text font-semibold text-slate-700" style={answerTextStyle}>
            {renderResponsiveRichText(field.label, getMobileTextOverride(field, "label"))}
            {field.required ? <span className="ml-1 text-rose-500">*</span> : null}
          </label>
          {field.id === "phone" ? (
            <div className="grid grid-cols-[48px_76px_minmax(120px,1fr)] gap-2">
              <PhoneCountrySelect
                country={findPhoneCountry(data.phoneCountry)}
                onChange={(nextCountry) => {
                  onChange({
                    ...data,
                    phoneCountry: phoneCountryDisplayName(nextCountry),
                    phone: formatPhoneInput(typeof data.phone === "string" ? data.phone : "", nextCountry),
                  });
                }}
              />
              <Input
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                value={formatPhoneInput(typeof data.phone === "string" ? data.phone : "", findPhoneCountry(data.phoneCountry))}
                onChange={(event) => {
                  const country = findPhoneCountry(data.phoneCountry);
                  onChange({
                    ...data,
                    phoneCountry: phoneCountryDisplayName(country),
                    phone: formatPhoneInput(event.target.value, country),
                  });
                }}
                placeholder={phoneMask(findPhoneCountry(data.phoneCountry))}
                className="survey-answer-text"
                style={answerTextStyle}
              />
            </div>
          ) : (
            <Input
              value={typeof data[field.id] === "string" ? data[field.id] : ""}
              onChange={(event) =>
                onChange({
                  ...data,
                  [field.id]: event.target.value,
                })
              }
              placeholder={stripRichTextTokens(field.placeholder)}
              className="survey-answer-text"
              style={answerTextStyle}
            />
          )}
          {field.id === "phone" ? (
            <div className="grid grid-cols-3 gap-2 pt-1">
              {messengerOptions.map((messenger) => {
                const checked = selectedMessengers.includes(messenger);

                return (
                  <label
                    key={messenger}
                    className={cn(
                      "inline-flex min-h-9 min-w-0 items-center justify-center gap-1.5 rounded-full border px-2 py-1.5 text-[11px] font-medium leading-tight transition sm:gap-2 sm:px-3 sm:text-xs",
                      checked ? "border-sky-300 bg-sky-50 text-sky-800" : "border-slate-200 bg-white text-slate-600",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) =>
                        onChange({
                          ...data,
                          phoneMessengers: event.target.checked
                            ? [...selectedMessengers, messenger]
                            : selectedMessengers.filter((item) => item !== messenger),
                        })
                      }
                      className="h-3.5 w-3.5 shrink-0 rounded border-slate-300 text-sky-600 focus:ring-sky-500 sm:h-4 sm:w-4"
                    />
                    <span className="whitespace-nowrap">{messenger}</span>
                  </label>
                );
              })}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function RankingQuestion({
  block,
  value,
  onChange,
  answerTextStyle,
}: {
  block: RankingBlock;
  value: unknown;
  onChange: (value: unknown) => void;
  answerTextStyle: CSSProperties;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const currentOrder = Array.isArray(value) && value.length ? (value as string[]) : block.items.map((item) => item.id);

  const items = currentOrder
    .map((id) => block.items.find((item) => item.id === id))
    .filter(Boolean) as RankingBlock["items"];

  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div
          key={item.id}
          draggable
          onDragStart={() => setDraggingId(item.id)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={() => {
            if (!draggingId || draggingId === item.id) {
              return;
            }

            const next = [...currentOrder];
            const fromIndex = next.indexOf(draggingId);
            const toIndex = next.indexOf(item.id);

            if (fromIndex === -1 || toIndex === -1) {
              return;
            }

            next.splice(fromIndex, 1);
            next.splice(toIndex, 0, draggingId);
            onChange(next);
            setDraggingId(null);
          }}
          onDragEnd={() => setDraggingId(null)}
          className={cn(
            "flex items-center gap-3 rounded-[24px] border border-slate-200 bg-white px-4 py-4",
            draggingId === item.id ? "border-sky-300 bg-sky-50" : "",
          )}
        >
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-700">
            {index + 1}
          </span>
          <div className="min-w-0 flex-1">
            <p className="survey-answer-text whitespace-pre-line font-semibold text-slate-900" style={answerTextStyle}>
              {renderResponsiveRichText(item.label, getMobileTextOverride(item, "label"))}
            </p>
            {item.description ? (
              <p className="survey-answer-text whitespace-pre-line text-slate-500" style={answerTextStyle}>
                {renderResponsiveRichText(item.description, getMobileTextOverride(item, "description"))}
              </p>
            ) : null}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                if (index === 0) return;
                const next = [...currentOrder];
                [next[index - 1], next[index]] = [next[index], next[index - 1]];
                onChange(next);
              }}
              className="rounded-2xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                if (index === items.length - 1) return;
                const next = [...currentOrder];
                [next[index + 1], next[index]] = [next[index], next[index + 1]];
                onChange(next);
              }}
              className="rounded-2xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
