"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

type GuardedSurveySettingsFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  defaultRedirectTo: string;
  children: React.ReactNode;
};

const FORM_TRANSIENT_FIELDS = new Set(["redirectTo"]);

function serializeForm(form: HTMLFormElement) {
  const pairs = Array.from(new FormData(form).entries())
    .filter(([key]) => !FORM_TRANSIENT_FIELDS.has(key))
    .map(([key, value]) => [key, typeof value === "string" ? value : value.name] as [string, string])
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));

  return new URLSearchParams(pairs).toString();
}

export function GuardedSurveySettingsForm({
  action,
  defaultRedirectTo,
  children,
}: GuardedSurveySettingsFormProps) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const redirectInputRef = useRef<HTMLInputElement | null>(null);
  const initialSnapshotRef = useRef("");
  const userInteractedRef = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);
  const [redirectTo, setRedirectTo] = useState(defaultRedirectTo);

  const hasOpenDialog = useMemo(() => Boolean(pendingNavigation), [pendingNavigation]);

  function resetSnapshot(form: HTMLFormElement) {
    initialSnapshotRef.current = serializeForm(form);
    userInteractedRef.current = false;
    setDirty(false);
  }

  useEffect(() => {
    const form = formRef.current;
    if (!form) {
      return;
    }

    if (redirectInputRef.current) {
      redirectInputRef.current.value = defaultRedirectTo;
    }
    resetSnapshot(form);

    const frameId = window.requestAnimationFrame(() => {
      setRedirectTo(defaultRedirectTo);
      resetSnapshot(form);
    });
    const timeoutId = window.setTimeout(() => resetSnapshot(form), 250);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timeoutId);
    };
  }, [defaultRedirectTo]);

  useEffect(() => {
    const form = formRef.current;
    if (!form) {
      return;
    }

    const markUserInteraction = (event: Event) => {
      const target = event.target;
      if (target instanceof HTMLElement && form.contains(target)) {
        userInteractedRef.current = true;
      }
    };

    const handleChange = (event: Event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement && FORM_TRANSIENT_FIELDS.has(target.name)) {
        return;
      }

      if (!userInteractedRef.current) {
        initialSnapshotRef.current = serializeForm(form);
        setDirty(false);
        return;
      }

      if (redirectInputRef.current) {
        redirectInputRef.current.value = defaultRedirectTo;
      }
      setRedirectTo(defaultRedirectTo);
      setDirty(serializeForm(form) !== initialSnapshotRef.current);
    };

    form.addEventListener("pointerdown", markUserInteraction);
    form.addEventListener("keydown", markUserInteraction);
    form.addEventListener("paste", markUserInteraction);
    form.addEventListener("cut", markUserInteraction);
    form.addEventListener("input", handleChange);
    form.addEventListener("change", handleChange);

    return () => {
      form.removeEventListener("pointerdown", markUserInteraction);
      form.removeEventListener("keydown", markUserInteraction);
      form.removeEventListener("paste", markUserInteraction);
      form.removeEventListener("cut", markUserInteraction);
      form.removeEventListener("input", handleChange);
      form.removeEventListener("change", handleChange);
    };
  }, [defaultRedirectTo]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) {
        return;
      }

      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    const handleDocumentClick = (event: MouseEvent) => {
      if (!dirty || hasOpenDialog) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) {
        return;
      }

      if (anchor.target === "_blank" || anchor.hasAttribute("download")) {
        return;
      }

      const destination = new URL(anchor.href, window.location.href);
      const current = new URL(window.location.href);
      if (destination.origin !== current.origin) {
        return;
      }

      const nextPath = `${destination.pathname}${destination.search}${destination.hash}`;
      const currentPath = `${current.pathname}${current.search}${current.hash}`;
      if (nextPath === currentPath) {
        return;
      }

      event.preventDefault();
      setPendingNavigation(nextPath);
    };

    document.addEventListener("click", handleDocumentClick, true);
    return () => document.removeEventListener("click", handleDocumentClick, true);
  }, [dirty, hasOpenDialog]);

  return (
    <>
      <form
        ref={formRef}
        action={action}
        className="space-y-6"
        onSubmit={() => {
          setDirty(false);
          setPendingNavigation(null);
        }}
      >
        <input ref={redirectInputRef} type="hidden" name="redirectTo" value={redirectTo} readOnly />
        {children}
      </form>

      {pendingNavigation ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4">
          <div className="w-full max-w-md rounded-[32px] border border-slate-200 bg-white p-6 shadow-[0_40px_120px_-40px_rgba(15,23,42,0.45)]">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Несохранённые изменения</p>
            <h2 className="mt-3 text-2xl font-semibold text-slate-950">Сохранить изменения?</h2>
            <p className="mt-3 text-sm leading-7 text-slate-600">
              Если сохранить, новые настройки применятся перед переходом на другую вкладку. Если отказаться, останутся предыдущие сохранённые значения.
            </p>
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <Button
                variant="secondary"
                onClick={() => {
                  const destination = pendingNavigation;
                  if (!destination) {
                    return;
                  }
                  setPendingNavigation(null);
                  setDirty(false);
                  window.location.assign(destination);
                }}
              >
                Нет
              </Button>
              <Button
                onClick={() => {
                  const form = formRef.current;
                  const destination = pendingNavigation;
                  if (!form || !destination) {
                    return;
                  }

                  if (redirectInputRef.current) {
                    redirectInputRef.current.value = destination;
                  }
                  setRedirectTo(destination);
                  setPendingNavigation(null);
                  requestAnimationFrame(() => form.requestSubmit());
                }}
              >
                Да
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
