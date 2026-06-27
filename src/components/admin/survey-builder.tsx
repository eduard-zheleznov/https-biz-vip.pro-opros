"use client";

import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  GripVertical,
  LoaderCircle,
  PencilLine,
  Plus,
  Save,
  Trash2,
  Upload,
} from "lucide-react";
import Link from "next/link";
import type React from "react";
import { startTransition, useEffect, useEffectEvent, useMemo, useRef, useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RichTextTextarea } from "@/components/admin/rich-text-textarea";
import { MobileTextOverrideButton } from "@/components/admin/mobile-text-override-button";
import { appAbsoluteUrl, withBasePath } from "@/lib/base-path";
import { normalizePublicSlugInput } from "@/lib/public-slug";
import {
  BLOCK_GROUPS,
  BLOCK_LABELS,
  changeSurveyBlockType,
  coerceSurveyNavigationTargets,
  createBlock,
  duplicateSurveyBlock,
  FINISH_SURVEY_TARGET,
  isCombinedInputBlockType,
  normalizeSurveySchema,
  validateSurveySchema,
} from "@/lib/survey-schema";
import { stripRichTextTokens } from "@/lib/rich-text";
import { cn, formatSurveyLifecycleStatus } from "@/lib/utils";
import type {
  AdditionalInfoItem,
  ChoiceOption,
  CombinedInputBlock,
  CombinedInputBlockType,
  ContactField,
  MobileTextOverrideKey,
  MobileTextOverrides,
  SurveyBlock,
  SurveySchema,
  SurveyBlockType,
} from "@/types/surveys";

type SurveyBuilderProps = {
  surveyId: string;
  initialSchema: SurveySchema;
  publicSlug: string;
  lifecycleStatus: string;
  currentVersionNumber: number;
};

type SaveStatus = "idle" | "saving" | "saved" | "error";

type BuilderUiState = {
  expandedBlocks: Record<string, boolean>;
  expandedAdditionalInfo: Record<string, boolean>;
};

function Select({
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100",
        className,
      )}
      {...props}
    />
  );
}

function Checkbox({
  label,
  checked,
  onChange,
  hint,
  className,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
  className?: string;
}) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3", className)}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
      />
      <span className="space-y-1">
        <span className="block text-sm font-medium text-slate-900">{label}</span>
        {hint ? <span className="block text-xs text-slate-500">{hint}</span> : null}
      </span>
    </label>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{children}</p>;
}

function readMobileTextOverride(
  source: { mobileTextOverrides?: MobileTextOverrides },
  key: MobileTextOverrideKey,
) {
  return source.mobileTextOverrides?.[key] ?? "";
}

function writeMobileTextOverride<T extends { mobileTextOverrides?: MobileTextOverrides }>(
  source: T,
  key: MobileTextOverrideKey,
  value: string,
): T {
  const nextOverrides = { ...(source.mobileTextOverrides ?? {}) };

  if (value.trim()) {
    nextOverrides[key] = value;
  } else {
    delete nextOverrides[key];
  }

  return {
    ...source,
    mobileTextOverrides: nextOverrides,
  };
}

function createDraftOption(nextIndex: number): ChoiceOption {
  const generatedId =
    globalThis.crypto?.randomUUID?.() ??
    `option-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  return {
    id: generatedId,
    label: `Вариант ${nextIndex}`,
    description: "",
    mobileTextOverrides: {},
    score: 0,
    nextBlockId: null,
    mediaAssetId: null,
    mediaUrl: null,
  };
}

function createDraftAdditionalInfoItem(nextIndex: number): AdditionalInfoItem {
  const generatedId =
    globalThis.crypto?.randomUUID?.() ??
    `info-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  return {
    id: generatedId,
    label: `Пункт ${nextIndex}`,
    description: "",
    mobileTextOverrides: {},
  };
}

function getBlockAdminLabel(block: SurveyBlock, blockIndex: number) {
  const adminLabel = typeof block.adminLabel === "string" ? block.adminLabel.trim() : "";
  return adminLabel || `Блок ${blockIndex + 1}`;
}

function formatBlockTargetLabel(block: SurveyBlock, blockIndex: number) {
  const adminLabel = getBlockAdminLabel(block, blockIndex);
  const publicTitle = stripRichTextTokens(block.title).trim();

  return publicTitle && publicTitle !== adminLabel ? `${adminLabel} — ${publicTitle}` : adminLabel;
}

function createEmptyBuilderUiState(): BuilderUiState {
  return {
    expandedBlocks: {},
    expandedAdditionalInfo: {},
  };
}

function readBuilderUiState(storageKey: string): BuilderUiState {
  if (typeof window === "undefined") {
    return createEmptyBuilderUiState();
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return createEmptyBuilderUiState();
    }

    const parsed = JSON.parse(raw) as Partial<BuilderUiState>;
    return {
      expandedBlocks: parsed.expandedBlocks ?? {},
      expandedAdditionalInfo: parsed.expandedAdditionalInfo ?? {},
    };
  } catch {
    return createEmptyBuilderUiState();
  }
}

function trimBuilderUiState(uiState: BuilderUiState, blockIds: string[]): BuilderUiState {
  const ids = new Set(blockIds);
  const filterRecord = (record: Record<string, boolean>) =>
    Object.fromEntries(Object.entries(record).filter(([id]) => ids.has(id)));

  return {
    expandedBlocks: filterRecord(uiState.expandedBlocks),
    expandedAdditionalInfo: filterRecord(uiState.expandedAdditionalInfo),
  };
}

const CONTACT_FIELD_TEMPLATES: Array<{
  id: ContactField["id"];
  label: string;
  placeholder: string;
  required: boolean;
  hint?: string;
}> = [
  { id: "fullName", label: "Имя и фамилия", placeholder: "Иван Иванов", required: true },
  { id: "email", label: "Электронная почта", placeholder: "name@example.com", required: false },
  {
    id: "phone",
    label: "Телефон",
    placeholder: "+7 999 000-00-00",
    required: false,
    hint: "Если поле включено, в публичном опросе рядом с телефоном появятся мессенджеры.",
  },
  { id: "company", label: "Компания", placeholder: "Название компании", required: false },
];

function buildContactFields(fields: ContactField[]): ContactField[] {
  const sourceMap = new Map(fields.map((field) => [field.id, field] as const));

  return CONTACT_FIELD_TEMPLATES.map((template) => {
    const field = sourceMap.get(template.id);

    return {
      id: template.id,
      label: field?.label || template.label,
      placeholder: field?.placeholder ?? template.placeholder,
      mobileTextOverrides: field?.mobileTextOverrides ?? {},
      required: field?.required ?? template.required,
      enabled: field?.enabled ?? Boolean(field),
    };
  });
}

const COMBINED_INPUT_TYPE_OPTIONS: CombinedInputBlockType[] = [
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

function renderNavigationTargetOptions(
  nextBlockOptions: { id: string; title: string }[],
  options?: { finishLabel?: string },
) {
  return (
    <>
      <option value="">Следующий по порядку</option>
      <option value={FINISH_SURVEY_TARGET}>{options?.finishLabel ?? "Закончить опрос"}</option>
      {nextBlockOptions.map((nextOption) => (
        <option key={nextOption.id} value={nextOption.id}>
          {stripRichTextTokens(nextOption.title)}
        </option>
      ))}
    </>
  );
}

function SortableOption({
  option,
  onChange,
  onDelete,
  nextBlockOptions,
  onUpload,
  isMedia,
  showScore,
}: {
  option: ChoiceOption;
  onChange: (next: ChoiceOption) => void;
  onDelete: () => void;
  nextBlockOptions: { id: string; title: string }[];
  onUpload: (file: File) => Promise<void>;
  isMedia: boolean;
  showScore: boolean;
}) {
  const [isUploading, startUploadTransition] = useTransition();
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: option.id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className="min-w-0 rounded-3xl border border-slate-200 bg-white p-3 sm:p-4"
    >
      <div className="mb-3 flex items-start justify-between gap-2 sm:gap-3">
        <button
          type="button"
          className="mt-1 rounded-xl p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="grid min-w-0 flex-1 gap-3 md:grid-cols-2">
          <RichTextTextarea
            value={option.label}
            onChange={(nextValue) => onChange({ ...option, label: nextValue })}
            mobileTextOverride={{
              label: "Текст варианта",
              value: readMobileTextOverride(option, "label"),
              onChange: (nextValue) => onChange(writeMobileTextOverride(option, "label", nextValue)),
            }}
            placeholder="Текст варианта"
            rows={2}
            className="min-h-[72px]"
          />
          {showScore ? (
            <Input
              value={option.score}
              onChange={(event) =>
                onChange({
                  ...option,
                  score: Number(event.target.value) || 0,
                })
              }
              type="number"
              placeholder="Баллы"
            />
          ) : (
            <div className="hidden">
              Для ранжирования баллы не настраиваются
            </div>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={onDelete} className="text-rose-500 hover:bg-rose-50 hover:text-rose-600">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-[1.4fr,1fr]">
        <RichTextTextarea
          value={option.description}
          onChange={(nextValue) => onChange({ ...option, description: nextValue })}
          mobileTextOverride={{
            label: "Подпись варианта",
            value: readMobileTextOverride(option, "description"),
            onChange: (nextValue) => onChange(writeMobileTextOverride(option, "description", nextValue)),
          }}
          placeholder="Подпись или пояснение"
          rows={2}
          className="min-h-[72px]"
        />
        <Select
          value={option.nextBlockId ?? ""}
          onChange={(event) => onChange({ ...option, nextBlockId: event.target.value || null })}
        >
          <option value={FINISH_SURVEY_TARGET}>Закончить опрос</option>
          <option value="">Следующий по порядку</option>
          {nextBlockOptions.map((nextOption) => (
            <option key={nextOption.id} value={nextOption.id}>
              {stripRichTextTokens(nextOption.title)}
            </option>
          ))}
        </Select>
      </div>

      {isMedia ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3">
          {option.mediaUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={option.mediaUrl} alt={option.label} className="h-16 w-20 rounded-2xl object-cover" />
          ) : (
            <div className="flex h-16 w-20 items-center justify-center rounded-2xl border border-dashed border-slate-300 text-xs text-slate-400">
              Без медиа
            </div>
          )}
          <Button
            variant="secondary"
            size="sm"
            disabled={isUploading}
            onClick={() => {
              const picker = document.createElement("input");
              picker.type = "file";
              picker.accept = "image/*";
              picker.onchange = () => {
                const file = picker.files?.[0];
                if (!file) {
                  return;
                }

                startUploadTransition(async () => {
                  await onUpload(file);
                });
              };
              picker.click();
            }}
          >
            {isUploading ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            Загрузить
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function AdditionalInfoEditor({
  item,
  itemIndex,
  totalItems,
  onChange,
  onMove,
  onDelete,
}: {
  item: AdditionalInfoItem;
  itemIndex: number;
  totalItems: number;
  onChange: (next: AdditionalInfoItem) => void;
  onMove: (direction: "up" | "down") => void;
  onDelete: () => void;
}) {
  return (
    <div className="space-y-3 rounded-3xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <SectionLabel>Кнопка</SectionLabel>
          <div className="flex items-center gap-2">
            <Input
              value={item.label}
              onChange={(event) => onChange({ ...item, label: event.target.value })}
              placeholder={`Пункт ${itemIndex + 1}`}
            />
            <MobileTextOverrideButton
              label="Кнопка доп. информации"
              sourceValue={item.label}
              value={readMobileTextOverride(item, "label")}
              onChange={(nextValue) => onChange(writeMobileTextOverride(item, "label", nextValue))}
            />
          </div>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={itemIndex === 0}
            onClick={() => onMove("up")}
            className="h-9 w-9 px-0"
          >
            {"\u2191"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={itemIndex === totalItems - 1}
            onClick={() => onMove("down")}
            className="h-9 w-9 px-0"
          >
            {"\u2193"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
          className="shrink-0 text-rose-500 hover:bg-rose-50 hover:text-rose-600"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Удалить
          </Button>
        </div>
      </div>

      <div>
        <SectionLabel>Описание</SectionLabel>
        <RichTextTextarea
          value={item.description}
          onChange={(nextValue) => onChange({ ...item, description: nextValue })}
          mobileTextOverride={{
            label: "Описание доп. информации",
            value: readMobileTextOverride(item, "description"),
            onChange: (nextValue) => onChange(writeMobileTextOverride(item, "description", nextValue)),
          }}
          rows={4}
          placeholder="Текст, который увидит респондент после нажатия на кнопку"
        />
      </div>
    </div>
  );
}

function SortableBlock({
  block,
  blockIndex,
  expanded,
  additionalInfoExpanded,
  surveyAdditionalInfoItems,
  nextBlockOptions,
  onChange,
  onDelete,
  onDuplicate,
  onOptionUpload,
  onExpandedChange,
  onAdditionalInfoExpandedChange,
  scoringEnabled,
}: {
  block: SurveyBlock;
  blockIndex: number;
  expanded: boolean;
  additionalInfoExpanded: boolean;
  surveyAdditionalInfoItems: AdditionalInfoItem[];
  scoringEnabled: boolean;
  nextBlockOptions: { id: string; title: string }[];
  onChange: (next: SurveyBlock) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onOptionUpload: (optionId: string, file: File) => Promise<void>;
  onExpandedChange: (expanded: boolean) => void;
  onAdditionalInfoExpandedChange: (expanded: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: block.id,
  });
  const [resultLabelEditorOpen, setResultLabelEditorOpen] = useState(false);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const resultLabelOverrideActive = block.resultLabelOverride != null;
  const resultLabelInputValue = resultLabelOverrideActive ? (block.resultLabelOverride ?? "") : stripRichTextTokens(block.title);

  const optionTargetChoices = nextBlockOptions.filter((option) => option.id !== block.id);
  const answerBlock = block.type === "COMBINED" ? block.inputBlock : block;

  const updateAnswerBlock = (nextAnswerBlock: CombinedInputBlock | SurveyBlock) => {
    if (block.type === "COMBINED") {
      onChange({ ...block, inputBlock: nextAnswerBlock as CombinedInputBlock });
      return;
    }

    onChange(nextAnswerBlock as SurveyBlock);
  };

  const updateOptions = (nextOptions: ChoiceOption[]) => {
    if (
      answerBlock.type === "SINGLE_CHOICE" ||
      answerBlock.type === "MULTI_CHOICE" ||
      answerBlock.type === "MEDIA_CHOICE" ||
      answerBlock.type === "DROPDOWN"
    ) {
      updateAnswerBlock({ ...answerBlock, options: nextOptions });
    }

    if (answerBlock.type === "RANKING") {
      updateAnswerBlock({ ...answerBlock, items: nextOptions });
    }
  };
  const selectedAdditionalInfoIds = block.additionalInfoItemIds.filter((id) =>
    surveyAdditionalInfoItems.some((item) => item.id === id),
  );
  const selectedAdditionalInfoItems = selectedAdditionalInfoIds
    .map((id) => surveyAdditionalInfoItems.find((item) => item.id === id))
    .filter((item): item is AdditionalInfoItem => Boolean(item));
  const updateSelectedAdditionalInfoIds = (nextIds: string[]) => {
    onChange({ ...block, additionalInfoItemIds: Array.from(new Set(nextIds)) });
  };
  const updateAdditionalInfoItems = (nextItems: AdditionalInfoItem[]) => {
    onChange({ ...block, additionalInfoItems: nextItems });
  };

  const currentOptions =
    answerBlock.type === "SINGLE_CHOICE" ||
    answerBlock.type === "MULTI_CHOICE" ||
    answerBlock.type === "MEDIA_CHOICE" ||
    answerBlock.type === "DROPDOWN"
      ? answerBlock.options
      : answerBlock.type === "RANKING"
        ? answerBlock.items
        : [];
  const contactFields = block.type === "CONTACT" ? buildContactFields(block.fields) : [];
  const canManageOptions =
    answerBlock.type === "SINGLE_CHOICE" ||
    answerBlock.type === "MULTI_CHOICE" ||
    answerBlock.type === "MEDIA_CHOICE" ||
    answerBlock.type === "DROPDOWN" ||
    answerBlock.type === "RANKING";

  const optionDndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const blockAdminLabel = getBlockAdminLabel(block, blockIndex);

  return (
    <div ref={setNodeRef} style={style} className="min-w-0">
      <Card className="overflow-hidden border-slate-200">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-4">
        <button
          type="button"
          className="shrink-0 rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onExpandedChange(!expanded)}
          className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden text-left"
        >
          <span className="shrink-0 rounded-2xl bg-slate-900 px-3 py-1 text-xs font-semibold text-white">{blockAdminLabel}</span>
          <span className="shrink-0 rounded-2xl bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">{BLOCK_LABELS[block.type]}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-900">{stripRichTextTokens(block.title)}</p>
            <p className="truncate text-xs text-slate-500">
              {block.required ? "Обязательный вопрос" : "Можно пропустить"}
            </p>
          </div>
          {expanded ? <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-slate-400" /> : <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-slate-400" />}
        </button>
        <Button variant="ghost" size="sm" onClick={onDuplicate} className="shrink-0">
          <Copy className="mr-2 h-4 w-4" />
          Дубль
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setResultLabelEditorOpen((current) => !current);
            if (!expanded) {
              onExpandedChange(true);
            }
          }}
          className={cn("shrink-0", resultLabelOverrideActive ? "text-sky-700 hover:text-sky-800" : null)}
          title="Изменить подпись для Telegram и копирования"
        >
          <PencilLine className="mr-2 h-4 w-4" />
          Telegram/копия
        </Button>
        <Button variant="ghost" size="sm" onClick={onDelete} className="shrink-0 text-rose-500 hover:bg-rose-50 hover:text-rose-600">
          <Trash2 className="mr-2 h-4 w-4" />
          Удалить
        </Button>
      </div>

        {expanded ? (
          <div className="space-y-6 px-4 py-5 sm:px-5">
          <div className="grid gap-4 lg:grid-cols-[220px_260px_260px]">
            <div>
              <SectionLabel>Служебная подпись</SectionLabel>
              <Input
                value={block.adminLabel ?? ""}
                onChange={(event) => onChange({ ...block, adminLabel: event.target.value })}
                placeholder={`Блок ${blockIndex + 1}`}
              />
              <p className="mt-2 text-xs leading-5 text-slate-500">
                Видно только в настройках и списках переходов.
              </p>
            </div>
            <div>
              <SectionLabel>Формат блока</SectionLabel>
              <Select
                value={block.type}
                onChange={(event) => onChange(changeSurveyBlockType(block, event.target.value as SurveyBlockType, blockIndex + 1))}
              >
                {BLOCK_GROUPS.map((group) => (
                  <optgroup key={group.id} label={group.label}>
                    {group.blockTypes.map((type) => (
                      <option key={type} value={type}>
                        {BLOCK_LABELS[type]}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                Заголовок, описание, доп. информация и кнопки сохранятся. Поля ответа сбросятся под новый формат.
              </p>
            </div>
            <div>
              <SectionLabel>Следующий блок</SectionLabel>
              <Select
                value={block.nextBlockId ?? ""}
                onChange={(event) => onChange({ ...block, nextBlockId: event.target.value || null })}
              >
                <option value={FINISH_SURVEY_TARGET}>Закончить опрос</option>
                <option value="">Следующий по порядку</option>
                {optionTargetChoices.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.title}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div>
            <SectionLabel>Заголовок</SectionLabel>
            <RichTextTextarea
              value={block.title}
              onChange={(nextValue) => onChange({ ...block, title: nextValue })}
              mobileTextOverride={{
                label: "Заголовок",
                value: readMobileTextOverride(block, "title"),
                onChange: (nextValue) => onChange(writeMobileTextOverride(block, "title", nextValue)),
              }}
              rows={6}
              className="min-h-[190px]"
            />
          </div>

          {resultLabelEditorOpen || resultLabelOverrideActive ? (
            <div className="rounded-[24px] border border-sky-100 bg-sky-50/50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <SectionLabel>Telegram и копирование</SectionLabel>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onChange({ ...block, resultLabelOverride: null })}
                  className="text-slate-500"
                >
                  Сбросить по умолчанию
                </Button>
              </div>
              <Input
                value={resultLabelInputValue}
                onChange={(event) => onChange({ ...block, resultLabelOverride: event.target.value })}
                placeholder="По умолчанию используется текущий заголовок вопроса"
              />
              <p className="mt-2 text-xs leading-5 text-slate-500">
                В сервисе результат останется с обычным вопросом. Здесь меняется только подпись для Telegram и кнопки
                копирования. Если стереть текст полностью, этот ответ не попадёт в Telegram и копируемый результат.
              </p>
            </div>
          ) : null}

          <div>
            <SectionLabel>Описание</SectionLabel>
            <RichTextTextarea
              value={block.description}
              onChange={(nextValue) => onChange({ ...block, description: nextValue })}
              mobileTextOverride={{
                label: "Описание",
                value: readMobileTextOverride(block, "description"),
                onChange: (nextValue) => onChange(writeMobileTextOverride(block, "description", nextValue)),
              }}
              rows={3}
            />
          </div>

          <div>
            <SectionLabel>Пояснение к вопросу</SectionLabel>
            <RichTextTextarea
              value={block.questionHint}
              onChange={(nextValue) => onChange({ ...block, questionHint: nextValue })}
              mobileTextOverride={{
                label: "Пояснение к вопросу",
                value: readMobileTextOverride(block, "questionHint"),
                onChange: (nextValue) => onChange(writeMobileTextOverride(block, "questionHint", nextValue)),
              }}
              rows={3}
              placeholder="Если заполнить, рядом с заголовком появится иконка информации с подсказкой."
            />
          </div>

          <div className="space-y-3 rounded-[28px] border border-slate-200 bg-slate-50/60 p-4">
            <Checkbox
              label="Дополнительная информация"
              checked={block.additionalInfoEnabled}
              onChange={(checked) => {
                onChange({
                  ...block,
                  additionalInfoEnabled: checked,
                  additionalInfoItemIds: block.additionalInfoItemIds,
                });

                if (checked) {
                  onAdditionalInfoExpandedChange(true);
                }
              }}
              hint="Под вопросом появятся кнопки с подсказками. По клику откроется описание, не перекрывая сам опрос."
            />

            {block.additionalInfoEnabled ? (
              <div className="space-y-3 rounded-[24px] border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                    {"Кнопки из общей библиотеки"}
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onAdditionalInfoExpandedChange(!additionalInfoExpanded)}
                  >
                    {additionalInfoExpanded ? <ChevronDown className="mr-2 h-4 w-4" /> : <ChevronRight className="mr-2 h-4 w-4" />}
                    {additionalInfoExpanded ? "Свернуть" : "Развернуть"}
                  </Button>
                </div>

                {additionalInfoExpanded ? (
                  surveyAdditionalInfoItems.length ? (
                    <div className="space-y-3">
                      <div className="grid gap-2 md:grid-cols-2">
                        {surveyAdditionalInfoItems.map((item) => (
                          <Checkbox
                            key={item.id}
                            label={stripRichTextTokens(item.label)}
                            checked={selectedAdditionalInfoIds.includes(item.id)}
                            onChange={(checked) => {
                              updateSelectedAdditionalInfoIds(
                                checked
                                  ? [...selectedAdditionalInfoIds, item.id]
                                  : selectedAdditionalInfoIds.filter((id) => id !== item.id),
                              );
                            }}
                            hint={stripRichTextTokens(item.description).slice(0, 120)}
                          />
                        ))}
                      </div>

                      {selectedAdditionalInfoItems.length ? (
                        <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50/60 p-3">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                            {"Порядок кнопок на этом вопросе"}
                          </p>
                          {selectedAdditionalInfoItems.map((item, itemIndex) => (
                            <div key={item.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-white px-3 py-2">
                              <span className="min-w-0 truncate text-sm font-semibold text-slate-800">
                                {stripRichTextTokens(item.label)}
                              </span>
                              <div className="flex shrink-0 gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={itemIndex === 0}
                                  onClick={() => updateSelectedAdditionalInfoIds(arrayMove(selectedAdditionalInfoIds, itemIndex, itemIndex - 1))}
                                  className="h-8 w-8 px-0"
                                >
                                  {"\u2191"}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={itemIndex === selectedAdditionalInfoItems.length - 1}
                                  onClick={() => updateSelectedAdditionalInfoIds(arrayMove(selectedAdditionalInfoIds, itemIndex, itemIndex + 1))}
                                  className="h-8 w-8 px-0"
                                >
                                  {"\u2193"}
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 px-4 py-3 text-sm text-slate-500">
                      {"Сначала добавьте кнопки в общей библиотеке доп. информации этого опроса."}
                    </div>
                  )
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 px-4 py-3 text-sm text-slate-500">
                    {"Выбор доп. информации свернут. Тексты редактируются в общей библиотеке опроса."}
                  </div>
                )}
              </div>
            ) : null}

            {false && block.additionalInfoEnabled ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Пункты доп. информации</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onAdditionalInfoExpandedChange(!additionalInfoExpanded)}
                    >
                      {additionalInfoExpanded ? (
                        <ChevronDown className="mr-2 h-4 w-4" />
                      ) : (
                        <ChevronRight className="mr-2 h-4 w-4" />
                      )}
                      {additionalInfoExpanded ? "\u0421\u0432\u0435\u0440\u043D\u0443\u0442\u044C" : "\u0420\u0430\u0437\u0432\u0435\u0440\u043D\u0443\u0442\u044C"}
                    </Button>
                    <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      onAdditionalInfoExpandedChange(true);
                      updateAdditionalInfoItems([
                        ...block.additionalInfoItems,
                        createDraftAdditionalInfoItem(block.additionalInfoItems.length + 1),
                      ]);
                    }}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Добавить пункт
                    </Button>
                  </div>
                </div>

                {additionalInfoExpanded ? (
                  <div className="space-y-3">
                    {block.additionalInfoItems.map((item, itemIndex) => (
                      <AdditionalInfoEditor
                        key={item.id}
                        item={item}
                        itemIndex={itemIndex}
                        totalItems={block.additionalInfoItems.length}
                        onChange={(nextItem) => {
                          const nextItems = [...block.additionalInfoItems];
                          nextItems[itemIndex] = nextItem;
                          updateAdditionalInfoItems(nextItems);
                        }}
                        onMove={(direction) => {
                          if (direction === "up" && itemIndex > 0) {
                            const nextItems = [...block.additionalInfoItems];
                            const [movedItem] = nextItems.splice(itemIndex, 1);
                            nextItems.splice(itemIndex - 1, 0, movedItem);
                            updateAdditionalInfoItems(nextItems);
                          }

                          if (direction === "down" && itemIndex < block.additionalInfoItems.length - 1) {
                            const nextItems = [...block.additionalInfoItems];
                            const [movedItem] = nextItems.splice(itemIndex, 1);
                            nextItems.splice(itemIndex + 1, 0, movedItem);
                            updateAdditionalInfoItems(nextItems);
                          }
                        }}
                        onDelete={() => updateAdditionalInfoItems(block.additionalInfoItems.filter((entry) => entry.id !== item.id))}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 px-4 py-3 text-sm text-slate-500">
                    {"\u0414\u043E\u043F. \u0438\u043D\u0444\u043E\u0440\u043C\u0430\u0446\u0438\u044F \u0441\u0432\u0435\u0440\u043D\u0443\u0442\u0430. \u0420\u0430\u0437\u0432\u0435\u0440\u043D\u0438\u0442\u0435 \u0431\u043B\u043E\u043A, \u0447\u0442\u043E\u0431\u044B \u043E\u0442\u0440\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043A\u043D\u043E\u043F\u043A\u0438 \u0438 \u0442\u0435\u043A\u0441\u0442\u044B."}
                  </div>
                )}
              </div>
            ) : null}
          </div>

          {block.type !== "WELCOME" ? (
            <Checkbox
              label="Обязательный ответ"
              checked={block.required}
              onChange={(checked) => onChange({ ...block, required: checked })}
              hint="Если включено, респондент не сможет пропустить этот экран."
            />
          ) : null}

          <Checkbox
            label="Кнопка «Завершить»"
            checked={block.showFinishButton}
            onChange={(checked) => onChange({ ...block, showFinishButton: checked })}
            hint="Если включено, при прохождении опроса на этом экране появится отдельная кнопка для досрочного завершения."
          />

          <Checkbox
            label="Кнопка «Перезапуск»"
            checked={Boolean(block.showRestartBlockButton)}
            onChange={(checked) => onChange({ ...block, showRestartBlockButton: checked })}
            hint="Если включено, на этом экране можно будет начать опрос заново. Текущие ответы сбросятся и не попадут в результаты."
          />

          {block.type === "WELCOME" ? (
            <div>
              <SectionLabel>Кнопка</SectionLabel>
              <RichTextTextarea
                value={block.ctaLabel}
                onChange={(nextValue) => onChange({ ...block, ctaLabel: nextValue })}
                mobileTextOverride={{
                  label: "Кнопка",
                  value: readMobileTextOverride(block, "ctaLabel"),
                  onChange: (nextValue) => onChange(writeMobileTextOverride(block, "ctaLabel", nextValue)),
                }}
                rows={1}
                className="min-h-[48px]"
              />
            </div>
          ) : null}

          {block.type === "CONTACT" ? (
            <div className="space-y-3">
              <SectionLabel>Поля контакта</SectionLabel>
              {contactFields.map((field) => (
                <div key={field.id} className="grid gap-3 rounded-3xl border border-slate-200 bg-slate-50/70 p-4 lg:grid-cols-[minmax(0,220px),1fr,1fr,220px]">
                  <Checkbox
                    label={field.label}
                    checked={field.enabled}
                    onChange={(checked) => {
                      const nextFields = contactFields.map((entry) =>
                        entry.id === field.id ? { ...entry, enabled: checked } : entry,
                      );
                      onChange({ ...block, fields: nextFields });
                    }}
                    hint={
                      CONTACT_FIELD_TEMPLATES.find((template) => template.id === field.id)?.hint ??
                      "Включает или скрывает это поле в публичном опросе."
                    }
                  />
                  <div className="flex items-center gap-2">
                    <Input
                      value={field.label}
                      disabled={!field.enabled}
                      onChange={(event) => {
                        const nextFields = contactFields.map((entry) =>
                          entry.id === field.id ? { ...entry, label: event.target.value } : entry,
                        );
                        onChange({ ...block, fields: nextFields });
                      }}
                      placeholder="Название поля"
                    />
                    <MobileTextOverrideButton
                      label={`Поле контакта: ${field.label}`}
                      sourceValue={field.label}
                      value={readMobileTextOverride(field, "label")}
                      onChange={(nextValue) => {
                        const nextFields = contactFields.map((entry) =>
                          entry.id === field.id ? writeMobileTextOverride(entry, "label", nextValue) : entry,
                        );
                        onChange({ ...block, fields: nextFields });
                      }}
                    />
                  </div>
                  <Input
                    value={field.placeholder}
                    disabled={!field.enabled}
                    onChange={(event) => {
                      const nextFields = contactFields.map((entry) =>
                        entry.id === field.id ? { ...entry, placeholder: event.target.value } : entry,
                      );
                      onChange({ ...block, fields: nextFields });
                    }}
                    placeholder="Плейсхолдер"
                  />
                  <Checkbox
                    label="Обязательное"
                    checked={field.required}
                    onChange={(checked) => {
                      const nextFields = contactFields.map((entry) =>
                        entry.id === field.id ? { ...entry, required: checked } : entry,
                      );
                      onChange({ ...block, fields: nextFields });
                    }}
                  />
                </div>
              ))}
              <Input
                value={block.submitLabel}
                onChange={(event) => onChange({ ...block, submitLabel: event.target.value })}
                placeholder="Текст кнопки"
              />
            </div>
          ) : null}

          {block.type === "COMBINED" ? (
            <div className="space-y-4 rounded-[28px] border border-sky-100 bg-sky-50/50 p-4">
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr),minmax(0,1fr)]">
                <div>
                  <SectionLabel>Формат варианта ответа</SectionLabel>
                  <Select
                    value={block.inputBlock.type}
                    onChange={(event) => {
                      const nextType = event.target.value;
                      if (!isCombinedInputBlockType(nextType)) {
                        return;
                      }

                      onChange({
                        ...block,
                        inputBlock: changeSurveyBlockType(block.inputBlock as SurveyBlock, nextType, blockIndex + 1) as CombinedInputBlock,
                      });
                    }}
                  >
                    {COMBINED_INPUT_TYPE_OPTIONS.map((type) => (
                      <option key={type} value={type}>
                        {BLOCK_LABELS[type]}
                      </option>
                    ))}
                  </Select>
                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    Респондент сможет выбрать вариант в этом формате или вместо выбора написать свободный ответ ниже.
                  </p>
                </div>
                <div>
                  <SectionLabel>Поле свободного ответа</SectionLabel>
                  <Input
                    value={block.textPlaceholder}
                    onChange={(event) => onChange({ ...block, textPlaceholder: event.target.value })}
                    placeholder="Плейсхолдер"
                  />
                </div>
                <Input
                  type="number"
                  value={block.textMaxLength}
                  onChange={(event) => onChange({ ...block, textMaxLength: Number(event.target.value) || 2000 })}
                  placeholder="Макс. длина текста"
                />
                <Input
                  type="number"
                  value={block.textMinLength}
                  onChange={(event) => onChange({ ...block, textMinLength: Math.max(0, Number(event.target.value) || 0) })}
                  placeholder="Мин. символов для своего ответа"
                />
                <div>
                  <SectionLabel>После текстового ответа</SectionLabel>
                  <Select
                    value={block.textNextBlockId ?? ""}
                    onChange={(event) => onChange({ ...block, textNextBlockId: event.target.value || null })}
                  >
                    <option value={FINISH_SURVEY_TARGET}>Закончить опрос</option>
                    <option value="">Как общий переход блока</option>
                    {optionTargetChoices.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.title}
                      </option>
                    ))}
                  </Select>
                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    Сработает, если респондент не выбрал вариант, а написал ответ в свободном поле.
                  </p>
                </div>
                <Checkbox
                  label="Многострочное поле"
                  checked={block.textMultiline}
                  onChange={(checked) => onChange({ ...block, textMultiline: checked })}
                />
              </div>
            </div>
          ) : null}

          {answerBlock.type === "YES_NO" ? (
            <div className="grid gap-3 md:grid-cols-2">
              <RichTextTextarea
                value={answerBlock.yesLabel}
                onChange={(nextValue) => updateAnswerBlock({ ...answerBlock, yesLabel: nextValue })}
                mobileTextOverride={{
                  label: "Ответ «Да»",
                  value: readMobileTextOverride(answerBlock, "yesLabel"),
                  onChange: (nextValue) => updateAnswerBlock(writeMobileTextOverride(answerBlock, "yesLabel", nextValue)),
                }}
                rows={1}
                className="min-h-[48px]"
              />
              <RichTextTextarea
                value={answerBlock.noLabel}
                onChange={(nextValue) => updateAnswerBlock({ ...answerBlock, noLabel: nextValue })}
                mobileTextOverride={{
                  label: "Ответ «Нет»",
                  value: readMobileTextOverride(answerBlock, "noLabel"),
                  onChange: (nextValue) => updateAnswerBlock(writeMobileTextOverride(answerBlock, "noLabel", nextValue)),
                }}
                rows={1}
                className="min-h-[48px]"
              />
              {scoringEnabled ? (
                <>
                  <Input
                    type="number"
                    value={answerBlock.yesScore}
                    onChange={(event) => updateAnswerBlock({ ...answerBlock, yesScore: Number(event.target.value) || 0 })}
                  />
                  <Input
                    type="number"
                    value={answerBlock.noScore}
                    onChange={(event) => updateAnswerBlock({ ...answerBlock, noScore: Number(event.target.value) || 0 })}
                  />
                </>
              ) : null}
              <Select
                value={answerBlock.yesNextBlockId ?? ""}
                onChange={(event) => updateAnswerBlock({ ...answerBlock, yesNextBlockId: event.target.value || null })}
              >
                <option value={FINISH_SURVEY_TARGET}>Да → Закончить опрос</option>
                <option value="">Следующий по порядку</option>
                {optionTargetChoices.map((option) => (
                  <option key={option.id} value={option.id}>
                    Да → {option.title}
                  </option>
                ))}
              </Select>
              <Select
                value={answerBlock.noNextBlockId ?? ""}
                onChange={(event) => updateAnswerBlock({ ...answerBlock, noNextBlockId: event.target.value || null })}
              >
                <option value={FINISH_SURVEY_TARGET}>Нет → Закончить опрос</option>
                <option value="">Следующий по порядку</option>
                {optionTargetChoices.map((option) => (
                  <option key={option.id} value={option.id}>
                    Нет → {option.title}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}

          {answerBlock.type === "RATING" ? (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <SectionLabel>Количество делений</SectionLabel>
                <Input
                  type="number"
                  value={answerBlock.scale}
                  onChange={(event) => updateAnswerBlock({ ...answerBlock, scale: Number(event.target.value) || 5 })}
                />
              </div>
              <div className={cn("space-y-2", !scoringEnabled && "hidden")}>
                <SectionLabel>За 1 единицу деления, баллов</SectionLabel>
                <Input
                  type="number"
                  value={answerBlock.scorePerUnit}
                  onChange={(event) => updateAnswerBlock({ ...answerBlock, scorePerUnit: Number(event.target.value) || 1 })}
                />
              </div>
              <div className="space-y-2">
                <SectionLabel>Подпись слева</SectionLabel>
                <RichTextTextarea
                  value={answerBlock.minLabel}
                  onChange={(nextValue) => updateAnswerBlock({ ...answerBlock, minLabel: nextValue })}
                  mobileTextOverride={{
                    label: "Подпись слева",
                    value: readMobileTextOverride(answerBlock, "minLabel"),
                    onChange: (nextValue) => updateAnswerBlock(writeMobileTextOverride(answerBlock, "minLabel", nextValue)),
                  }}
                  rows={1}
                  className="min-h-[48px]"
                />
              </div>
              <div className="space-y-2">
                <SectionLabel>Подпись справа</SectionLabel>
                <RichTextTextarea
                  value={answerBlock.maxLabel}
                  onChange={(nextValue) => updateAnswerBlock({ ...answerBlock, maxLabel: nextValue })}
                  mobileTextOverride={{
                    label: "Подпись справа",
                    value: readMobileTextOverride(answerBlock, "maxLabel"),
                    onChange: (nextValue) => updateAnswerBlock(writeMobileTextOverride(answerBlock, "maxLabel", nextValue)),
                  }}
                  rows={1}
                  className="min-h-[48px]"
                />
              </div>
            </div>
          ) : null}

          {answerBlock.type === "SCALE" ? (
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-2">
                <SectionLabel>Нижняя граница</SectionLabel>
                <Input
                  type="number"
                  value={answerBlock.min}
                  onChange={(event) => updateAnswerBlock({ ...answerBlock, min: Number(event.target.value) || 0 })}
                />
              </div>
              <div className="space-y-2">
                <SectionLabel>Верхняя граница</SectionLabel>
                <Input
                  type="number"
                  value={answerBlock.max}
                  onChange={(event) => updateAnswerBlock({ ...answerBlock, max: Number(event.target.value) || 0 })}
                />
              </div>
              <div className={cn("space-y-2", !scoringEnabled && "hidden")}>
                <SectionLabel>За 1 единицу, баллов</SectionLabel>
                <Input
                  type="number"
                  value={answerBlock.scorePerUnit}
                  onChange={(event) => updateAnswerBlock({ ...answerBlock, scorePerUnit: Number(event.target.value) || 0 })}
                />
              </div>
              <div className="space-y-2">
                <SectionLabel>Подпись слева</SectionLabel>
                <RichTextTextarea
                  value={answerBlock.minLabel}
                  onChange={(nextValue) => updateAnswerBlock({ ...answerBlock, minLabel: nextValue })}
                  mobileTextOverride={{
                    label: "Подпись слева",
                    value: readMobileTextOverride(answerBlock, "minLabel"),
                    onChange: (nextValue) => updateAnswerBlock(writeMobileTextOverride(answerBlock, "minLabel", nextValue)),
                  }}
                  rows={1}
                  className="min-h-[48px]"
                />
              </div>
              <div className="space-y-2">
                <SectionLabel>Подпись справа</SectionLabel>
                <RichTextTextarea
                  value={answerBlock.maxLabel}
                  onChange={(nextValue) => updateAnswerBlock({ ...answerBlock, maxLabel: nextValue })}
                  mobileTextOverride={{
                    label: "Подпись справа",
                    value: readMobileTextOverride(answerBlock, "maxLabel"),
                    onChange: (nextValue) => updateAnswerBlock(writeMobileTextOverride(answerBlock, "maxLabel", nextValue)),
                  }}
                  rows={1}
                  className="min-h-[48px]"
                />
              </div>
            </div>
          ) : null}

          {answerBlock.type === "SLIDER" ? (
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-2">
                <SectionLabel>Нижняя граница</SectionLabel>
                <Input
                  type="number"
                  value={answerBlock.min}
                  onChange={(event) => updateAnswerBlock({ ...answerBlock, min: Number(event.target.value) || 0 })}
                />
              </div>
              <div className="space-y-2">
                <SectionLabel>Верхняя граница</SectionLabel>
                <Input
                  type="number"
                  value={answerBlock.max}
                  onChange={(event) => updateAnswerBlock({ ...answerBlock, max: Number(event.target.value) || 0 })}
                />
              </div>
              <div className={cn("space-y-2", !scoringEnabled && "hidden")}>
                <SectionLabel>За 1 цену деления, баллов</SectionLabel>
                <Input
                  type="number"
                  value={answerBlock.scorePerUnit}
                  onChange={(event) => updateAnswerBlock({ ...answerBlock, scorePerUnit: Number(event.target.value) || 0 })}
                />
              </div>
              <div className="space-y-2">
                <SectionLabel>Подпись слева</SectionLabel>
                <RichTextTextarea
                  value={answerBlock.minLabel}
                  onChange={(nextValue) => updateAnswerBlock({ ...answerBlock, minLabel: nextValue })}
                  mobileTextOverride={{
                    label: "Подпись слева",
                    value: readMobileTextOverride(answerBlock, "minLabel"),
                    onChange: (nextValue) => updateAnswerBlock(writeMobileTextOverride(answerBlock, "minLabel", nextValue)),
                  }}
                  rows={1}
                  className="min-h-[48px]"
                />
              </div>
              <div className="space-y-2">
                <SectionLabel>Подпись справа</SectionLabel>
                <RichTextTextarea
                  value={answerBlock.maxLabel}
                  onChange={(nextValue) => updateAnswerBlock({ ...answerBlock, maxLabel: nextValue })}
                  mobileTextOverride={{
                    label: "Подпись справа",
                    value: readMobileTextOverride(answerBlock, "maxLabel"),
                    onChange: (nextValue) => updateAnswerBlock(writeMobileTextOverride(answerBlock, "maxLabel", nextValue)),
                  }}
                  rows={1}
                  className="min-h-[48px]"
                />
              </div>
            </div>
          ) : null}

          {block.type === "TEXT" ? (
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                value={block.placeholder}
                onChange={(event) => onChange({ ...block, placeholder: event.target.value })}
                placeholder="Плейсхолдер"
              />
              <Input
                type="number"
                value={block.maxLength}
                onChange={(event) => onChange({ ...block, maxLength: Number(event.target.value) || 2000 })}
                placeholder="Макс. длина"
              />
              <Input
                type="number"
                value={block.minLength}
                onChange={(event) => onChange({ ...block, minLength: Math.max(0, Number(event.target.value) || 0) })}
                placeholder={"\u041C\u0438\u043D. \u0441\u0438\u043C\u0432\u043E\u043B\u043E\u0432"}
              />
              <Checkbox
                label="Многострочное поле"
                checked={block.multiline}
                onChange={(checked) => onChange({ ...block, multiline: checked })}
              />
              <div className="space-y-3">
                <Checkbox
                  label="Голосовой ответ"
                  checked={block.allowVoiceAnswer}
                  onChange={(checked) => onChange({ ...block, allowVoiceAnswer: checked })}
                  hint="Респондент сможет записать аудио прямо при прохождении опроса."
                />
                {block.allowVoiceAnswer ? (
                  <Checkbox
                    label="Прикреплять голосовое в результат"
                    checked={block.attachVoiceAnswerToResult}
                    onChange={(checked) => onChange({ ...block, attachVoiceAnswerToResult: checked })}
                    className="border-sky-200 bg-sky-50/80"
                    hint="Если выключено, аудио используется только для транскрибации, а в результат сохраняется текст расшифровки без голосового файла."
                  />
                ) : null}
              </div>
              <Checkbox
                label="Прикрепление файла"
                checked={block.allowFileAnswer}
                onChange={(checked) => onChange({ ...block, allowFileAnswer: checked })}
                className="self-start"
                hint="Респондент сможет добавить документ, изображение, аудио или видео до 25 МБ."
              />
            </div>
          ) : null}

          {canManageOptions ? (
            <div className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <SectionLabel>Варианты ответа</SectionLabel>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    updateOptions([
                      ...currentOptions,
                      createDraftOption(currentOptions.length + 1),
                    ])
                  }
                  className="w-full justify-center !px-3 text-[13px] sm:w-auto sm:text-sm"
                >
                  <Plus className="mr-2 h-4 w-4 shrink-0" />
                  Добавить вариант
                </Button>
              </div>

              <DndContext
                sensors={optionDndSensors}
                collisionDetection={closestCenter}
                onDragEnd={(event) => {
                  const { active, over } = event;
                  if (!over || active.id === over.id) {
                    return;
                  }

                  const oldIndex = currentOptions.findIndex((option) => option.id === active.id);
                  const newIndex = currentOptions.findIndex((option) => option.id === over.id);
                  updateOptions(arrayMove(currentOptions, oldIndex, newIndex));
                }}
              >
                <SortableContext items={currentOptions.map((option) => option.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-3">
                    {currentOptions.map((option, optionIndex) => (
                      <SortableOption
                        key={option.id}
                        option={option}
                        nextBlockOptions={optionTargetChoices}
                        isMedia={answerBlock.type === "MEDIA_CHOICE"}
                        showScore={scoringEnabled && answerBlock.type !== "RANKING"}
                        onChange={(nextOption) => {
                          const nextOptions = [...currentOptions];
                          nextOptions[optionIndex] = nextOption;
                          updateOptions(nextOptions);
                        }}
                        onDelete={() => {
                          updateOptions(currentOptions.filter((entry) => entry.id !== option.id));
                        }}
                        onUpload={async (file) => {
                          await onOptionUpload(option.id, file);
                        }}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </div>
          ) : null}

          {answerBlock.type === "MULTI_CHOICE" ? (
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                type="number"
                value={answerBlock.minSelected}
                onChange={(event) => updateAnswerBlock({ ...answerBlock, minSelected: Number(event.target.value) || 0 })}
              />
              <Input
                type="number"
                value={answerBlock.maxSelected ?? ""}
                onChange={(event) =>
                  updateAnswerBlock({
                    ...answerBlock,
                    maxSelected: event.target.value ? Number(event.target.value) : null,
                  })
                }
                placeholder="Без ограничения"
              />
            </div>
          ) : null}

          {answerBlock.type === "DROPDOWN" ? (
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                value={answerBlock.placeholder}
                onChange={(event) => updateAnswerBlock({ ...answerBlock, placeholder: event.target.value })}
                placeholder="Плейсхолдер выпадающего списка"
              />
              <Checkbox
                label="Добавить пункт «Другое»"
                checked={answerBlock.allowOtherOption}
                onChange={(checked) => updateAnswerBlock({ ...answerBlock, allowOtherOption: checked })}
                hint="При выборе этого пункта респондент увидит отдельное поле для свободного ответа."
              />
              {answerBlock.allowOtherOption ? (
                <>
                  <div className="flex items-center gap-2">
                    <Input
                      value={answerBlock.otherOptionLabel}
                      onChange={(event) => updateAnswerBlock({ ...answerBlock, otherOptionLabel: event.target.value })}
                      placeholder="Название пункта"
                    />
                    <MobileTextOverrideButton
                      label="Пункт «Другое»"
                      sourceValue={answerBlock.otherOptionLabel}
                      value={readMobileTextOverride(answerBlock, "otherOptionLabel")}
                      onChange={(nextValue) => updateAnswerBlock(writeMobileTextOverride(answerBlock, "otherOptionLabel", nextValue))}
                    />
                  </div>
                  <Input
                    value={answerBlock.otherPlaceholder}
                    onChange={(event) => updateAnswerBlock({ ...answerBlock, otherPlaceholder: event.target.value })}
                    placeholder="Плейсхолдер свободного ответа"
                  />
                </>
              ) : null}
            </div>
          ) : null}
          </div>
        ) : null}
      </Card>
    </div>
  );
}

export function SurveyBuilder({
  surveyId,
  initialSchema,
  publicSlug,
  lifecycleStatus,
  currentVersionNumber,
}: SurveyBuilderProps) {
  const [schema, setSchema] = useState(() => normalizeSurveySchema(initialSchema));
  const builderUiStorageKey = `survey-builder-ui:${surveyId}`;
  const [builderUiState, setBuilderUiState] = useState<BuilderUiState>(() => readBuilderUiState(builderUiStorageKey));
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState("");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<null | "publish" | "archive" | "restore">(null);
  const [publicSlugValue, setPublicSlugValue] = useState(publicSlug);
  const [publicSlugDraft, setPublicSlugDraft] = useState(publicSlug);
  const [publicSlugStatus, setPublicSlugStatus] = useState<SaveStatus>("idle");
  const [publicSlugError, setPublicSlugError] = useState("");
  const [browserOrigin, setBrowserOrigin] = useState("");
  const [versionNumber, setVersionNumber] = useState(currentVersionNumber);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const serialized = JSON.stringify(schema);
  const lastSavedSerializedRef = useRef(serialized);
  const validationErrors = useMemo(
    () => validateSurveySchema(coerceSurveyNavigationTargets(normalizeSurveySchema(schema, schema.title))),
    [schema],
  );

  const saveNow = useEffectEvent(async (currentSchema: SurveySchema) => {
    setSaveStatus("saving");
    setSaveError("");

    try {
      const response = await fetch(withBasePath(`/api/surveys/${surveyId}/save`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          schema: currentSchema,
          changeSummary: "Автосохранение",
        }),
      });

      const payload = (await response.json()) as { error?: string; savedAt?: string; versionNumber?: number };
      if (!response.ok) {
        throw new Error(payload.error || "Не удалось сохранить черновик.");
      }

      lastSavedSerializedRef.current = JSON.stringify(currentSchema);
      setSaveStatus("saved");
      setLastSavedAt(payload.savedAt ?? new Date().toISOString());
      if (payload.versionNumber) {
        setVersionNumber(payload.versionNumber);
      }
    } catch (error) {
      setSaveStatus("error");
      setSaveError(error instanceof Error ? error.message : "Не удалось сохранить черновик.");
    }
  });

  useEffect(() => {
    setBuilderUiState(readBuilderUiState(builderUiStorageKey));
  }, [builderUiStorageKey]);

  useEffect(() => {
    setBrowserOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    setPublicSlugValue(publicSlug);
    setPublicSlugDraft(publicSlug);
    setPublicSlugStatus("idle");
    setPublicSlugError("");
  }, [publicSlug]);

  useEffect(() => {
    try {
      window.localStorage.setItem(builderUiStorageKey, JSON.stringify(builderUiState));
    } catch {
      // Ignore localStorage write errors.
    }
  }, [builderUiState, builderUiStorageKey]);

  useEffect(() => {
    setBuilderUiState((current) => {
      const next = trimBuilderUiState(
        current,
        schema.blocks.map((block) => block.id),
      );

      return JSON.stringify(next) === JSON.stringify(current) ? current : next;
    });
  }, [schema.blocks]);

  useEffect(() => {
    if (serialized === lastSavedSerializedRef.current) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void saveNow(schema);
    }, 850);

    return () => window.clearTimeout(timeout);
  }, [schema, saveNow, serialized]);

  const nextBlockOptions = schema.blocks.map((block, index) => ({
    id: block.id,
    title: formatBlockTargetLabel(block, index),
  }));
  const publicSurveyUrl = browserOrigin ? appAbsoluteUrl(browserOrigin, `/s/${publicSlugValue}`) : withBasePath(`/s/${publicSlugValue}`);
  const publicSlugChanged = publicSlugDraft.trim() !== publicSlugValue;
  const normalizedPublicSlugDraft = useMemo(() => {
    try {
      return normalizePublicSlugInput(publicSlugDraft);
    } catch {
      return null;
    }
  }, [publicSlugDraft]);
  const publicSurveyPreviewUrl = normalizedPublicSlugDraft
    ? browserOrigin
      ? appAbsoluteUrl(browserOrigin, `/s/${normalizedPublicSlugDraft}`)
      : withBasePath(`/s/${normalizedPublicSlugDraft}`)
    : "";

  const updateBlock = (blockId: string, updater: SurveyBlock | ((block: SurveyBlock) => SurveyBlock)) => {
    setSchema((current) => ({
      ...current,
      blocks: current.blocks.map((block) => {
        if (block.id !== blockId) {
          return block;
        }

        return typeof updater === "function" ? updater(block) : updater;
      }),
    }));
  };

  const handleAction = async (action: "publish" | "archive" | "restore") => {
    setBusyAction(action);
    setSaveError("");

    try {
      const response = await fetch(withBasePath(`/api/surveys/${surveyId}/${action}`), {
        method: "POST",
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || `Не удалось выполнить действие ${action}.`);
      }

      window.location.reload();
    } catch (error) {
      setSaveStatus("error");
      setSaveError(error instanceof Error ? error.message : "Операция завершилась с ошибкой.");
    } finally {
      setBusyAction(null);
    }
  };

  const handlePublicSlugSave = async () => {
    setPublicSlugStatus("saving");
    setPublicSlugError("");

    try {
      const response = await fetch(withBasePath(`/api/surveys/${surveyId}/public-slug`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          publicSlug: publicSlugDraft,
        }),
      });
      const payload = (await response.json()) as { error?: string; publicSlug?: string };
      if (!response.ok || !payload.publicSlug) {
        throw new Error(payload.error || "Не удалось сохранить адрес ссылки.");
      }

      setPublicSlugValue(payload.publicSlug);
      setPublicSlugDraft(payload.publicSlug);
      setPublicSlugStatus("saved");
    } catch (error) {
      setPublicSlugStatus("error");
      setPublicSlugError(error instanceof Error ? error.message : "Не удалось сохранить адрес ссылки.");
    }
  };

  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr),360px]">
      <div className="min-w-0 space-y-6">
        <Card className="overflow-hidden border-slate-200">
          <div className="grid gap-6 px-6 py-6 lg:grid-cols-[minmax(0,1fr),auto]">
            <div className="min-w-0 space-y-4">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Опрос</p>
                <Input
                  value={schema.title}
                  onChange={(event) => setSchema((current) => ({ ...current, title: event.target.value }))}
                  className="h-14 rounded-[24px] text-lg font-semibold"
                />
              </div>
              <Textarea
                rows={3}
                value={schema.description}
                onChange={(event) => setSchema((current) => ({ ...current, description: event.target.value }))}
                placeholder="Кратко опишите цель опроса."
                className="min-h-[96px]"
              />
            </div>
            <div className="flex min-w-[240px] flex-col gap-3">
              <Badge tone={lifecycleStatus === "ARCHIVED" ? "warning" : lifecycleStatus === "PUBLISHED" ? "success" : "neutral"}>
                {formatSurveyLifecycleStatus(lifecycleStatus)}
              </Badge>
              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Сохранение</p>
                <p className="mt-2 text-sm font-semibold text-slate-900">
                  {saveStatus === "saving"
                    ? "Сохраняем черновик..."
                    : saveStatus === "saved"
                      ? "Черновик сохранён"
                      : saveStatus === "error"
                        ? "Ошибка сохранения"
                        : "Автосохранение включено"}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Версия {versionNumber}
                  {lastSavedAt ? ` • ${new Date(lastSavedAt).toLocaleTimeString("ru-RU")}` : ""}
                </p>
                {validationErrors.length ? (
                  <div className="mt-3 rounded-2xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
                    {validationErrors[0]}
                  </div>
                ) : null}
                {saveError ? <div className="mt-3 rounded-2xl bg-rose-50 px-3 py-2 text-xs text-rose-700">{saveError}</div> : null}
              </div>
            </div>
          </div>
        </Card>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={(event: DragEndEvent) => {
            const { active, over } = event;
            if (!over || active.id === over.id) {
              return;
            }

            setSchema((current) => {
              const oldIndex = current.blocks.findIndex((block) => block.id === active.id);
              const newIndex = current.blocks.findIndex((block) => block.id === over.id);
              return {
                ...current,
                blocks: arrayMove(current.blocks, oldIndex, newIndex),
              };
            });
          }}
        >
          <SortableContext items={schema.blocks.map((block) => block.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-4">
              {schema.blocks.map((block, index) => (
                <SortableBlock
                  key={block.id}
                  block={block}
                  blockIndex={index}
                  expanded={builderUiState.expandedBlocks[block.id] ?? true}
                  additionalInfoExpanded={builderUiState.expandedAdditionalInfo[block.id] ?? false}
                  surveyAdditionalInfoItems={schema.settings.additionalInfoItems}
                  scoringEnabled={schema.settings.scoringEnabled}
                  nextBlockOptions={nextBlockOptions}
                  onChange={(nextBlock) => updateBlock(block.id, nextBlock)}
                  onExpandedChange={(expanded) =>
                    setBuilderUiState((current) => ({
                      ...current,
                      expandedBlocks: {
                        ...current.expandedBlocks,
                        [block.id]: expanded,
                      },
                    }))
                  }
                  onAdditionalInfoExpandedChange={(expanded) =>
                    setBuilderUiState((current) => ({
                      ...current,
                      expandedAdditionalInfo: {
                        ...current.expandedAdditionalInfo,
                        [block.id]: expanded,
                      },
                    }))
                  }
                  onDelete={() =>
                    setSchema((current) => ({
                      ...current,
                      blocks: current.blocks.filter((entry) => entry.id !== block.id),
                    }))
                  }
                  onDuplicate={() =>
                    setSchema((current) => ({
                      ...current,
                      blocks: current.blocks.toSpliced(index + 1, 0, duplicateSurveyBlock(block)),
                    }))
                  }
                  onOptionUpload={async (optionId, file) => {
                    const formData = new FormData();
                    formData.set("surveyId", surveyId);
                    formData.set("file", file);

                    const response = await fetch(withBasePath("/api/upload"), {
                      method: "POST",
                      body: formData,
                    });
                    const payload = (await response.json()) as { error?: string; assetId?: string; url?: string };
                    if (!response.ok || !payload.assetId || !payload.url) {
                      throw new Error(payload.error || "Не удалось загрузить файл.");
                    }

                    updateBlock(block.id, (currentBlock) => {
                      const targetBlock = currentBlock.type === "COMBINED" ? currentBlock.inputBlock : currentBlock;

                      if (
                        targetBlock.type !== "MEDIA_CHOICE" &&
                        targetBlock.type !== "SINGLE_CHOICE" &&
                        targetBlock.type !== "MULTI_CHOICE" &&
                        targetBlock.type !== "DROPDOWN" &&
                        targetBlock.type !== "RANKING"
                      ) {
                        return currentBlock;
                      }

                      const nextOptions = ("options" in targetBlock ? targetBlock.options : targetBlock.items).map((option) =>
                        option.id === optionId
                          ? {
                              ...option,
                              mediaAssetId: payload.assetId,
                              mediaUrl: payload.url,
                            }
                          : option,
                      );

                      const nextTargetBlock = "options" in targetBlock
                        ? { ...targetBlock, options: nextOptions }
                        : { ...targetBlock, items: nextOptions };

                      return currentBlock.type === "COMBINED"
                        ? { ...currentBlock, inputBlock: nextTargetBlock as CombinedInputBlock }
                        : (nextTargetBlock as SurveyBlock);
                    });
                  }}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      <div className="space-y-6 xl:sticky xl:top-6 xl:self-start">
        <Card className="border-slate-200 p-6">
          <SectionLabel>{"\u041E\u0446\u0435\u043D\u043A\u0430"}</SectionLabel>
          <Checkbox
            label={"\u0411\u0430\u043B\u043B\u044B \u0437\u0430 \u043E\u0442\u0432\u0435\u0442\u044B"}
            checked={schema.settings.scoringEnabled}
            onChange={(checked) =>
              setSchema((current) => ({
                ...current,
                settings: {
                  ...current.settings,
                  scoringEnabled: checked,
                },
              }))
            }
            hint={
              "\u0415\u0441\u043B\u0438 \u043E\u0446\u0435\u043D\u043A\u0430 \u043D\u0435 \u043D\u0443\u0436\u043D\u0430, \u043F\u043E\u043B\u044F \u0431\u0430\u043B\u043B\u043E\u0432 \u0441\u043A\u0440\u044B\u0442\u044B, \u0430 \u0438\u0442\u043E\u0433\u043E\u0432\u044B\u0439 score \u043E\u0441\u0442\u0430\u0451\u0442\u0441\u044F 0."
            }
          />
        </Card>

        <Card className="border-slate-200 p-6">
          <SectionLabel>Публикация</SectionLabel>
          <div className="space-y-3">
            <Button
              className="w-full"
              disabled={Boolean(validationErrors.length) || busyAction === "publish"}
              onClick={() => startTransition(() => void handleAction("publish"))}
            >
              {busyAction === "publish" ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Опубликовать
            </Button>
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              <p className="font-semibold text-slate-900">Публичная ссылка</p>
              <div className="mt-3 space-y-2">
                <label className="block text-xs font-semibold uppercase tracking-[0.16em] text-slate-400" htmlFor="public-slug-input">
                  Адрес после /s/
                </label>
                <Input
                  id="public-slug-input"
                  value={publicSlugDraft}
                  onChange={(event) => {
                    setPublicSlugDraft(event.target.value);
                    setPublicSlugStatus("idle");
                    setPublicSlugError("");
                  }}
                  placeholder="okc-mpp"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="rounded-2xl bg-white font-mono text-sm"
                />
                <div className="space-y-2 rounded-2xl bg-white px-3 py-2 text-xs text-slate-600 shadow-[inset_0_0_0_1px_rgba(148,163,184,0.22)]">
                  <p className="font-semibold text-slate-500">Текущая ссылка</p>
                  <p className="break-all">{publicSurveyUrl}</p>
                  {publicSlugChanged && publicSurveyPreviewUrl ? (
                    <>
                      <p className="pt-1 font-semibold text-slate-500">После сохранения</p>
                      <p className="break-all text-sky-700">{publicSurveyPreviewUrl}</p>
                    </>
                  ) : null}
                </div>
                <p className="text-xs text-slate-500">
                  Можно ввести короткий адрес или вставить полную ссылку. Система уберёт лишнее и проверит, свободен ли адрес.
                </p>
                {publicSlugError ? <p className="rounded-2xl bg-rose-50 px-3 py-2 text-xs text-rose-700">{publicSlugError}</p> : null}
                {publicSlugStatus === "saved" ? <p className="rounded-2xl bg-emerald-50 px-3 py-2 text-xs text-emerald-700">Адрес сохранён.</p> : null}
              </div>
              <div className="mt-3 grid gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!publicSlugChanged || publicSlugStatus === "saving"}
                  onClick={() => startTransition(() => void handlePublicSlugSave())}
                >
                  {publicSlugStatus === "saving" ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Сохранить адрес
                </Button>
                <CopyButton text={publicSurveyUrl} />
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1">
              <Button
                variant="secondary"
                disabled={busyAction === "restore"}
                onClick={() => startTransition(() => void handleAction("restore"))}
              >
                Восстановить
              </Button>
              <Button
                variant="danger"
                disabled={busyAction === "archive"}
                onClick={() => startTransition(() => void handleAction("archive"))}
              >
                В архив
              </Button>
            </div>
            <Button asChild variant="ghost" className="w-full">
              <Link href={`/s/${publicSlugValue}`} target="_blank">
                Открыть опубликованный опрос
              </Link>
            </Button>
          </div>
        </Card>

        <Card className="border-slate-200 p-6">
          <SectionLabel>Добавить вопрос</SectionLabel>
          <div className="space-y-4">
            {BLOCK_GROUPS.map((group) => (
              <div key={group.id} className="space-y-2">
                <p className="text-sm font-semibold text-slate-900">{group.label}</p>
                <div className="grid gap-2">
                  {group.blockTypes.map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() =>
                        setSchema((current) => ({
                          ...current,
                          blocks: [...current.blocks, createBlock(type, current.blocks.length + 1)],
                        }))
                      }
                      className="flex items-center justify-between rounded-2xl border border-slate-200 px-4 py-3 text-left text-sm font-medium text-slate-700 transition hover:border-sky-200 hover:bg-sky-50/70 hover:text-sky-900"
                    >
                      <span>{BLOCK_LABELS[type]}</span>
                      <Plus className="h-4 w-4" />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
