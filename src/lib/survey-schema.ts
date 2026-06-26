import { nanoid } from "nanoid";

import type {
  AdditionalInfoItem,
  ChoiceOption,
  CombinedAnswerValue,
  CombinedBlock,
  CombinedInputBlock,
  CombinedInputBlockType,
  ContactAnswerValue,
  ContactField,
  DropdownBlock,
  DropdownOtherAnswerValue,
  EvaluatedAnswer,
  MediaChoiceBlock,
  MultiChoiceBlock,
  RankingBlock,
  ScaleBlock,
  SingleChoiceBlock,
  SliderBlock,
  SurveyAnswerRow,
  SurveyBlock,
  SurveyBlockType,
  SurveySchema,
  SurveyTypographySettings,
  TextBlock,
  TextAnswerAttachment,
  TextAnswerValue,
  YesNoBlock,
} from "@/types/surveys";
import { stripRichTextTokens } from "@/lib/rich-text";
import { clamp } from "@/lib/utils";

export const BLOCK_LABELS: Record<SurveyBlockType, string> = {
  WELCOME: "Информативное",
  CONTACT: "Контактные данные",
  SINGLE_CHOICE: "Выбор одного",
  MULTI_CHOICE: "Выбор нескольких",
  MEDIA_CHOICE: "Выбор медиа",
  YES_NO: "Да или Нет",
  DROPDOWN: "Выпадающий список",
  RATING: "Оценка",
  RANKING: "Ранжирование",
  SCALE: "Шкала",
  SLIDER: "Ползунок",
  TEXT: "Текстовый ответ",
  COMBINED: "Комбинированный",
};

export const BLOCK_GROUPS = [
  {
    id: "basic",
    label: "Базовые",
    blockTypes: ["WELCOME", "CONTACT"] as SurveyBlockType[],
  },
  {
    id: "choice",
    label: "Выбор",
    blockTypes: ["SINGLE_CHOICE", "MULTI_CHOICE", "MEDIA_CHOICE", "YES_NO", "DROPDOWN"] as SurveyBlockType[],
  },
  {
    id: "rating",
    label: "Шкала и ранжирование",
    blockTypes: ["RANKING", "SCALE", "SLIDER"] as SurveyBlockType[],
  },
  {
    id: "text",
    label: "Текст",
    blockTypes: ["TEXT", "COMBINED"] as SurveyBlockType[],
  },
];

export const FINISH_SURVEY_TARGET = "__finish__";
export const DROPDOWN_OTHER_OPTION_ID = "__other__";

const AUTO_SCROLL_EXCLUDED = new Set<SurveyBlockType>(["RANKING", "MULTI_CHOICE", "CONTACT", "SLIDER", "TEXT", "COMBINED"]);
export const DEFAULT_SURVEY_TYPOGRAPHY: SurveyTypographySettings = {
  eyebrowFontSize: 12,
  titleFontSize: 26,
  descriptionFontSize: 16,
  answerFontSize: 16,
  additionalInfoDescriptionFontSize: 14,
};
export const DEFAULT_SURVEY_MOBILE_TYPOGRAPHY: SurveyTypographySettings = {
  eyebrowFontSize: 11,
  titleFontSize: 24,
  descriptionFontSize: 14,
  answerFontSize: 14,
  additionalInfoDescriptionFontSize: 13,
};
const CONTACT_VALUE_LABELS: Record<string, string> = {
  phoneCountry: "Страна",
  fullName: "Имя",
  email: "Электронная почта",
  phone: "Телефон",
  phoneMessengers: "Мессенджеры",
  company: "Компания",
};
const CONTACT_VALUE_ORDER = new Map<string, number>(
  ["fullName", "email", "phone", "phoneMessengers", "company"].map((key, index) => [key, index]),
);
const CONTACT_FIELD_KEYS = ["fullName", "email", "phone", "company"] as const satisfies ContactField["id"][];
const CONTACT_COUNTRY_DIAL_CODES: Record<string, string> = {
  ru: "+7",
  kz: "+7",
  by: "+375",
  am: "+374",
  kg: "+996",
  uz: "+998",
  ge: "+995",
  ua: "+380",
  az: "+994",
  md: "+373",
  tj: "+992",
  tm: "+993",
  us: "+1",
  ca: "+1",
  gb: "+44",
  de: "+49",
  fr: "+33",
  it: "+39",
  es: "+34",
  pl: "+48",
  tr: "+90",
  ae: "+971",
  il: "+972",
  in: "+91",
  cn: "+86",
  jp: "+81",
  kr: "+82",
  th: "+66",
  vn: "+84",
  id: "+62",
  lv: "+371",
  lt: "+370",
  ee: "+372",
  rs: "+381",
  me: "+382",
};

function createOption(label: string, score = 0): ChoiceOption {
  return {
    id: nanoid(10),
    label,
    description: "",
    score,
    nextBlockId: null,
    mediaAssetId: null,
    mediaUrl: null,
  };
}

const COMBINED_INPUT_BLOCK_TYPES: CombinedInputBlockType[] = [
  "SINGLE_CHOICE",
  "MULTI_CHOICE",
  "MEDIA_CHOICE",
  "YES_NO",
  "DROPDOWN",
  "RATING",
  "RANKING",
  "SCALE",
  "SLIDER",
];

export function isCombinedInputBlockType(value: unknown): value is CombinedInputBlockType {
  return typeof value === "string" && COMBINED_INPUT_BLOCK_TYPES.includes(value as CombinedInputBlockType);
}

export function createCombinedInputBlock(type: CombinedInputBlockType, index = 1): CombinedInputBlock {
  return createBlock(type, index) as CombinedInputBlock;
}

export function isDropdownOtherAnswerValue(value: unknown): value is DropdownOtherAnswerValue {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as Partial<DropdownOtherAnswerValue>).optionId === DROPDOWN_OTHER_OPTION_ID
  );
}

export function normalizeDropdownAnswerValue(value: unknown): string | DropdownOtherAnswerValue {
  if (typeof value === "string") {
    return value;
  }

  if (!isDropdownOtherAnswerValue(value)) {
    return "";
  }

  return {
    optionId: DROPDOWN_OTHER_OPTION_ID,
    otherText: typeof value.otherText === "string" ? value.otherText : "",
  };
}

export function normalizeCombinedAnswerValue(value: unknown): CombinedAnswerValue {
  if (!value || typeof value !== "object") {
    return {
      selectedValue: undefined,
      text: "",
    };
  }

  const payload = value as Partial<CombinedAnswerValue>;

  return {
    selectedValue: payload.selectedValue,
    text: typeof payload.text === "string" ? payload.text : "",
  };
}

function createContactField(
  id: ContactField["id"],
  label: string,
  placeholder: string,
  required = false,
  enabled = true,
): ContactField {
  return { id, label, placeholder, required, enabled };
}

function createDefaultContactFields(): ContactField[] {
  return [
    createContactField("fullName", "Имя и фамилия", "Иван Иванов", true, true),
    createContactField("email", "Электронная почта", "name@example.com", false, true),
    createContactField("phone", "Телефон", "+7 999 000-00-00", false, true),
    createContactField("company", "Компания", "Название компании", false, false),
  ];
}

function normalizeContactFields(fields: ContactField[] | undefined): ContactField[] {
  const defaultFields = createDefaultContactFields();
  const sourceMap = new Map((fields ?? []).map((field) => [field.id, field] as const));

  return CONTACT_FIELD_KEYS.map((fieldId) => {
    const fallback = defaultFields.find((field) => field.id === fieldId)!;
    const source = sourceMap.get(fieldId);

    return {
      ...fallback,
      label: source?.label?.trim() || fallback.label,
      placeholder: source?.placeholder ?? fallback.placeholder,
      required: Boolean(source?.required ?? fallback.required),
      enabled: source ? source.enabled ?? true : fallback.enabled,
    };
  });
}

function dialCodeFromContactCountry(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  const normalized = value.trim();
  if (!normalized) {
    return "";
  }

  return normalized.match(/\+\d+/)?.[0] ?? CONTACT_COUNTRY_DIAL_CODES[normalized.toLowerCase()] ?? "";
}

function formatContactPhone(phone: unknown, phoneCountry: unknown) {
  if (typeof phone !== "string") {
    return "";
  }

  const normalizedPhone = phone.trim().replace(/\s+/g, " ");
  if (!normalizedPhone) {
    return "";
  }

  if (normalizedPhone.startsWith("+")) {
    return normalizedPhone;
  }

  const dialCode = dialCodeFromContactCountry(phoneCountry);

  return dialCode ? `${dialCode} ${normalizedPhone}` : normalizedPhone;
}

function formatContactAnswerValue(value: Record<string, unknown>) {
  const preparedValue = {
    ...value,
    phone: formatContactPhone(value.phone, value.phoneCountry),
  };

  return Object.entries(preparedValue)
    .filter(([key, entry]) => {
      if (key === "phoneCountry") {
        return false;
      }

      if (Array.isArray(entry)) {
        return entry.length > 0;
      }

      return Boolean(entry);
    })
    .sort(([leftKey], [rightKey]) => {
      const leftOrder = CONTACT_VALUE_ORDER.get(leftKey) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = CONTACT_VALUE_ORDER.get(rightKey) ?? Number.MAX_SAFE_INTEGER;

      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }

      return leftKey.localeCompare(rightKey, "ru");
    })
    .map(([key, entry]) => {
      const label = CONTACT_VALUE_LABELS[key] ?? key;
      const formattedEntry = Array.isArray(entry) ? entry.join(", ") : String(entry);
      return `${label}: ${formattedEntry}`;
    })
    .join("; ");
}

export function isBlockScoringConfigured(block: SurveyBlock | CombinedInputBlock): boolean {
  switch (block.type) {
    case "SINGLE_CHOICE":
    case "MULTI_CHOICE":
    case "MEDIA_CHOICE":
    case "DROPDOWN":
      return Boolean(block.options?.some((option) => Number(option.score) !== 0));
    case "YES_NO":
      return Number(block.yesScore) !== 0 || Number(block.noScore) !== 0;
    case "RATING":
    case "SCALE":
    case "SLIDER":
      return Number(block.scorePerUnit) !== 0;
    case "RANKING":
      return Boolean(block.items?.some((item) => Number(item.score) !== 0));
    case "COMBINED":
      return isBlockScoringConfigured(block.inputBlock);
    default:
      return false;
  }
}

function hasConfiguredScoring(blocks: SurveyBlock[] | undefined): boolean {
  return Boolean(blocks?.some((block) => isBlockScoringConfigured(block)));
}

function maxOptionScore(options: ChoiceOption[]) {
  return Math.max(0, ...options.map((option) => Number(option.score) || 0));
}

function sumTopPositiveScores(options: ChoiceOption[], limit: number | null | undefined) {
  const scores = options
    .map((option) => Number(option.score) || 0)
    .filter((score) => score > 0)
    .sort((left, right) => right - left);
  const selectedScores = Number.isFinite(limit) && limit != null && limit > 0 ? scores.slice(0, limit) : scores;

  return selectedScores.reduce((sum, score) => sum + score, 0);
}

function maxRangeScore(min: number, max: number, scorePerUnit: number) {
  const minScore = Math.max(0, (Number(min) || 0) * (Number(scorePerUnit) || 0));
  const maxScore = Math.max(0, (Number(max) || 0) * (Number(scorePerUnit) || 0));

  return Math.max(minScore, maxScore);
}

function calculateBlockMaxScore(block: SurveyBlock | CombinedInputBlock) {
  switch (block.type) {
    case "SINGLE_CHOICE":
    case "MEDIA_CHOICE":
    case "DROPDOWN":
      return maxOptionScore(block.options);
    case "MULTI_CHOICE":
      return sumTopPositiveScores(block.options, block.maxSelected);
    case "YES_NO":
      return Math.max(0, Number(block.yesScore) || 0, Number(block.noScore) || 0);
    case "RATING":
      return maxRangeScore(1, block.scale, block.scorePerUnit);
    case "SCALE":
    case "SLIDER":
      return maxRangeScore(block.min, block.max, block.scorePerUnit);
    case "COMBINED":
      return calculateBlockMaxScore(block.inputBlock);
    default:
      return 0;
  }
}

export function calculateSurveyBlockMaxScore(block: SurveyBlock | CombinedInputBlock) {
  return calculateBlockMaxScore(block);
}

export function calculateSurveyMaxScore(schema: SurveySchema) {
  return schema.blocks.reduce((sum, block) => sum + calculateBlockMaxScore(block), 0);
}

export function countSurveyQuestionBlocks(schema: SurveySchema) {
  return schema.blocks.filter((block) => block.type !== "WELCOME" && block.type !== "CONTACT").length;
}

export function calculateSurveyQuestionMaxScore(schema: SurveySchema) {
  return countSurveyQuestionBlocks(schema) * 10;
}

export function isFinishSurveyTarget(target: string | null | undefined) {
  return target === FINISH_SURVEY_TARGET;
}

export function createBlock(type: SurveyBlockType, index = 1): SurveyBlock {
  const base = {
    id: nanoid(10),
    adminLabel: "",
    title: `${BLOCK_LABELS[type]} ${index}`,
    description: "",
    questionHint: "",
    resultLabelOverride: null,
    required: false,
    nextBlockId: null,
    showFinishButton: false,
    showRestartBlockButton: false,
    additionalInfoEnabled: false,
    additionalInfoItemIds: [],
    additionalInfoItems: [],
  };

  switch (type) {
    case "WELCOME":
      return {
        ...base,
        type,
        title: "Добро пожаловать",
        description: "Коротко расскажите, зачем нужен этот опрос и сколько времени он займёт.",
        ctaLabel: "Начать",
      };
    case "CONTACT":
      return {
        ...base,
        type,
        title: "Контактные данные",
        description: "Соберите информацию о респонденте.",
        fields: [
          createContactField("fullName", "Имя и фамилия", "Иван Иванов", true),
          createContactField("email", "Электронная почта", "name@example.com"),
          createContactField("phone", "Телефон", "+7 999 000-00-00"),
        ],
        submitLabel: "Сохранить контакты",
      };
    case "SINGLE_CHOICE":
      return {
        ...base,
        type,
        options: [createOption("Вариант 1"), createOption("Вариант 2")],
      };
    case "MULTI_CHOICE":
      return {
        ...base,
        type,
        options: [createOption("Вариант 1"), createOption("Вариант 2"), createOption("Вариант 3")],
        minSelected: 0,
        maxSelected: null,
      };
    case "MEDIA_CHOICE":
      return {
        ...base,
        type,
        options: [createOption("Карточка 1"), createOption("Карточка 2")],
      };
    case "YES_NO":
      return {
        ...base,
        type,
        title: "Вопрос с ответом Да/Нет",
        yesLabel: "Да",
        noLabel: "Нет",
        yesScore: 1,
        noScore: 0,
        yesNextBlockId: null,
        noNextBlockId: null,
      };
    case "DROPDOWN":
      return {
        ...base,
        type,
        options: [createOption("Пункт 1"), createOption("Пункт 2")],
        placeholder: "Выберите вариант",
        allowOtherOption: false,
        otherOptionLabel: "Другое",
        otherPlaceholder: "Введите свой вариант",
      };
    case "RATING":
      return {
        ...base,
        type,
        title: "Оцените по шкале",
        scale: 5,
        icon: "star",
        minLabel: "Плохо",
        maxLabel: "Отлично",
        scorePerUnit: 1,
      };
    case "RANKING":
      return {
        ...base,
        type,
        title: "Ранжируйте варианты",
        items: [createOption("Элемент 1", 0), createOption("Элемент 2", 0), createOption("Элемент 3", 0)],
      };
    case "SCALE":
      return {
        ...base,
        type,
        title: "Шкала",
        min: 1,
        max: 10,
        minLabel: "Минимум",
        maxLabel: "Максимум",
        scorePerUnit: 1,
      };
    case "SLIDER":
      return {
        ...base,
        type,
        title: "Ползунок",
        min: 0,
        max: 10,
        step: 1,
        defaultValue: 0,
        minLabel: "0",
        maxLabel: "10",
        scorePerUnit: 1,
      };
    case "TEXT":
      return {
        ...base,
        type,
        title: "Ваш ответ",
        placeholder: "Введите ответ",
        multiline: true,
        minLength: 0,
        maxLength: 2000,
        allowVoiceAnswer: true,
        attachVoiceAnswerToResult: true,
        allowFileAnswer: false,
      };
    case "COMBINED":
      return {
        ...base,
        type,
        title: "Выберите вариант или напишите свой ответ",
        inputBlock: createCombinedInputBlock("SINGLE_CHOICE", index),
        textPlaceholder: "Или введите свой ответ",
        textMultiline: true,
        textMinLength: 0,
        textMaxLength: 2000,
        textNextBlockId: null,
      };
  }
}

export function createDefaultSurveySchema(title = "Новый опрос"): SurveySchema {
  return {
    title,
    description: "",
    settings: {
      language: "ru",
      autoScrollEnabled: true,
      timerEnabled: false,
      timerSeconds: null,
      completionMessage: "Спасибо за опрос!",
      showProgressBar: true,
      scoringEnabled: false,
      showRestartButton: true,
      additionalInfoItems: [],
      typography: DEFAULT_SURVEY_TYPOGRAPHY,
      mobileTypography: DEFAULT_SURVEY_MOBILE_TYPOGRAPHY,
    },
    blocks: [createBlock("WELCOME", 1), createBlock("SINGLE_CHOICE", 2)],
  };
}

export function normalizeSurveySchema(raw: unknown, fallbackTitle = "Новый опрос"): SurveySchema {
  if (!raw || typeof raw !== "object") {
    return createDefaultSurveySchema(fallbackTitle);
  }

  const source = raw as Partial<SurveySchema>;
  const blocks = Array.isArray(source.blocks)
    ? source.blocks
        .filter((block): block is SurveyBlock => Boolean(block && typeof block === "object" && "type" in block))
        .map((block, index) => normalizeBlock(block, index))
    : createDefaultSurveySchema(fallbackTitle).blocks;
  const additionalInfoItems = mergeAdditionalInfoItems(
    normalizeAdditionalInfoItems(source.settings?.additionalInfoItems),
    blocks.flatMap((block) => block.additionalInfoItems),
  );
  const additionalInfoIds = new Set(additionalInfoItems.map((item) => item.id));
  const normalizedBlocks = blocks.map((block) => {
    const selectedIds = block.additionalInfoItemIds.length
      ? block.additionalInfoItemIds
      : block.additionalInfoItems.map((item) => item.id);

    return {
      ...block,
      additionalInfoItemIds: selectedIds.filter((id) => additionalInfoIds.has(id)),
      additionalInfoItems: [],
    } as SurveyBlock;
  });

  return {
    title: typeof source.title === "string" && source.title.trim() ? source.title.trim() : fallbackTitle,
    description: typeof source.description === "string" ? source.description : "",
    settings: {
      language: source.settings?.language ?? "ru",
      autoScrollEnabled: source.settings?.autoScrollEnabled ?? true,
      timerEnabled: source.settings?.timerEnabled ?? false,
      timerSeconds:
        typeof source.settings?.timerSeconds === "number" && source.settings.timerSeconds > 0
          ? source.settings.timerSeconds
          : null,
      completionMessage: source.settings?.completionMessage || "Спасибо за опрос!",
      showProgressBar: source.settings?.showProgressBar ?? true,
      scoringEnabled: source.settings?.scoringEnabled ?? hasConfiguredScoring(blocks),
      showRestartButton: source.settings?.showRestartButton ?? true,
      additionalInfoItems,
      typography: normalizeTypographySettings(source.settings?.typography),
      mobileTypography: normalizeTypographySettings(source.settings?.mobileTypography, DEFAULT_SURVEY_MOBILE_TYPOGRAPHY),
    },
    blocks: normalizedBlocks,
  };
}

function normalizeFontSize(value: unknown, fallback: number) {
  const numberValue = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(numberValue)) {
    return fallback;
  }

  return clamp(Math.round(numberValue), 10, 48);
}

function normalizeTypographySettings(
  value: unknown,
  fallback: SurveyTypographySettings = DEFAULT_SURVEY_TYPOGRAPHY,
): SurveyTypographySettings {
  const source = value && typeof value === "object" ? (value as Partial<SurveyTypographySettings>) : {};

  return {
    eyebrowFontSize: normalizeFontSize(source.eyebrowFontSize, fallback.eyebrowFontSize),
    titleFontSize: normalizeFontSize(source.titleFontSize, fallback.titleFontSize),
    descriptionFontSize: normalizeFontSize(source.descriptionFontSize, fallback.descriptionFontSize),
    answerFontSize: normalizeFontSize(source.answerFontSize, fallback.answerFontSize),
    additionalInfoDescriptionFontSize: normalizeFontSize(
      source.additionalInfoDescriptionFontSize,
      fallback.additionalInfoDescriptionFontSize,
    ),
  };
}

function normalizeNavigationAlias(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeAdminLabel(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 120) : "";
}

export function coerceSurveyNavigationTargets(schema: SurveySchema): SurveySchema {
  const aliasMap = new Map<string, string>();

  schema.blocks.forEach((block, index) => {
    const aliases = [
      normalizeNavigationAlias(block.id),
      normalizeNavigationAlias(block.adminLabel),
      normalizeNavigationAlias(block.title),
      String(index + 1),
      `block ${index + 1}`,
      `block-${index + 1}`,
      `question ${index + 1}`,
      `question-${index + 1}`,
      `вопрос ${index + 1}`,
      `вопрос-${index + 1}`,
    ];

    for (const alias of aliases) {
      if (alias && !aliasMap.has(alias)) {
        aliasMap.set(alias, block.id);
      }
    }
  });

  const resolveTarget = (target: string | null | undefined, blockIndex: number) => {
    if (!target) {
      return null;
    }

    const sequentialNext = schema.blocks[blockIndex + 1]?.id ?? null;
    const currentBlockId = schema.blocks[blockIndex]?.id ?? null;
    const normalizedTarget = normalizeNavigationAlias(target);
    if (!normalizedTarget) {
      return null;
    }

    if (
      isFinishSurveyTarget(target) ||
      normalizedTarget === "finish" ||
      normalizedTarget === "complete" ||
      normalizedTarget === "end" ||
      normalizedTarget === "finish survey" ||
      normalizedTarget === "complete survey" ||
      normalizedTarget === "end survey" ||
      normalizedTarget === "закончить" ||
      normalizedTarget === "закончить опрос" ||
      normalizedTarget === "завершить" ||
      normalizedTarget === "завершить опрос"
    ) {
      return FINISH_SURVEY_TARGET;
    }

    const directTarget = schema.blocks.find((block) => block.id === target)?.id;
    if (directTarget) {
      return directTarget;
    }

    if (aliasMap.has(normalizedTarget)) {
      const aliasTarget = aliasMap.get(normalizedTarget) ?? null;
      if (aliasTarget === currentBlockId) {
        return sequentialNext;
      }
      return aliasTarget;
    }

    if (
      normalizedTarget === "next" ||
      normalizedTarget === "next block" ||
      normalizedTarget === "next question" ||
      normalizedTarget === "следующий" ||
      normalizedTarget === "следующий блок" ||
      normalizedTarget === "следующий вопрос"
    ) {
      return sequentialNext;
    }

    const numericMatch = normalizedTarget.match(/\d+/);
    if (numericMatch) {
      const numericTarget = schema.blocks[Number(numericMatch[0]) - 1]?.id ?? null;
      if (numericTarget === currentBlockId) {
        return sequentialNext;
      }
      return numericTarget;
    }

    return null;
  };

  return {
    ...schema,
    blocks: schema.blocks.map((block, index) => {
      const nextBlockId = resolveTarget(block.nextBlockId, index);

      switch (block.type) {
        case "SINGLE_CHOICE":
        case "MULTI_CHOICE":
        case "MEDIA_CHOICE":
        case "DROPDOWN":
          return {
            ...block,
            nextBlockId,
            options: block.options.map((option) => ({
              ...option,
              nextBlockId: resolveTarget(option.nextBlockId, index),
            })),
          };
        case "YES_NO":
          return {
            ...block,
            nextBlockId,
            yesNextBlockId: resolveTarget(block.yesNextBlockId, index),
            noNextBlockId: resolveTarget(block.noNextBlockId, index),
          };
        case "RANKING":
          return {
            ...block,
            nextBlockId,
            items: block.items.map((item) => ({
              ...item,
              nextBlockId: resolveTarget(item.nextBlockId, index),
            })),
          };
        case "COMBINED":
          const inputBlock = block.inputBlock;

          return {
            ...block,
            nextBlockId,
            textNextBlockId: resolveTarget(block.textNextBlockId, index),
            inputBlock:
              inputBlock.type === "SINGLE_CHOICE" ||
              inputBlock.type === "MULTI_CHOICE" ||
              inputBlock.type === "MEDIA_CHOICE" ||
              inputBlock.type === "DROPDOWN"
                ? {
                    ...inputBlock,
                    nextBlockId,
                    options: inputBlock.options.map((option) => ({
                      ...option,
                      nextBlockId: resolveTarget(option.nextBlockId, index),
                    })),
                  }
                : inputBlock.type === "YES_NO"
                  ? {
                      ...inputBlock,
                      nextBlockId,
                      yesNextBlockId: resolveTarget(inputBlock.yesNextBlockId, index),
                      noNextBlockId: resolveTarget(inputBlock.noNextBlockId, index),
                    }
                  : inputBlock.type === "RANKING"
                    ? {
                        ...inputBlock,
                        nextBlockId,
                        items: inputBlock.items.map((item) => ({
                          ...item,
                          nextBlockId: resolveTarget(item.nextBlockId, index),
                        })),
                      }
                    : {
                        ...inputBlock,
                        nextBlockId,
                      },
          };
        default:
          return {
            ...block,
            nextBlockId,
          };
      }
    }),
  };
}

function normalizeCombinedInputBlock(value: unknown, index: number): CombinedInputBlock {
  if (!value || typeof value !== "object" || !isCombinedInputBlockType((value as { type?: unknown }).type)) {
    return createCombinedInputBlock("SINGLE_CHOICE", index + 1);
  }

  return normalizeBlock(value as SurveyBlock, index) as CombinedInputBlock;
}

function normalizeBlock(block: SurveyBlock, index: number): SurveyBlock {
  const fallback = createBlock(block.type, index + 1);
  const base = {
    ...fallback,
    ...block,
    id: block.id || nanoid(10),
    adminLabel: normalizeAdminLabel(block.adminLabel),
    title: block.title?.trim() || fallback.title,
    description: block.description ?? "",
    questionHint: typeof block.questionHint === "string" ? block.questionHint.slice(0, 2000) : "",
    resultLabelOverride: typeof block.resultLabelOverride === "string" ? block.resultLabelOverride : null,
    required: Boolean(block.required),
    nextBlockId: block.nextBlockId ?? null,
    showFinishButton: Boolean(block.showFinishButton),
    showRestartBlockButton: Boolean(block.showRestartBlockButton),
    additionalInfoEnabled: Boolean(block.additionalInfoEnabled),
    additionalInfoItemIds: normalizeAdditionalInfoItemIds(block.additionalInfoItemIds),
    additionalInfoItems: normalizeAdditionalInfoItems(block.additionalInfoItems),
  };

  switch (block.type) {
    case "WELCOME":
      return {
        ...base,
        type: "WELCOME",
        ctaLabel: block.ctaLabel?.trim() || "Начать",
      };
    case "CONTACT":
      return {
        ...base,
        type: "CONTACT",
        fields: normalizeContactFields(block.fields),
        submitLabel: block.submitLabel?.trim() || "Сохранить контакты",
      };
    case "SINGLE_CHOICE":
    case "MULTI_CHOICE":
    case "MEDIA_CHOICE":
    case "DROPDOWN":
      return {
        ...base,
        options: normalizeOptions(block.options),
        ...(block.type === "MULTI_CHOICE"
          ? {
              minSelected: Math.max(block.minSelected ?? 0, 0),
              maxSelected: block.maxSelected ?? null,
            }
          : null),
        ...(block.type === "DROPDOWN"
          ? {
              placeholder: block.placeholder?.trim() || "Выберите вариант",
              allowOtherOption: Boolean(block.allowOtherOption),
              otherOptionLabel: block.otherOptionLabel?.trim() || "Другое",
              otherPlaceholder: block.otherPlaceholder?.trim() || "Введите свой вариант",
            }
          : null),
      } as SingleChoiceBlock | MultiChoiceBlock | MediaChoiceBlock | DropdownBlock;
    case "YES_NO":
      return {
        ...base,
        type: "YES_NO",
        yesLabel: block.yesLabel?.trim() || "Да",
        noLabel: block.noLabel?.trim() || "Нет",
        yesScore: Number.isFinite(block.yesScore) ? block.yesScore : 1,
        noScore: Number.isFinite(block.noScore) ? block.noScore : 0,
        yesNextBlockId: block.yesNextBlockId ?? null,
        noNextBlockId: block.noNextBlockId ?? null,
      } satisfies YesNoBlock;
    case "RATING":
      return {
        ...base,
        type: "RATING",
        scale: clamp(Number(block.scale) || 5, 2, 10),
        icon: block.icon === "heart" ? "heart" : "star",
        minLabel: block.minLabel?.trim() || "Минимум",
        maxLabel: block.maxLabel?.trim() || "Максимум",
        scorePerUnit: Number.isFinite(block.scorePerUnit) ? block.scorePerUnit : 1,
      };
    case "RANKING":
      return {
        ...base,
        type: "RANKING",
        items: normalizeOptions(block.items),
      } satisfies RankingBlock;
    case "SCALE":
      return {
        ...base,
        type: "SCALE",
        min: Number.isFinite(block.min) ? block.min : 1,
        max: Number.isFinite(block.max) ? block.max : 10,
        minLabel: block.minLabel?.trim() || "Минимум",
        maxLabel: block.maxLabel?.trim() || "Максимум",
        scorePerUnit: Number.isFinite(block.scorePerUnit) ? block.scorePerUnit : 1,
      } satisfies ScaleBlock;
    case "SLIDER":
      return {
        ...base,
        type: "SLIDER",
        min: Number.isFinite(block.min) ? block.min : 0,
        max: Number.isFinite(block.max) ? block.max : 10,
        step: Number.isFinite(block.step) ? block.step : 1,
        defaultValue: Number.isFinite(block.defaultValue) ? block.defaultValue : 0,
        minLabel: block.minLabel?.trim() || "0",
        maxLabel: block.maxLabel?.trim() || "10",
        scorePerUnit: Number.isFinite(block.scorePerUnit) ? block.scorePerUnit : 1,
      } satisfies SliderBlock;
    case "TEXT":
      return {
        ...base,
        type: "TEXT",
        placeholder: block.placeholder?.trim() || "Введите ответ",
        multiline: block.multiline ?? true,
        minLength: Number.isFinite(block.minLength) ? Math.max(0, block.minLength) : 0,
        maxLength: Number.isFinite(block.maxLength) ? block.maxLength : 2000,
        allowVoiceAnswer: block.allowVoiceAnswer !== false,
        attachVoiceAnswerToResult: block.attachVoiceAnswerToResult !== false,
        allowFileAnswer: Boolean(block.allowFileAnswer),
      } satisfies TextBlock;
    case "COMBINED": {
      const fallbackCombined = fallback as CombinedBlock;

      return {
        ...base,
        type: "COMBINED",
        inputBlock: normalizeCombinedInputBlock(block.inputBlock ?? fallbackCombined.inputBlock, index),
        textPlaceholder: block.textPlaceholder?.trim() || "Или введите свой ответ",
        textMultiline: block.textMultiline ?? true,
        textMinLength: Number.isFinite(block.textMinLength) ? Math.max(0, block.textMinLength) : 0,
        textMaxLength: Number.isFinite(block.textMaxLength) ? block.textMaxLength : 2000,
        textNextBlockId: block.textNextBlockId ?? null,
      } satisfies CombinedBlock;
    }
  }
}

export function changeSurveyBlockType(block: SurveyBlock, nextType: SurveyBlockType, index = 1): SurveyBlock {
  if (block.type === nextType) {
    return block;
  }

  const fallback = createBlock(nextType, index);
  const converted = {
    ...fallback,
    id: block.id,
    type: nextType,
    adminLabel: block.adminLabel,
    title: block.title,
    description: block.description,
    questionHint: block.questionHint,
    resultLabelOverride: block.resultLabelOverride ?? null,
    required: nextType === "WELCOME" ? false : block.required,
    nextBlockId: block.nextBlockId,
    showFinishButton: block.showFinishButton,
    showRestartBlockButton: block.showRestartBlockButton,
    additionalInfoEnabled: block.additionalInfoEnabled,
    additionalInfoItemIds: block.additionalInfoItemIds,
    additionalInfoItems: block.additionalInfoItems,
  } as SurveyBlock;

  return normalizeBlock(converted, Math.max(0, index - 1));
}

function normalizeOptions(options: ChoiceOption[] | undefined) {
  if (!options?.length) {
    return [createOption("Вариант 1"), createOption("Вариант 2")];
  }

  return options.map((option, index) => ({
    id: option.id || nanoid(10),
    label: option.label?.trim() || `Вариант ${index + 1}`,
    description: option.description ?? "",
    score: Number.isFinite(option.score) ? option.score : 0,
    nextBlockId: option.nextBlockId ?? null,
    mediaAssetId: option.mediaAssetId ?? null,
    mediaUrl: option.mediaUrl ?? null,
  }));
}

function normalizeAdditionalInfoItems(items: AdditionalInfoItem[] | undefined) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.map((item, index) => ({
    id: item?.id || nanoid(10),
    label: item?.label?.trim() || `Пункт ${index + 1}`,
    description: item?.description ?? "",
  }));
}

function normalizeAdditionalInfoItemIds(ids: string[] | undefined) {
  if (!Array.isArray(ids)) {
    return [];
  }

  return Array.from(
    new Set(
      ids
        .map((id) => (typeof id === "string" ? id.trim() : ""))
        .filter(Boolean),
    ),
  );
}

function mergeAdditionalInfoItems(...groups: AdditionalInfoItem[][]) {
  const items = new Map<string, AdditionalInfoItem>();

  groups.flat().forEach((item) => {
    if (items.has(item.id)) {
      return;
    }

    items.set(item.id, item);
  });

  return Array.from(items.values());
}

export function getBlockAdditionalInfoItems(schema: SurveySchema, block: SurveyBlock) {
  if (!block.additionalInfoEnabled) {
    return [];
  }

  const libraryById = new Map(schema.settings.additionalInfoItems.map((item) => [item.id, item] as const));
  const selectedItems = block.additionalInfoItemIds.map((id) => libraryById.get(id)).filter((item): item is AdditionalInfoItem => Boolean(item));

  return selectedItems.length ? selectedItems : block.additionalInfoItems;
}

export function duplicateSurveyBlock(block: SurveyBlock): SurveyBlock {
  const cloned = JSON.parse(JSON.stringify(block)) as SurveyBlock;
  const nextBlockId = nanoid(10);
  const duplicatedAdditionalInfoItems = cloned.additionalInfoItems.map((item, index) => ({
    ...item,
    id: nanoid(10),
    label: item.label?.trim() || `Пункт ${index + 1}`,
    description: item.description ?? "",
  }));

  if (
    cloned.type === "SINGLE_CHOICE" ||
    cloned.type === "MULTI_CHOICE" ||
    cloned.type === "MEDIA_CHOICE" ||
    cloned.type === "DROPDOWN"
  ) {
    return {
      ...cloned,
      id: nextBlockId,
      title: `${cloned.title} (копия)`,
      additionalInfoItems: duplicatedAdditionalInfoItems,
      options: cloned.options.map((option) => ({
        ...option,
        id: nanoid(10),
      })),
    };
  }

  if (cloned.type === "RANKING") {
    return {
      ...cloned,
      id: nextBlockId,
      title: `${cloned.title} (копия)`,
      additionalInfoItems: duplicatedAdditionalInfoItems,
      items: cloned.items.map((item) => ({
        ...item,
        id: nanoid(10),
        score: 0,
      })),
    };
  }

  if (cloned.type === "COMBINED") {
    const duplicatedInputBlock = duplicateSurveyBlock(cloned.inputBlock as SurveyBlock) as CombinedInputBlock;

    return {
      ...cloned,
      id: nextBlockId,
      title: `${cloned.title} (копия)`,
      additionalInfoItems: duplicatedAdditionalInfoItems,
      inputBlock: duplicatedInputBlock,
    };
  }

  return {
    ...cloned,
    id: nextBlockId,
    title: `${cloned.title} (копия)`,
    additionalInfoItems: duplicatedAdditionalInfoItems,
  };
}

export function getNextSequentialBlockId(schema: SurveySchema, blockId: string) {
  const index = schema.blocks.findIndex((block) => block.id === blockId);
  if (index === -1 || index === schema.blocks.length - 1) {
    return null;
  }

  return schema.blocks[index + 1]?.id ?? null;
}

export function canAutoScrollBlock(block: SurveyBlock | CombinedInputBlock) {
  return !AUTO_SCROLL_EXCLUDED.has(block.type);
}

export function validateSurveySchema(schema: SurveySchema) {
  const errors: string[] = [];
  const ids = new Set<string>();
  const allowedTargets = new Set<string>([FINISH_SURVEY_TARGET, ...schema.blocks.map((block) => block.id)]);

  if (!schema.blocks.length) {
    errors.push("Добавьте хотя бы один блок.");
  }

  schema.blocks.forEach((block) => {
    if (ids.has(block.id)) {
      errors.push(`Повторяющийся идентификатор блока: ${block.id}`);
    }
    ids.add(block.id);

    if (block.type === "CONTACT" && !block.fields.some((field) => field.enabled ?? true)) {
      errors.push(`У блока "${block.title}" должен быть включён хотя бы один контакт.`);
    }

    const targets = collectExplicitTargets(block);
    for (const target of targets) {
      if (target && !allowedTargets.has(target)) {
        errors.push(`У блока "${block.title}" ссылка ведёт на несуществующий блок.`);
      }
      if (target && target === block.id) {
        errors.push(`У блока "${block.title}" настроен переход на самого себя.`);
      }
    }
  });

  const adjacency = new Map<string, string[]>();
  schema.blocks.forEach((block) => {
    adjacency.set(
      block.id,
      collectReachableTargets(schema, block).filter((target): target is string => Boolean(target) && !isFinishSurveyTarget(target)),
    );
  });

  const visited = new Set<string>();
  const stack = new Set<string>();

  function visit(node: string) {
    if (stack.has(node)) {
      errors.push("Обнаружен цикл в переходах между вопросами.");
      return;
    }
    if (visited.has(node)) {
      return;
    }

    visited.add(node);
    stack.add(node);
    for (const neighbour of adjacency.get(node) ?? []) {
      visit(neighbour);
    }
    stack.delete(node);
  }

  for (const block of schema.blocks) {
    visit(block.id);
  }

  return Array.from(new Set(errors));
}

function collectExplicitTargets(block: SurveyBlock | CombinedInputBlock): Array<string | null> {
  switch (block.type) {
    case "SINGLE_CHOICE":
    case "MULTI_CHOICE":
    case "MEDIA_CHOICE":
    case "DROPDOWN":
      return block.options.map((option) => option.nextBlockId).concat(block.nextBlockId);
    case "YES_NO":
      return [block.yesNextBlockId, block.noNextBlockId, block.nextBlockId];
    case "COMBINED":
      return collectExplicitTargets(block.inputBlock).concat(block.textNextBlockId, block.nextBlockId);
    default:
      return [block.nextBlockId];
  }
}

function collectReachableTargets(schema: SurveySchema, block: SurveyBlock | CombinedInputBlock): string[] {
  const sequentialNext = getNextSequentialBlockId(schema, block.id);
  const fallbackTarget = block.nextBlockId ?? sequentialNext;

  switch (block.type) {
    case "SINGLE_CHOICE":
    case "MULTI_CHOICE":
    case "MEDIA_CHOICE":
    case "DROPDOWN":
      return Array.from(
        new Set(block.options.map((option) => option.nextBlockId ?? fallbackTarget).filter((target): target is string => Boolean(target))),
      );
    case "YES_NO":
      return Array.from(
        new Set(
          [block.yesNextBlockId ?? fallbackTarget, block.noNextBlockId ?? fallbackTarget].filter((target): target is string =>
            Boolean(target),
          ),
        ),
      );
    case "COMBINED":
      return Array.from(
        new Set(
          collectReachableTargets(schema, {
            ...block.inputBlock,
            nextBlockId: block.nextBlockId,
          })
            .concat([block.textNextBlockId ?? block.nextBlockId ?? sequentialNext].filter((target): target is string => Boolean(target))),
        ),
      );
    default:
      return fallbackTarget ? [fallbackTarget] : [];
  }
}

function normalizeTextAnswerAttachment(value: unknown): TextAnswerAttachment | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const entry = value as Partial<TextAnswerAttachment>;
  if (
    typeof entry.id !== "string" ||
    typeof entry.url !== "string" ||
    typeof entry.originalName !== "string" ||
    typeof entry.filename !== "string" ||
    typeof entry.mimeType !== "string" ||
    typeof entry.byteSize !== "number" ||
    (entry.kind !== "file" && entry.kind !== "voice")
  ) {
    return null;
  }

  return {
    id: entry.id,
    url: entry.url,
    originalName: entry.originalName,
    filename: entry.filename,
    mimeType: entry.mimeType,
    byteSize: entry.byteSize,
    kind: entry.kind,
    transcript: typeof entry.transcript === "string" ? entry.transcript : null,
    transcriptionStatus:
      entry.transcriptionStatus === "completed" ||
      entry.transcriptionStatus === "failed" ||
      entry.transcriptionStatus === "skipped"
        ? entry.transcriptionStatus
        : undefined,
    transcriptionError: typeof entry.transcriptionError === "string" ? entry.transcriptionError : null,
  };
}

export function normalizeTextAnswerValue(value: unknown): TextAnswerValue {
  if (typeof value === "string") {
    return {
      text: value,
      attachments: [],
    };
  }

  if (!value || typeof value !== "object") {
    return {
      text: "",
      attachments: [],
    };
  }

  const payload = value as { text?: unknown; attachments?: unknown };

  return {
    text: typeof payload.text === "string" ? payload.text : "",
    attachments: Array.isArray(payload.attachments)
      ? payload.attachments
          .map(normalizeTextAnswerAttachment)
          .filter((attachment): attachment is TextAnswerAttachment => Boolean(attachment))
      : [],
  };
}

export function textAnswerHasFileAttachment(value: unknown) {
  return normalizeTextAnswerValue(value).attachments.some((attachment) => attachment.kind === "file");
}

function textAnswerHasVoiceAttachment(value: unknown) {
  return normalizeTextAnswerValue(value).attachments.some((attachment) => attachment.kind === "voice");
}

export function isTextAnswerBelowMinimum(block: TextBlock, value: unknown) {
  if (textAnswerHasFileAttachment(value)) {
    return false;
  }

  const length = normalizeTextAnswerValue(value).text.trim().length;

  return block.minLength > 0 && (length > 0 || textAnswerHasVoiceAttachment(value)) && length < block.minLength;
}

function formatBytes(value: number) {
  if (value >= 1024 * 1024) {
    return `${(value / 1024 / 1024).toFixed(1)} МБ`;
  }

  return `${Math.max(1, Math.round(value / 1024))} КБ`;
}

function stringifyTextAnswerValue(value: unknown) {
  const normalized = normalizeTextAnswerValue(value);
  const lines: string[] = [];
  const text = normalized.text.trim();

  if (text) {
    lines.push(text);
  }

  normalized.attachments.forEach((attachment) => {
    const label = attachment.kind === "voice" ? "Голосовой ответ" : "Файл";
    lines.push(`${label}: ${attachment.originalName} (${formatBytes(attachment.byteSize)}) ${attachment.url}`);
    const transcript = attachment.transcript?.trim() ?? "";
    if (attachment.kind === "voice" && transcript && !text.includes(transcript)) {
      lines.push(`Расшифровка голосового ответа: ${transcript}`);
    }
  });

  return lines.join("\n");
}

export const UNANSWERED_AVERAGE_ANSWER_LABEL = "Не отвечено (начислен средний балл)";

function getDefaultNextBlockId(schema: SurveySchema, block: SurveyBlock | CombinedInputBlock) {
  const sequentialNext = getNextSequentialBlockId(schema, block.id);

  return block.nextBlockId ?? sequentialNext;
}

export function evaluateUnansweredAverageAnswer(schema: SurveySchema, block: SurveyBlock): EvaluatedAnswer {
  const maxScore = schema.settings.scoringEnabled ? calculateBlockMaxScore(block) : 0;

  return {
    blockId: block.id,
    blockType: block.type,
    prompt: stripRichTextTokens(block.title),
    value: UNANSWERED_AVERAGE_ANSWER_LABEL,
    score: Math.max(0, Math.round(maxScore / 2)),
    nextBlockId: getDefaultNextBlockId(schema, block),
  };
}

export function evaluateAnswer(schema: SurveySchema, block: SurveyBlock, value: unknown): EvaluatedAnswer {
  const sequentialNext = getNextSequentialBlockId(schema, block.id);
  const scoringEnabled = schema.settings.scoringEnabled;
  const prompt = stripRichTextTokens(block.title);

  switch (block.type) {
    case "WELCOME":
      return {
        blockId: block.id,
        blockType: block.type,
        prompt,
        value: stripRichTextTokens(block.ctaLabel),
        score: 0,
        nextBlockId: block.nextBlockId ?? sequentialNext,
      };
    case "CONTACT": {
      const submitted = (value && typeof value === "object" ? value : {}) as ContactAnswerValue;
      return {
        blockId: block.id,
        blockType: block.type,
        prompt,
        value: submitted,
        score: 0,
        nextBlockId: block.nextBlockId ?? sequentialNext,
        respondentData: submitted,
      };
    }
    case "SINGLE_CHOICE":
    case "MEDIA_CHOICE": {
      const option = block.options.find((item) => item.id === value);
      return {
        blockId: block.id,
        blockType: block.type,
        prompt,
        value: stripRichTextTokens(option?.label ?? ""),
        score: scoringEnabled ? option?.score ?? 0 : 0,
        nextBlockId: option?.nextBlockId ?? block.nextBlockId ?? sequentialNext,
      };
    }
    case "DROPDOWN": {
      const dropdownValue = normalizeDropdownAnswerValue(value);
      if (isDropdownOtherAnswerValue(dropdownValue) && block.allowOtherOption) {
        return {
          blockId: block.id,
          blockType: block.type,
          prompt,
          value: `${stripRichTextTokens(block.otherOptionLabel || "Другое")}: ${dropdownValue.otherText.trim()}`,
          score: 0,
          nextBlockId: block.nextBlockId ?? sequentialNext,
        };
      }

      const option = block.options.find((item) => item.id === dropdownValue);
      return {
        blockId: block.id,
        blockType: block.type,
        prompt,
        value: stripRichTextTokens(option?.label ?? ""),
        score: scoringEnabled ? option?.score ?? 0 : 0,
        nextBlockId: option?.nextBlockId ?? block.nextBlockId ?? sequentialNext,
      };
    }
    case "MULTI_CHOICE": {
      const selectedIds = Array.isArray(value) ? value : [];
      const options = block.options.filter((item) => selectedIds.includes(item.id));
      const nextTarget = options.find((option) => option.nextBlockId)?.nextBlockId ?? block.nextBlockId ?? sequentialNext;
      return {
        blockId: block.id,
        blockType: block.type,
        prompt,
        value: options.map((option) => stripRichTextTokens(option.label)),
        score: scoringEnabled ? options.reduce((sum, option) => sum + option.score, 0) : 0,
        nextBlockId: nextTarget,
      };
    }
    case "YES_NO": {
      const normalized = value === true || value === "yes" ? "yes" : "no";
      return {
        blockId: block.id,
        blockType: block.type,
        prompt,
        value: stripRichTextTokens(normalized === "yes" ? block.yesLabel : block.noLabel),
        score: scoringEnabled ? (normalized === "yes" ? block.yesScore : block.noScore) : 0,
        nextBlockId:
          normalized === "yes"
            ? block.yesNextBlockId ?? block.nextBlockId ?? sequentialNext
            : block.noNextBlockId ?? block.nextBlockId ?? sequentialNext,
      };
    }
    case "RATING":
      return {
        blockId: block.id,
        blockType: block.type,
        prompt,
        value,
        score: scoringEnabled ? Math.max(Number(value) || 0, 0) * block.scorePerUnit : 0,
        nextBlockId: block.nextBlockId ?? sequentialNext,
      };
    case "RANKING": {
      const rankedIds = Array.isArray(value) ? value : [];
      const labels = rankedIds
        .map((id, index) => {
          const option = block.items.find((item) => item.id === id);
          if (!option) {
            return null;
          }

          return {
            label: `${index + 1}. ${stripRichTextTokens(option.label)}`,
          };
        })
        .filter(Boolean) as { label: string }[];

      return {
        blockId: block.id,
        blockType: block.type,
        prompt,
        value: labels.map((item) => item.label),
        score: 0,
        nextBlockId: block.nextBlockId ?? sequentialNext,
      };
    }
    case "SCALE":
      return {
        blockId: block.id,
        blockType: block.type,
        prompt,
        value,
        score: scoringEnabled ? Math.max(Number(value) || 0, 0) * block.scorePerUnit : 0,
        nextBlockId: block.nextBlockId ?? sequentialNext,
      };
    case "SLIDER":
      return {
        blockId: block.id,
        blockType: block.type,
        prompt,
        value,
        score: scoringEnabled ? Math.max(Number(value) || 0, 0) * block.scorePerUnit : 0,
        nextBlockId: block.nextBlockId ?? sequentialNext,
      };
    case "TEXT":
      return {
        blockId: block.id,
        blockType: block.type,
        prompt,
        value: stringifyTextAnswerValue(value),
        score: 0,
        nextBlockId: block.nextBlockId ?? sequentialNext,
      };
    case "COMBINED": {
      const answer = normalizeCombinedAnswerValue(value);
      const runtimeInputBlock = {
        ...block.inputBlock,
        nextBlockId: block.nextBlockId,
      } as CombinedInputBlock;
      const hasSelectedAnswer = isBlockAnswered(runtimeInputBlock as SurveyBlock, answer.selectedValue);
      const text = answer.text.trim();
      const selectedAnswer = hasSelectedAnswer
        ? evaluateAnswer(schema, runtimeInputBlock as SurveyBlock, answer.selectedValue)
        : null;
      const valueParts = [
        selectedAnswer ? stringifyAnswerValue(selectedAnswer.value, selectedAnswer.blockType) : "",
        text,
      ].filter(Boolean);

      return {
        blockId: block.id,
        blockType: block.type,
        prompt,
        value: valueParts.join("\n") || "",
        score: selectedAnswer ? selectedAnswer.score : 0,
        nextBlockId: selectedAnswer?.nextBlockId ?? block.textNextBlockId ?? block.nextBlockId ?? sequentialNext,
      };
    }
  }
}

export function isBlockAnswered(block: SurveyBlock, value: unknown) {
  switch (block.type) {
    case "WELCOME":
      return true;
    case "CONTACT": {
      const submitted = (value && typeof value === "object" ? value : {}) as Record<string, string>;
      return block.fields.every((field) => !(field.enabled ?? true) || !field.required || Boolean(submitted[field.id]?.trim()));
    }
    case "SINGLE_CHOICE":
    case "MEDIA_CHOICE":
      return typeof value === "string" && value.length > 0;
    case "DROPDOWN": {
      const dropdownValue = normalizeDropdownAnswerValue(value);
      if (isDropdownOtherAnswerValue(dropdownValue)) {
        return block.allowOtherOption && dropdownValue.otherText.trim().length > 0;
      }

      return typeof dropdownValue === "string" && dropdownValue.length > 0;
    }
    case "MULTI_CHOICE":
      return Array.isArray(value) && value.length > 0;
    case "YES_NO":
      return value === "yes" || value === "no" || typeof value === "boolean";
    case "RATING":
    case "SCALE":
    case "SLIDER":
      return Number.isFinite(Number(value));
    case "RANKING":
      return Array.isArray(value) && value.length === block.items.length;
    case "TEXT":
      {
        const answer = normalizeTextAnswerValue(value);
        if (textAnswerHasFileAttachment(value)) {
          return true;
        }

        if (block.minLength > 0) {
          return answer.text.trim().length >= block.minLength;
        }

        return answer.text.trim().length > 0 || answer.attachments.some((attachment) => attachment.kind === "voice");
      }
    case "COMBINED": {
      const answer = normalizeCombinedAnswerValue(value);
      const hasSelectedAnswer = isBlockAnswered(block.inputBlock as SurveyBlock, answer.selectedValue);
      const textLength = answer.text.trim().length;

      if (hasSelectedAnswer) {
        return true;
      }

      if (block.textMinLength > 0) {
        return textLength >= block.textMinLength;
      }

      return textLength > 0;
    }
  }
}

export function isCombinedTextBelowMinimum(block: CombinedBlock, value: unknown) {
  const answer = normalizeCombinedAnswerValue(value);
  const textLength = answer.text.trim().length;

  return block.textMinLength > 0 && textLength > 0 && textLength < block.textMinLength;
}

const RICH_TEXT_ANSWER_BLOCK_TYPES = new Set<SurveyBlockType>([
  "WELCOME",
  "SINGLE_CHOICE",
  "MULTI_CHOICE",
  "MEDIA_CHOICE",
  "YES_NO",
  "DROPDOWN",
  "RANKING",
]);

export function stringifyAnswerValue(value: unknown, blockType?: SurveyBlockType) {
  const stripAnswerRichText = blockType ? RICH_TEXT_ANSWER_BLOCK_TYPES.has(blockType) : false;

  if (blockType === "RATING" && Number.isFinite(Number(value))) {
    return `${Number(value)} условных единиц`;
  }

  if ((blockType === "SCALE" || blockType === "SLIDER") && Number.isFinite(Number(value))) {
    return String(Number(value));
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => (stripAnswerRichText ? stripRichTextTokens(String(entry)) : String(entry)))
      .join(", ");
  }

  if (value && typeof value === "object") {
    if (blockType === "CONTACT") {
      return formatContactAnswerValue(value as Record<string, unknown>);
    }

    return Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => {
        if (Array.isArray(entry)) {
          return entry.length > 0;
        }

        return Boolean(entry);
      })
      .sort(([leftKey], [rightKey]) => {
        const leftOrder = CONTACT_VALUE_ORDER.get(leftKey) ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = CONTACT_VALUE_ORDER.get(rightKey) ?? Number.MAX_SAFE_INTEGER;

        if (leftOrder !== rightOrder) {
          return leftOrder - rightOrder;
        }

        return leftKey.localeCompare(rightKey, "ru");
      })
      .map(([key, entry]) => {
        const label = CONTACT_VALUE_LABELS[key] ?? key;
        const formattedEntry = Array.isArray(entry) ? entry.join(", ") : String(entry);
        return `${label}: ${formattedEntry}`;
      })
      .join("; ");
  }

  if (value == null) {
    return "";
  }

  return stripAnswerRichText ? stripRichTextTokens(String(value)) : String(value);
}

export function mapAnswersToRows(
  answers: { blockId: string; blockType: SurveyBlockType; prompt: string; value: unknown; score: number }[],
): SurveyAnswerRow[] {
  return answers.map((answer) => ({
    blockId: answer.blockId,
    blockType: answer.blockType,
    prompt: stripRichTextTokens(answer.prompt),
    value: stringifyAnswerValue(answer.value, answer.blockType),
    score: answer.score,
  }));
}
