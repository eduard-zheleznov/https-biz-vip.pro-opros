"use client";

import { RotateCcw, Save, Smartphone, X } from "lucide-react";
import { useState } from "react";

import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type MobileTextOverrideButtonProps = {
  label: string;
  sourceValue: string;
  value?: string | null;
  onChange: (value: string) => void;
  className?: string;
};

export function MobileTextOverrideButton({
  label,
  sourceValue,
  value,
  onChange,
  className,
}: MobileTextOverrideButtonProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value?.trim() ? value : sourceValue);
  const hasOverride = Boolean(value?.trim());
  const openEditor = () => {
    setDraft(value?.trim() ? value : sourceValue);
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={openEditor}
        className={cn(
          "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-xl border transition focus:outline-none focus:ring-2 focus:ring-sky-300",
          hasOverride
            ? "border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100"
            : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-100 hover:text-slate-800",
          className,
        )}
        title={`Мобильная версия: ${label}`}
        aria-label={`Настроить мобильную версию: ${label}`}
      >
        <Smartphone className="h-4 w-4" aria-hidden="true" />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="mobile-text-override-title"
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/40 px-4 py-6 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-2xl rounded-[28px] border border-white/70 bg-white p-5 text-left shadow-[0_30px_100px_-40px_rgba(15,23,42,0.75)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-600">Мобильная версия</p>
                <h2 id="mobile-text-override-title" className="mt-1 text-xl font-semibold tracking-tight text-slate-950">
                  {label}
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Здесь можно вручную поставить переносы строк для телефонов. На компьютере останется обычный текст.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-300"
                aria-label="Закрыть"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={9}
              className="mt-5 min-h-[220px] font-mono text-sm leading-6"
            />

            <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
              Если очистить поле и сохранить, мобильная версия снова будет брать обычный текст.
            </div>

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
                className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-300"
              >
                <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
                Сбросить
              </button>
              <button
                type="button"
                onClick={() => {
                  onChange(draft);
                  setOpen(false);
                }}
                className="inline-flex items-center justify-center rounded-2xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-300"
              >
                <Save className="mr-2 h-4 w-4" aria-hidden="true" />
                Сохранить
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
