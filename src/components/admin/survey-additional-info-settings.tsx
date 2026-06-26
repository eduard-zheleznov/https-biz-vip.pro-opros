"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";

import { RichTextTextarea } from "@/components/admin/rich-text-textarea";
import { Button } from "@/components/ui/button";
import type { AdditionalInfoItem } from "@/types/surveys";

type SurveyAdditionalInfoSettingsProps = {
  initialItems: AdditionalInfoItem[];
};

function createAdditionalInfoItem(index: number): AdditionalInfoItem {
  const cryptoId =
    typeof window !== "undefined" && "crypto" in window && typeof window.crypto.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return {
    id: `info-${cryptoId}`,
    label: `Пункт ${index}`,
    description: "",
  };
}

function moveItem(items: AdditionalInfoItem[], fromIndex: number, toIndex: number) {
  if (toIndex < 0 || toIndex >= items.length) {
    return items;
  }

  const nextItems = [...items];
  const [item] = nextItems.splice(fromIndex, 1);
  if (!item) {
    return items;
  }

  nextItems.splice(toIndex, 0, item);
  return nextItems;
}

function formatButtonCount(count: number) {
  const lastTwoDigits = count % 100;
  const lastDigit = count % 10;

  if (lastTwoDigits >= 11 && lastTwoDigits <= 14) {
    return `${count} кнопок`;
  }

  if (lastDigit === 1) {
    return `${count} кнопка`;
  }

  if (lastDigit >= 2 && lastDigit <= 4) {
    return `${count} кнопки`;
  }

  return `${count} кнопок`;
}

export function SurveyAdditionalInfoSettings({ initialItems }: SurveyAdditionalInfoSettingsProps) {
  const hiddenInputRef = useRef<HTMLInputElement | null>(null);
  const [items, setItems] = useState<AdditionalInfoItem[]>(initialItems);
  const [isSectionCollapsed, setIsSectionCollapsed] = useState(true);
  const serializedItems = useMemo(() => JSON.stringify(items), [items]);

  useEffect(() => {
    const input = hiddenInputRef.current;
    if (!input) {
      return;
    }

    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, [serializedItems]);

  return (
    <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
      <input ref={hiddenInputRef} type="hidden" name="additionalInfoItemsJson" value={serializedItems} readOnly />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Доп. информация</p>
          {isSectionCollapsed ? (
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Скрыто: {formatButtonCount(items.length)} в общей библиотеке.
            </p>
          ) : (
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              Общая библиотека кнопок для этого опроса. В блоках выбираются нужные пункты, а изменение текста здесь
              автоматически обновляет его во всех вопросах.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              setItems((current) => [...current, createAdditionalInfoItem(current.length + 1)]);
              setIsSectionCollapsed(false);
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            Добавить
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={!isSectionCollapsed}
            onClick={() => setIsSectionCollapsed((current) => !current)}
          >
            {isSectionCollapsed ? (
              <>
                <ChevronDown className="mr-2 h-4 w-4" />
                Развернуть
              </>
            ) : (
              <>
                <ChevronUp className="mr-2 h-4 w-4" />
                Свернуть
              </>
            )}
          </Button>
        </div>
      </div>

      {!isSectionCollapsed ? (
        <div className="mt-5 space-y-3">
          {items.length ? (
            items.map((item, itemIndex) => (
              <div key={item.id} className="rounded-[24px] border border-slate-200 bg-slate-50/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">Кнопка {itemIndex + 1}</p>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={itemIndex === 0}
                      onClick={() => setItems((current) => moveItem(current, itemIndex, itemIndex - 1))}
                      className="h-8 w-8 px-0"
                      aria-label="Поднять выше"
                    >
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={itemIndex === items.length - 1}
                      onClick={() => setItems((current) => moveItem(current, itemIndex, itemIndex + 1))}
                      className="h-8 w-8 px-0"
                      aria-label="Опустить ниже"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))}
                      className="h-8 w-8 px-0 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                      aria-label="Удалить"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-[minmax(180px,0.35fr)_minmax(0,1fr)]">
                  <label className="space-y-2">
                    <span className="text-sm font-semibold text-slate-700">Название кнопки</span>
                    <RichTextTextarea
                      value={item.label}
                      rows={2}
                      onChange={(value) => {
                        setItems((current) =>
                          current.map((entry) => (entry.id === item.id ? { ...entry, label: value } : entry)),
                        );
                      }}
                      placeholder="Например: Откуда у вас мой номер?"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-sm font-semibold text-slate-700">Текст пояснения</span>
                    <RichTextTextarea
                      value={item.description}
                      rows={3}
                      onChange={(value) => {
                        setItems((current) =>
                          current.map((entry) => (entry.id === item.id ? { ...entry, description: value } : entry)),
                        );
                      }}
                      placeholder="Что показать пользователю при нажатии на эту кнопку"
                    />
                  </label>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm leading-6 text-slate-500">
              Пока нет общей доп. информации. Добавьте пункты здесь, затем выберите их галочками в нужных блоках
              конструктора.
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
