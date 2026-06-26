"use client";

import { useActionState, useState } from "react";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export type AiSurveyCreateFormState = {
  error: string | null;
};

const INITIAL_STATE: AiSurveyCreateFormState = {
  error: null,
};

type AiSurveyCreateFormProps = {
  action: (state: AiSurveyCreateFormState, formData: FormData) => Promise<AiSurveyCreateFormState>;
  modelOptions: readonly string[];
  promptFileAccept: string;
  defaultProvider: string;
  providerOptions: { value: string; label: string }[];
};

export function AiSurveyCreateForm({
  action,
  modelOptions,
  promptFileAccept,
  defaultProvider,
  providerOptions,
}: AiSurveyCreateFormProps) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_STATE);
  const [prompt, setPrompt] = useState("");
  const [provider, setProvider] = useState(defaultProvider);
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [hiddenServerError, setHiddenServerError] = useState<string | null>(null);

  const visibleError = localError || (state.error && hiddenServerError !== state.error ? state.error : null);

  return (
    <form
      action={formAction}
      encType="multipart/form-data"
      className="mt-4 space-y-3"
      onSubmit={(event) => {
        const form = event.currentTarget;
        const fileInput = form.elements.namedItem("promptFile");
        const hasFile =
          fileInput instanceof HTMLInputElement
            ? (fileInput.files?.length ?? 0) > 0
            : false;

        if (!prompt.trim() && !hasFile) {
          event.preventDefault();
          setLocalError("Укажите промт вручную или прикрепите файл с требованиями для генерации.");
          return;
        }

        setLocalError(null);
        setHiddenServerError(null);
      }}
    >
      <label className="block space-y-2">
        <span className="text-sm font-semibold text-slate-700">Промт для генерации</span>
        <Textarea
          name="prompt"
          rows={5}
          value={prompt}
          onChange={(event) => {
            setPrompt(event.target.value);
            if (localError) {
              setLocalError(null);
            }
            if (state.error) {
              setHiddenServerError(state.error);
            }
          }}
          placeholder="Опционально: добавьте уточнения к файлу или опишите опрос вручную, если файла нет."
        />
      </label>

      <label className="block space-y-2">
        <span className="text-sm font-semibold text-slate-700">Файл с требованиями</span>
        <input
          name="promptFile"
          type="file"
          accept={promptFileAccept}
          className="block w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition file:mr-3 file:rounded-full file:border-0 file:bg-sky-50 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-sky-700 hover:file:bg-sky-100 focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
          onChange={() => {
            if (localError) {
              setLocalError(null);
            }
            if (state.error) {
              setHiddenServerError(state.error);
            }
          }}
        />
        <span className="block text-xs leading-5 text-slate-500">
          Поддерживаются TXT, MD, CSV, JSON, HTML, XML, YAML, RTF и DOCX. Если файл приложен, его текст станет основой для генерации, а поле выше будет работать как дополнительные указания.
        </span>
      </label>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="block space-y-2">
          <span className="text-sm font-semibold text-slate-700">Провайдер</span>
          <select
            name="aiProvider"
            value={provider}
            onChange={(event) => {
              setProvider(event.target.value);
              if (state.error) {
                setHiddenServerError(state.error);
              }
            }}
            className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
          >
            {providerOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-2">
          <span className="text-sm font-semibold text-slate-700">Модель</span>
          <select
            name="aiModel"
            value={model}
            onChange={(event) => {
              setModel(event.target.value);
              if (state.error) {
                setHiddenServerError(state.error);
              }
            }}
            className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
          >
            <option value="">По умолчанию для провайдера</option>
            {modelOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block space-y-2">
        <span className="text-sm font-semibold text-slate-700">API key OpenRouter / OpenAI</span>
        <Input
          name="aiApiKey"
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(event) => {
            setApiKey(event.target.value);
            if (state.error) {
              setHiddenServerError(state.error);
            }
          }}
          placeholder="Опционально, если ключ уже не задан на сервере"
        />
      </label>

      {visibleError ? (
        <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {visibleError}
        </div>
      ) : null}

      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
        Создать опрос по промту
      </Button>
    </form>
  );
}
