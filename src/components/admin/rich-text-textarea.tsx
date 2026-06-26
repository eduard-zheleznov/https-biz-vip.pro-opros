"use client";

import { Bold } from "lucide-react";
import type React from "react";
import { useRef } from "react";

import { Textarea } from "@/components/ui/textarea";
import { RICH_TEXT_COLOR_PALETTE, type RichTextColorId } from "@/lib/rich-text";
import { cn } from "@/lib/utils";

const RichTextTextareaControl = Textarea as unknown as React.ForwardRefExoticComponent<
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & React.RefAttributes<HTMLTextAreaElement>
>;

type RichTextTextareaProps = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value"> & {
  value: string;
  onChange: (value: string) => void;
};

function applyWrappedToken(value: string, selectionStart: number, selectionEnd: number, openingToken: string, closingToken: string) {
  const selectedText = value.slice(selectionStart, selectionEnd);
  const beforeSelection = value.slice(0, selectionStart);
  const afterSelection = value.slice(selectionEnd);
  const hasWrappedSelection = beforeSelection.endsWith(openingToken) && afterSelection.startsWith(closingToken);

  if (hasWrappedSelection) {
    const nextSelectionStart = selectionStart - openingToken.length;
    const nextValue =
      value.slice(0, nextSelectionStart) +
      selectedText +
      value.slice(selectionEnd + closingToken.length);

    return {
      value: nextValue,
      selectionStart: nextSelectionStart,
      selectionEnd: nextSelectionStart + selectedText.length,
    };
  }

  const nextSelectionStart = selectionStart + openingToken.length;

  return {
    value: `${beforeSelection}${openingToken}${selectedText}${closingToken}${afterSelection}`,
    selectionStart: nextSelectionStart,
    selectionEnd: nextSelectionStart + selectedText.length,
  };
}

export function RichTextTextarea({ value, onChange, className, rows = 3, ...props }: RichTextTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const applyFormatting = (openingToken: string, closingToken: string) => {
    const textarea = textareaRef.current;
    const selectionStart = textarea?.selectionStart ?? value.length;
    const selectionEnd = textarea?.selectionEnd ?? value.length;
    const next = applyWrappedToken(value, selectionStart, selectionEnd, openingToken, closingToken);

    onChange(next.value);

    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(next.selectionStart, next.selectionEnd);
    });
  };

  const applyColor = (colorId: RichTextColorId) => {
    applyFormatting(`[color=${colorId}]`, "[/color]");
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-slate-200 bg-slate-50/80 px-2.5 py-2">
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => applyFormatting("[b]", "[/b]")}
          className="inline-flex h-7 min-w-7 items-center justify-center rounded-xl border border-slate-200 bg-white px-2 text-xs font-bold text-slate-700 transition hover:border-slate-300 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-300"
          title="Жирный: выделите фрагмент текста и нажмите кнопку"
          aria-label="Сделать выделенный текст жирным или обычным"
        >
          <Bold className="h-4 w-4" aria-hidden="true" />
        </button>
        <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden="true" />
        <span className="mr-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Цвет</span>
        {RICH_TEXT_COLOR_PALETTE.map((color) => (
          <button
            key={color.id}
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => applyColor(color.id)}
            className="h-6 w-6 rounded-full border border-white shadow-[0_0_0_1px_rgba(148,163,184,0.45)] transition hover:scale-110 focus:outline-none focus:ring-2 focus:ring-sky-300"
            style={{ backgroundColor: color.value }}
            title={`${color.label}: выделите фрагмент текста и нажмите цвет`}
            aria-label={`Применить цвет: ${color.label}`}
          />
        ))}
      </div>
      <RichTextTextareaControl
        ref={textareaRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={rows}
        className={cn("text-sm", className)}
        {...props}
      />
    </div>
  );
}
